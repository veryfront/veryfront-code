import { getHostEnvExcludingEnvFile, getHostSecret } from "#cli/process-env";
import { runtime } from "#cli/runtime-adapter";
import { type HostRuntime, liveHostRuntime } from "#cli/host-runtime";
import {
  type DevServerOptions,
  type DiscoveryOptions,
  isHostedHttpIsolationEnabled,
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
import type { HostedHttpComposition } from "veryfront/server/http-host";

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
  onMemoryRecycle?: StartProductionServerOptions["onMemoryRecycle"];
}

type HostedHttpHostModule = Pick<
  typeof import("veryfront/server/http-host"),
  "createHostedHttpComposition" | "readHostedHttpCompositionConfig"
>;

interface StartCliProductionServerDependencies {
  startServer?: typeof startProductionServer;
  isHostedHttpEnabled?: () => boolean;
  readProxyMode?: () => string | undefined;
  loadHostedHttp?: () => Promise<HostedHttpHostModule>;
  ensureContentProcessor?: () => Promise<void>;
}

/** Compose hosted HTTP only when the host flag is on; the Node-only module loads only then. */
async function composeHostedHttp(
  dependencies: StartCliProductionServerDependencies,
): Promise<HostedHttpComposition | undefined> {
  if (!(dependencies.isHostedHttpEnabled ?? isHostedHttpIsolationEnabled)()) return undefined;
  const proxyMode =
    (dependencies.readProxyMode ?? (() => getHostEnvExcludingEnvFile("PROXY_MODE")))();
  if (proxyMode?.trim() !== "1") {
    throw new TypeError("VERYFRONT_HOSTED_HTTP_ISOLATION requires PROXY_MODE=1");
  }
  const host =
    await (dependencies.loadHostedHttp ?? (() => import("veryfront/server/http-host")))();
  const config = host.readHostedHttpCompositionConfig();
  if (!config) throw new TypeError("VERYFRONT_HOSTED_HTTP_ISOLATION changed during startup");
  return await host.createHostedHttpComposition(config);
}

export async function startCliProductionServer(
  options: StartCliProductionServerOptions,
  dependencies: StartCliProductionServerDependencies = {},
): Promise<Awaited<ReturnType<typeof startProductionServer>>> {
  // Host-only and default off. Read before bootstrap loads any project code.
  const hostedHttp = await composeHostedHttp(dependencies);
  try {
    return await startCliProductionServerWithHostedHttp(
      options,
      hostedHttp,
      dependencies.startServer ?? startProductionServer,
      dependencies.ensureContentProcessor ?? ensureBuiltinContentProcessor,
    );
  } catch (error) {
    await hostedHttp?.shutdown();
    throw error;
  }
}

async function startCliProductionServerWithHostedHttp(
  options: StartCliProductionServerOptions,
  hostedHttp: HostedHttpComposition | undefined,
  startServer: typeof startProductionServer,
  ensureContentProcessor: () => Promise<void>,
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
    onMemoryRecycle: options.onMemoryRecycle,
    ...(hostedHttp ? { hostedHttp: hostedHttp.ingress } : {}),
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
  const result = await startServer(serverOptions);
  try {
    await ensureContentProcessor();
  } catch (error) {
    // Do not leave a listener running after a failed startup.
    try {
      await result.stop();
    } catch (stopError) {
      throw new AggregateError([error, stopError], "Server startup failed and did not stop");
    }
    throw error;
  }
  return {
    ...result,
    stop: async () => {
      try {
        if (unregisterLocalManifest) {
          unregisterLocalManifest();
          clearReleaseAssetManifestCache();
        }
        await result.stop();
      } finally {
        // After the listener stops: release executor allocations it no longer needs.
        await hostedHttp?.shutdown();
      }
    },
  };
}
