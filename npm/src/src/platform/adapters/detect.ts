import { logger } from "../../utils/index.js";
import { withSpan } from "../../observability/tracing/otlp-setup.js";
import { createError, toError } from "../../errors/veryfront-error.js";
import { detectRuntime } from "./runtime-detection.js";
import type { RuntimeAdapter } from "./base.js";

// Re-export from standalone module to avoid circular dependency
export { detectRuntime } from "./runtime-detection.js";

// Re-export the registry for convenient access
export { runtime } from "./registry.js";

function throwConfigError(message: string): never {
  logger.error("[Adapter Detection]", message);
  throw toError(createError({ type: "config", message }));
}

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
 * import { runtime } from "#veryfront/platform/adapters/registry.ts";
 * const adapter = await runtime.get();
 * ```
 *
 * @returns A new RuntimeAdapter instance for the detected runtime
 * @throws Error if the runtime is unsupported or requires manual initialization (Cloudflare)
 */
export function getAdapter(): Promise<RuntimeAdapter> {
  const runtimeId = detectRuntime();

  return withSpan(
    "platform.adapter.getAdapter",
    async () => {
      if (runtimeId === "deno") {
        const { denoAdapter } = await import("./deno.js");
        return denoAdapter;
      }

      if (runtimeId === "bun") {
        const { bunAdapter } = await import("./bun.js");
        return bunAdapter;
      }

      if (runtimeId === "node") {
        const { nodeAdapter } = await import("./node.js");
        return nodeAdapter;
      }

      if (runtimeId === "cloudflare") {
        throwConfigError(
          "Cloudflare adapter requires manual initialization with environment. Please use createCloudflareAdapter() with your environment context.",
        );
      }

      const supportedRuntimes = ["deno", "bun", "node", "cloudflare"];
      throwConfigError(
        `Unsupported runtime: ${runtimeId}. Supported runtimes: ${supportedRuntimes.join(", ")}`,
      );
    },
    { "adapter.runtime": runtimeId },
  );
}

export { denoAdapter } from "./deno.js";
export { nodeAdapter } from "./node.js";
export { bunAdapter } from "./bun.js";

export type {
  EnvironmentAdapter,
  FileSystemAdapter,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeId,
} from "./base.js";
