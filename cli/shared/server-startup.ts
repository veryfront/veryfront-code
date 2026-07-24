import { getEnv, runtime, setEnv } from "veryfront/platform";
import {
  type DevServerOptions,
  type DiscoveryOptions,
  startDevServer,
  startProductionServer,
  type StartProductionServerOptions,
} from "veryfront/server";
import { startLocalCliProxyProductionServer } from "#veryfront/server-cli-startup";
import type { RuntimeAdapter } from "veryfront/platform";
import {
  ensureBuiltinContentProcessor,
  prefetchBuiltinContentProcessor,
} from "./ensure-content-processor.ts";
import { isNotFoundError } from "veryfront/fs";
import { join } from "veryfront/platform/path";
import {
  clearCachedReleaseAssetManifests,
  configureReleaseAssetManifestFetcher,
  parseReleaseAssetManifest,
  type ReleaseAssetManifest,
  type ReleaseAssetManifestFetcher,
} from "veryfront/release-assets";
import { LOCAL_RELEASE_ASSET_MANIFEST_PATH } from "veryfront/build";

type CliServerCleanup = () => void | Promise<void>;

interface CliServerLifecycle {
  stop: () => Promise<void>;
}

/**
 * A CLI server startup phase failed and cleanup is still incomplete.
 *
 * The primary and cleanup failures remain available through `AggregateError`,
 * while `retryCleanup` retains the only safe path to release the live server
 * generation.
 *
 * @internal
 */
export class CliServerStartupCleanupError extends AggregateError {
  constructor(
    scope: string,
    primaryError: unknown,
    cleanupError: unknown,
    readonly retryCleanup: () => Promise<void>,
  ) {
    super(
      [primaryError, cleanupError],
      `${scope} failed and cleanup is incomplete`,
    );
    this.name = "CliServerStartupCleanupError";
  }
}

/**
 * Serialize ordered cleanup while permitting retry from the first unfinished
 * phase. Later global cleanup never runs while an earlier server shutdown is
 * still failing.
 *
 * @internal
 */
export function createCliServerCleanup(
  cleanupSteps: readonly CliServerCleanup[],
): () => Promise<void> {
  const steps = [...cleanupSteps];
  let completedSteps = 0;
  let cleanupPromise: Promise<void> | undefined;

  return () => {
    if (cleanupPromise) return cleanupPromise;

    const attempt = Promise.resolve().then(async () => {
      while (completedSteps < steps.length) {
        await steps[completedSteps]!();
        completedSteps++;
      }
    });
    cleanupPromise = attempt;
    void attempt.then(
      () => undefined,
      () => {
        if (cleanupPromise === attempt) cleanupPromise = undefined;
      },
    );
    return attempt;
  };
}

/** A built release manifest exists but cannot be consumed safely. */
export class CliReleaseAssetManifestError extends Error {
  constructor(message: string, cause?: unknown) {
    super(
      message,
      cause === undefined ? undefined : { cause },
    );
    this.name = "CliReleaseAssetManifestError";
  }
}

/**
 * Load the optional built release manifest.
 *
 * Only a genuine missing-file result is optional. Read failures, malformed
 * JSON, and schema mismatches indicate a corrupt production build and must
 * abort startup instead of silently falling back to a different asset path.
 *
 * @internal
 */
export async function loadCliReleaseAssetManifest(
  fs: Pick<RuntimeAdapter["fs"], "readFile">,
  manifestPath: string,
): Promise<ReleaseAssetManifest | null> {
  let rawManifest: string;
  try {
    rawManifest = await fs.readFile(manifestPath);
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw new CliReleaseAssetManifestError(
      "Unable to read the local release asset manifest",
      error,
    );
  }

  let candidate: unknown;
  try {
    candidate = JSON.parse(rawManifest);
  } catch (error) {
    throw new CliReleaseAssetManifestError(
      "The local release asset manifest is not valid JSON",
      error,
    );
  }

  const manifest = parseReleaseAssetManifest(candidate);
  if (!manifest) {
    throw new CliReleaseAssetManifestError(
      "The local release asset manifest failed schema validation",
    );
  }
  return manifest;
}

/** @internal */
export interface CliProductionManifestRegistry {
  configureFetcher(fetcher: ReleaseAssetManifestFetcher | undefined): void;
  clearCachedManifests(): void;
}

/** @internal */
export interface CliProductionManifestLease {
  register(fetcher: ReleaseAssetManifestFetcher): void;
  release(): void;
}

/** @internal */
export interface CliProductionManifestCoordinator {
  acquire(): CliProductionManifestLease;
}

/**
 * Own the CLI production server's process-global manifest fallback for exactly
 * one startup generation. A contender cannot overwrite a live generation, a
 * failed cleanup keeps ownership until retry succeeds, and a stale lease
 * cannot clear a newer generation.
 *
 * @internal
 */
export function createCliProductionManifestCoordinator(
  registry: CliProductionManifestRegistry,
): CliProductionManifestCoordinator {
  let activeGeneration: symbol | undefined;

  return {
    acquire(): CliProductionManifestLease {
      if (activeGeneration) {
        throw new Error(
          "A CLI production server manifest generation is already active",
        );
      }

      const generation = Symbol("cli-production-manifest-generation");
      activeGeneration = generation;
      let registered = false;
      let released = false;

      const assertActive = (): void => {
        if (released || activeGeneration !== generation) {
          throw new Error(
            "The CLI production server manifest generation is no longer active",
          );
        }
      };

      return {
        register(fetcher: ReleaseAssetManifestFetcher): void {
          assertActive();
          if (registered) {
            throw new Error(
              "The CLI production server manifest generation is already registered",
            );
          }

          registry.configureFetcher(fetcher);
          registered = true;
          registry.clearCachedManifests();
        },
        release(): void {
          if (released) return;

          // Never let a stale generation mutate process-global state owned by a
          // newer generation.
          if (activeGeneration !== generation) {
            released = true;
            return;
          }

          if (registered) {
            registry.configureFetcher(undefined);
            registry.clearCachedManifests();
            registered = false;
          }

          activeGeneration = undefined;
          released = true;
        },
      };
    },
  };
}

const cliProductionManifestCoordinator = createCliProductionManifestCoordinator(
  {
    configureFetcher: configureReleaseAssetManifestFetcher,
    clearCachedManifests: clearCachedReleaseAssetManifests,
  },
);

async function rethrowAfterCliServerCleanup(
  scope: string,
  primaryError: unknown,
  retryCleanup: () => Promise<void>,
): Promise<never> {
  try {
    await retryCleanup();
  } catch (cleanupError) {
    throw new CliServerStartupCleanupError(
      scope,
      primaryError,
      cleanupError,
      retryCleanup,
    );
  }
  throw primaryError;
}

interface FinalizeCliServerStartupOptions {
  ensureContentProcessor?: () => Promise<void>;
  cleanup?: CliServerCleanup;
  scope?: string;
}

/**
 * Complete the last fallible CLI startup phase without orphaning a server that
 * has already acquired its listener and process-global resources.
 *
 * @internal
 */
export async function finalizeCliServerStartup<T extends CliServerLifecycle>(
  server: T,
  options: FinalizeCliServerStartupOptions = {},
): Promise<T> {
  try {
    await (options.ensureContentProcessor ?? ensureBuiltinContentProcessor)();
    return server;
  } catch (primaryError) {
    const retryCleanup = createCliServerCleanup([
      options.cleanup ?? (() => server.stop()),
    ]);
    return await rethrowAfterCliServerCleanup(
      options.scope ?? "CLI server startup",
      primaryError,
      retryCleanup,
    );
  }
}

export interface StartCliProxyModeServerOptions {
  port: number;
  projectDir: string;
  signal: AbortSignal;
  requestInterceptor: (req: Request) => Request | Promise<Request>;
  defaultProjectSlug: string;
  defaultProjectId: string;
  fallbackProjectSlug?: string;
}

function buildDiscoveryConfig(options: StartCliProxyModeServerOptions): DiscoveryOptions {
  const token = getEnv("VERYFRONT_API_TOKEN") ?? "";
  const slug = getEnv("VERYFRONT_PROJECT_SLUG") ?? options.fallbackProjectSlug ?? "";

  return {
    baseDir: options.projectDir,
    projectSlug: slug || undefined,
    apiToken: token || undefined,
    verbose: false,
  };
}

/**
 * Build the production-server options for the CLI's explicitly local proxy.
 *
 * @internal Exported for startup trust-boundary regression tests.
 */
export function buildCliProxyProductionServerOptions(
  options: StartCliProxyModeServerOptions,
): StartProductionServerOptions {
  return {
    port: options.port,
    projectDir: options.projectDir,
    signal: options.signal,
    requestInterceptor: options.requestInterceptor,
    defaultProjectSlug: options.defaultProjectSlug,
    defaultProjectId: options.defaultProjectId,
    discoveryConfig: buildDiscoveryConfig(options),
  };
}

export async function startCliProxyModeServer(
  options: StartCliProxyModeServerOptions,
): Promise<Awaited<ReturnType<typeof startProductionServer>>> {
  // Proxy mode must be set before config loading/bootstrap.
  setEnv("PROXY_MODE", "1");

  // NODE_ENV controls local runtime behavior only. The private CLI startup
  // entrypoint, not this environment value, authorizes the proxy exemption.
  if (!getEnv("NODE_ENV") && !getEnv("DENO_ENV")) {
    setEnv("NODE_ENV", "development");
  }

  prefetchBuiltinContentProcessor();
  const result = await startLocalCliProxyProductionServer(
    buildCliProxyProductionServerOptions(options),
  );
  return await finalizeCliServerStartup(result, {
    scope: "CLI proxy content-processor initialization",
  });
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
  return await finalizeCliServerStartup(result, {
    scope: "CLI development content-processor initialization",
  });
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
  const {
    projectDir,
    port,
    bindAddress,
    debug,
    signal,
    defaultProjectSlug,
    defaultProjectId,
    adapter: requestedAdapter,
  } = options;
  const adapter = requestedAdapter ?? (await runtime.get());
  const manifestPath = join(projectDir, "dist", LOCAL_RELEASE_ASSET_MANIFEST_PATH);
  const manifestLease = cliProductionManifestCoordinator.acquire();
  const releaseManifestLease = createCliServerCleanup([
    () => manifestLease.release(),
  ]);
  let localReleaseId: string | undefined;

  try {
    const manifest = await loadCliReleaseAssetManifest(adapter.fs, manifestPath);
    if (manifest) {
      manifestLease.register(() => Promise.resolve({ state: "ready", manifest }));
      localReleaseId = manifest.releaseId;
    }
  } catch (error) {
    return await rethrowAfterCliServerCleanup(
      "CLI production release-manifest initialization",
      error,
      releaseManifestLease,
    );
  }

  const serverOptions: StartProductionServerOptions = {
    projectDir,
    port,
    bindAddress,
    debug,
    adapter,
    signal,
    defaultProjectSlug,
    defaultProjectId,
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

  let result: Awaited<ReturnType<typeof startProductionServer>>;
  try {
    prefetchBuiltinContentProcessor();
    result = await startProductionServer(serverOptions);
  } catch (error) {
    return await rethrowAfterCliServerCleanup(
      "CLI production server startup",
      error,
      releaseManifestLease,
    );
  }
  const stop = createCliServerCleanup([
    () => result.stop(),
    releaseManifestLease,
  ]);
  const managedResult = {
    ...result,
    stop,
  };
  return await finalizeCliServerStartup(managedResult, {
    cleanup: stop,
    scope: "CLI production content-processor initialization",
  });
}
