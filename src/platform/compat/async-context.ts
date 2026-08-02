/**
 * Cross-runtime async context primitive.
 *
 * Node.js, Deno, and Bun expose the Node-compatible implementation. Browser
 * bundles rewrite this builtin to Veryfront's no-op async-hooks polyfill.
 */
export { AsyncLocalStorage } from "node:async_hooks";
