/**
 * Cross-runtime async context storage.
 *
 * Deno and Node expose the same API through the `node:async_hooks`
 * compatibility module. Keeping that runtime-specific import in the platform
 * layer prevents lower-level utilities from binding directly to Node modules.
 */
export { AsyncLocalStorage } from "node:async_hooks";
