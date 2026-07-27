import type { RuntimeAdapter } from "./base.ts";
import { runtime } from "./registry.ts";

/**
 * Get the runtime adapter for the current environment
 *
 * @deprecated Use `runtime.get()` from `./registry.ts` instead for singleton management.
 * This compatibility alias delegates to the same lifecycle registry.
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
 * @returns The initialized RuntimeAdapter owned by the registry
 * @throws Error if the runtime is unsupported or requires request-scoped
 * Cloudflare bindings. Use `createCloudflareAdapter(env)` in a Worker handler.
 */
export function getAdapter(): Promise<RuntimeAdapter> {
  return runtime.get();
}

// Re-export the registry for compatibility with existing imports.
export { runtime };

export { denoAdapter } from "./deno.ts";
export { nodeAdapter } from "./node.ts";
export { bunAdapter } from "./bun.ts";

export type {
  BoundedFileSystemAdapter,
  EnvironmentAdapter,
  FileSystemAdapter,
  RuntimeAdapter,
  RuntimeCapabilities,
  RuntimeId,
} from "./base.ts";
