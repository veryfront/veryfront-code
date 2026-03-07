import { getEnv, runtime, setEnv } from "veryfront/platform";
import {
  type DevServerOptions,
  type DiscoveryOptions,
  startDevServer,
  startProductionServer,
  type StartProductionServerOptions,
} from "veryfront/server";
import type { RuntimeAdapter } from "veryfront/platform";

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

export async function startCliProxyModeServer(
  options: StartCliProxyModeServerOptions,
): Promise<Awaited<ReturnType<typeof startProductionServer>>> {
  // Proxy mode must be set before config loading/bootstrap.
  setEnv("PROXY_MODE", "1");

  // Ensure NODE_ENV is set for local proxy mode (the `start` command uses
  // startProductionServer with PROXY_MODE=1, but this is a local dev scenario,
  // not a deployed pod). Without this, validateProductionEnvironment throws.
  if (!getEnv("NODE_ENV") && !getEnv("DENO_ENV")) {
    setEnv("NODE_ENV", "development");
  }

  return await startProductionServer({
    port: options.port,
    projectDir: options.projectDir,
    signal: options.signal,
    requestInterceptor: options.requestInterceptor,
    defaultProjectSlug: options.defaultProjectSlug,
    defaultProjectId: options.defaultProjectId,
    discoveryConfig: buildDiscoveryConfig(options),
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
  return await startDevServer(devOptions);
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
  const serverOptions: StartProductionServerOptions = {
    projectDir: options.projectDir,
    port: options.port,
    bindAddress: options.bindAddress,
    debug: options.debug,
    adapter,
    signal: options.signal,
    defaultProjectSlug: options.defaultProjectSlug,
    defaultProjectId: options.defaultProjectId,
  };
  return await startProductionServer(serverOptions);
}
