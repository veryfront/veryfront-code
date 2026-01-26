import type { RuntimeAdapter } from "./base.js";
export { detectRuntime } from "./runtime-detection.js";
export { runtime } from "./registry.js";
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
export declare function getAdapter(): Promise<RuntimeAdapter>;
export { denoAdapter } from "./deno.js";
export { nodeAdapter } from "./node.js";
export { bunAdapter } from "./bun.js";
export type { EnvironmentAdapter, FileSystemAdapter, RuntimeAdapter, RuntimeCapabilities, RuntimeId, } from "./base.js";
//# sourceMappingURL=detect.d.ts.map