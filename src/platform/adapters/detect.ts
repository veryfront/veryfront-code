import { logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "./base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import { detectRuntime } from "./runtime-detection.ts";

// Re-export from standalone module to avoid circular dependency
export { detectRuntime } from "./runtime-detection.ts";

// Re-export the registry for convenient access
export { runtime } from "./registry.ts";

/**
 * Get the runtime adapter for the current environment
 *
 * @deprecated Use `runtime.get()` from `./registry.ts` instead for singleton management.
 * This function creates a new adapter instance each time, which can cause memory leaks
 * and inconsistent state. The registry provides proper singleton management and lifecycle.
 *
 * @example
 * ```ts
 * // Old way (deprecated)
 * const adapter = await getAdapter();
 *
 * // New way (recommended)
 * import { runtime } from "@veryfront/platform/adapters/registry.ts";
 * const adapter = await runtime.get();
 * ```
 *
 * @returns A new RuntimeAdapter instance for the detected runtime
 * @throws Error if the runtime is unsupported or requires manual initialization (Cloudflare)
 */
export async function getAdapter(): Promise<RuntimeAdapter> {
  const runtimeId = detectRuntime();

  switch (runtimeId) {
    case "deno": {
      const { denoAdapter } = await import("./deno.ts");
      return denoAdapter;
    }

    case "bun": {
      const { bunAdapter } = await import("./bun.ts");
      return bunAdapter;
    }

    case "node": {
      const { nodeAdapter } = await import("./node.ts");
      return nodeAdapter;
    }

    case "cloudflare": {
      const errorMsg = "Cloudflare adapter requires manual initialization with environment. " +
        "Please use createCloudflareAdapter() with your environment context.";
      logger.error("[Adapter Detection]", errorMsg);
      throw toError(createError({
        type: "config",
        message: errorMsg,
      }));
    }

    default: {
      const supportedRuntimes = ["deno", "bun", "node", "cloudflare"];
      const errorMsg = `Unsupported runtime: ${runtimeId}. Supported runtimes: ${
        supportedRuntimes.join(", ")
      }`;
      logger.error("[Adapter Detection]", errorMsg);
      throw toError(createError({
        type: "config",
        message: errorMsg,
      }));
    }
  }
}

export { denoAdapter } from "./deno.ts";
export { nodeAdapter } from "./node.ts";
export { bunAdapter } from "./bun.ts";

export type {
  EnvironmentAdapter,
  FileSystemAdapter,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeId,
} from "./base.ts";
