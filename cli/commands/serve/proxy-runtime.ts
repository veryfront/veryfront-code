import denoConfig from "../../../deno.json" with { type: "json" };
import { isJsonMode } from "../../shared/json-output.ts";
import { bold, brand, dim } from "../../ui/colors.ts";
import { getEnv, setEnv } from "veryfront/platform/env";
import { cliLogger } from "veryfront/utils/logger";
import {
  activateStandaloneProxyExtensions,
  registerStandaloneProxyExtensionTeardown,
} from "./proxy-extension-composition.ts";

export interface StandaloneProxyRuntimeOptions {
  bindAddress?: string;
  port?: number;
}

interface StandaloneProxyRuntimeDependencies {
  activateExtensions?: typeof activateStandaloneProxyExtensions;
  keepAlive?: () => Promise<void>;
  loadProxy?: () => Promise<unknown>;
  registerTeardown?: typeof registerStandaloneProxyExtensionTeardown;
}

// Capture the constructor before extension activation so extension-owned
// global mutations cannot break the CLI-owned process lifetime promise.
const NativePromise = Promise;

/** Create the never-settling promise that owns the standalone process lifetime. */
export function createStandaloneProxyKeepAlivePromise(): Promise<void> {
  return new NativePromise(() => {});
}

function showProxyHeader(): void {
  if (isJsonMode()) return;
  const version = typeof denoConfig.version === "string" ? denoConfig.version : "0.0.0";
  console.log(`${bold(brand("Veryfront"))} ${dim(`(v${version})`)}`);
  console.log();
}

/** Start the standalone proxy with the same lifecycle in CLI and dedicated binaries. */
export async function runStandaloneProxyRuntime(
  options: StandaloneProxyRuntimeOptions = {},
  dependencies: StandaloneProxyRuntimeDependencies = {},
): Promise<void> {
  if (options.port !== undefined) setEnv("PORT", String(options.port));
  if (options.bindAddress !== undefined) setEnv("HOST", options.bindAddress);

  const port = getEnv("PORT") || "8080";
  const bindAddress = getEnv("HOST") || "0.0.0.0";
  showProxyHeader();
  cliLogger.info(`Starting proxy server on ${bindAddress}:${port}`);

  const activateExtensions = dependencies.activateExtensions ??
    activateStandaloneProxyExtensions;
  const registerTeardown = dependencies.registerTeardown ??
    registerStandaloneProxyExtensionTeardown;
  const extensionLoader = await activateExtensions();
  const teardownExtensions = await registerTeardown(extensionLoader);

  try {
    await (dependencies.loadProxy ?? (() => import("veryfront/proxy/main")))();
  } catch (error) {
    try {
      await teardownExtensions();
    } catch (cleanupError) {
      cliLogger.error("Failed to clean up proxy extensions after startup failure", cleanupError);
    }
    throw error;
  }

  // Deno.serve returns after binding in compiled binaries, while the proxy's
  // signal handlers own shutdown and extension teardown.
  await (dependencies.keepAlive ?? createStandaloneProxyKeepAlivePromise)();
}
