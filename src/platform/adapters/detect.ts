import type { RuntimeAdapter } from "./base.ts";
import { runtime } from "./registry.ts";

// Re-export the registry for convenient access
export { runtime } from "./registry.ts";

/**
 * Get the runtime adapter for the current environment
 *
 * @deprecated Use `runtime.get()` from `./registry.ts` instead for singleton management.
 * This function delegates to the runtime registry for singleton management and lifecycle.
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
 * @returns The initialized RuntimeAdapter for the detected runtime
 * @throws Error if the runtime is unsupported or requires manual initialization (Cloudflare)
 */
export function getAdapter(): Promise<RuntimeAdapter> {
  return runtime.get();
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
