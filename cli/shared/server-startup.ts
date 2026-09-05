import { getHostSecret } from "#cli/process-env";
import { runtime } from "#cli/runtime-adapter";
import { type HostRuntime, liveHostRuntime } from "#cli/host-runtime";
import {
  type DevServerOptions,
  type DiscoveryOptions,
  startDevServer,
  startProductionServer,
  type StartProductionServerOptions,
} from "veryfront/server";
import type { RuntimeAdapter } from "veryfront/platform";
import {
  ensureBuiltinContentProcessor,
  prefetchBuiltinContentProcessor,
} from "./ensure-content-processor.ts";
import { join } from "veryfront/platform/path";
import {
  clearReleaseAssetManifestCache,
  parseReleaseAssetManifest,
  registerManifestFetcherForRelease,
} from "veryfront/release-assets";
import { LOCAL_RELEASE_ASSET_MANIFEST_PATH } from "veryfront/build";

export interface StartCliProxyModeServerOptions {
  port: number;
  projectDir: string;
  signal: AbortSignal;
  requestInterceptor: (req: Request) => Request | Promise<Request>;
  defaultProjectId: string;
  linkedProjectSlug?: string;
}

const LOCAL_CLI_PROXY_MODE_ENV = "VERYFRONT_CLI_LOCAL_PROXY_MODE";
// Captured before project code runs: this normalization decides between an
// exported token and the host-private stored login token, so a project that
// replaces `String.prototype.trim` must not be able to flip that decision.
const applyIntrinsic = Reflect.apply;
const stringTrim = String.prototype.trim;

export function prepareCliProxyModeEnvironment(host: HostRuntime = liveHostRuntime()): void {
  // Proxy mode must be set before config loading/bootstrap.
  host.env.set("PROXY_MODE", "1");
  host.env.set(LOCAL_CLI_PROXY_MODE_ENV, "1");

  // Ensure NODE_ENV is set for local proxy mode (the `start` command uses
  // startProductionServer with PROXY_MODE=1, but this is a local dev scenario,
  // not a deployed pod). Without this, validateProductionEnvironment throws.
  if (!host.env.get("NODE_ENV") && !host.env.get("DENO_ENV")) {
    host.env.set("NODE_ENV", "development");
  }
}

export function buildProxyRuntimeProjectIdentity(
  options: Pick<StartCliProxyModeServerOptions, "defaultProjectId" | "linkedProjectSlug">,
): Pick<StartProductionServerOptions, "defaultProjectSlug" | "defaultProjectId"> {
  return {
    defaultProjectSlug: options.defaultProjectId,
    defaultProjectId: options.defaultProjectId,
  };
}

export function buildDiscoveryConfig(
  options: StartCliProxyModeServerOptions,
  host: HostRuntime = liveHostRuntime(),
): DiscoveryOptions {
  // `applyRuntimeAuthContext` registers a stored CLI login token host-privately
  // instead of exporting it, so fall back to that store when the developer has
  // not exported `VERYFRONT_API_TOKEN` themselves. A defined-but-blank export
  // counts as "not exported" here, matching the normalization the CLI used when
  // it decided to register the stored token.
  const rawExportedToken = host.env.get("VERYFRONT_API_TOKEN");
  const exportedToken = rawExportedToken === undefined
    ? ""
    : applyIntrinsic(stringTrim, rawExportedToken, []) as string;
  const token = exportedToken ? exportedToken : (getHostSecret("VERYFRONT_API_TOKEN") ?? "");
  const slug = host.env.get("VERYFRONT_PROJECT_SLUG") ?? options.linkedProjectSlug ?? "";

  return {
    baseDir: options.projectDir,
    projectSlug: slug || undefined,
    apiToken: token || undefined,
    verbose: false,
  };
}

export async function startCliProxyModeServer(
  options: StartCliProxyModeServerOptions,
): Promise<Awaited<ReturnType<typeof startProductionServer>>> {
  prepareCliProxyModeEnvironment();

  prefetchBuiltinContentProcessor();
  const result = await startProductionServer({
    port: options.port,
    projectDir: options.projectDir,
    signal: options.signal,
    requestInterceptor: options.requestInterceptor,
    ...buildProxyRuntimeProjectIdentity(options),
    discoveryConfig: buildDiscoveryConfig(options),
  });
  await ensureBuiltinContentProcessor();
  return result;
}

export interface StartCliDevServerOptions {
  port: number;
  projectDir: string;
  signal: AbortSignal;
  enableHMR?: boolean;
  enableFastRefresh?: boolean;
}

export async function startCliDevServer(
  options: StartCliDevServerOptions,
): Promise<Awaited<ReturnType<typeof startDevServer>>> {
  const devOptions: DevServerOptions = {
    port: options.port,
    projectDir: options.projectDir,
    enableHMR: options.enableHMR,
    enableFastRefresh: options.enableFastRefresh,
    signal: options.signal,
  };
  prefetchBuiltinContentProcessor();
  const result = await startDevServer(devOptions);
  await ensureBuiltinContentProcessor();
  return result;
}

export interface StartCliProductionServerOptions {
  projectDir: string;
  port: number;
  bindAddress: string;
  debug?: boolean;
  signal: AbortSignal;
  defaultProjectSlug: string;
  defaultProjectId: string;
  adapter?: RuntimeAdapter;
}

export async function startCliProductionServer(
  options: StartCliProductionServerOptions,
): Promise<Awaited<ReturnType<typeof startProductionServer>>> {
  const adapter = options.adapter ?? (await runtime.get());
  const manifestPath = join(options.projectDir, "dist", LOCAL_RELEASE_ASSET_MANIFEST_PATH);
  let unregisterLocalManifest: (() => void) | undefined;
  let localReleaseId: string | undefined;

  try {
    const manifestRaw = await adapter.fs.readFile(manifestPath);
    const manifest = parseReleaseAssetManifest(JSON.parse(manifestRaw));
    if (manifest) {
      clearReleaseAssetManifestCache();
      unregisterLocalManifest = registerManifestFetcherForRelease(
        manifest.releaseId,
        () =>
          Promise.resolve({
            state: "ready",
            manifest_version: manifest.manifestVersion,
            manifest,
          }),
      );
      localReleaseId = manifest.releaseId;
    }
  } catch (_) {
    /* expected: builds without local release asset manifests keep CDN fallback */
  }

  const serverOptions: StartProductionServerOptions = {
    projectDir: options.projectDir,
    port: options.port,
    bindAddress: options.bindAddress,
    debug: options.debug,
    adapter,
    signal: options.signal,
    defaultProjectSlug: options.defaultProjectSlug,
    defaultProjectId: options.defaultProjectId,
    defaultReleaseId: localReleaseId,
    defaultEnvironment: "production",
    // Do NOT register a `localProjects` mapping here. `vf serve` and the
    // compiled binary are production deployments, and `isLocalProject: true`
    // flips `isDev` on in security headers (suppressing CSP) and in the SSR
    // error overlay (exposing absolute paths and stack traces) — the exact
    // dev-surface leak VULN-SRV-1 / VULN-SRV-2 was closing. The strategy
    // narrowing in `client-module-strategy.ts` already routes hydration
    // through `/_veryfront/rsc/module?` for non-local deployments, so no
    // `localProjects` entry is required for the compiled binary to work.
  };
  prefetchBuiltinContentProcessor();
  const result = await startProductionServer(serverOptions);
  await ensureBuiltinContentProcessor();
  return {
    ...result,
    stop: async () => {
      if (unregisterLocalManifest) {
        unregisterLocalManifest();
        clearReleaseAssetManifestCache();
      }
      await result.stop();
    },
  };
}
