/**
 * Request Context Store
 *
 * Uses AsyncLocalStorage to propagate request-scoped logger context
 * throughout the call stack without explicit parameter passing.
 *
 * @module utils/logger/request-context
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { __registerRequestContextGetter } from "./logger.js";
/**
 * AsyncLocalStorage instance for request context.
 * This allows any code in the request call stack to access
 * the request-scoped logger without explicit parameter passing.
 */
export const requestContextStore = new AsyncLocalStorage();
/**
 * Get the current request context, if any.
 * Returns undefined if called outside of a request context.
 */
export function getRequestContext() {
    return requestContextStore.getStore();
}
/**
 * Get the request-scoped logger from AsyncLocalStorage.
 * Returns undefined if not in a request context.
 */
export function getRequestLogger() {
    return requestContextStore.getStore()?.logger;
}
/**
 * Run a function within a request context.
 * All code executed within the callback will have access to the request context.
 */
export function runWithRequestContext(context, fn) {
    return requestContextStore.run(context, fn);
}
/**
 * Run an async function within a request context.
 * All code executed within the callback will have access to the request context.
 */
export function runWithRequestContextAsync(context, fn) {
    return requestContextStore.run(context, fn);
}
// Register the context getter with the logger module.
// This allows context-aware loggers to access request context
// without creating a circular dependency.
__registerRequestContextGetter(getRequestContext);
