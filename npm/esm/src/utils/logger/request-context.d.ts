/**
 * Request Context Store
 *
 * Uses AsyncLocalStorage to propagate request-scoped logger context
 * throughout the call stack without explicit parameter passing.
 *
 * @module utils/logger/request-context
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { type Logger } from "./logger.js";
/**
 * Request context that gets propagated through AsyncLocalStorage.
 */
export interface RequestContext {
    /** Request-scoped logger with bound context */
    logger: Logger;
    /** Unique request identifier */
    requestId: string;
    /** Project slug from request headers */
    projectSlug?: string;
    /** Project ID from request headers */
    projectId?: string;
    /** Domain from host header */
    domain?: string;
}
/**
 * AsyncLocalStorage instance for request context.
 * This allows any code in the request call stack to access
 * the request-scoped logger without explicit parameter passing.
 */
export declare const requestContextStore: AsyncLocalStorage<RequestContext>;
/**
 * Get the current request context, if any.
 * Returns undefined if called outside of a request context.
 */
export declare function getRequestContext(): RequestContext | undefined;
/**
 * Get the request-scoped logger from AsyncLocalStorage.
 * Returns undefined if not in a request context.
 */
export declare function getRequestLogger(): Logger | undefined;
/**
 * Run a function within a request context.
 * All code executed within the callback will have access to the request context.
 */
export declare function runWithRequestContext<T>(context: RequestContext, fn: () => T): T;
/**
 * Run an async function within a request context.
 * All code executed within the callback will have access to the request context.
 */
export declare function runWithRequestContextAsync<T>(context: RequestContext, fn: () => Promise<T>): Promise<T>;
//# sourceMappingURL=request-context.d.ts.map