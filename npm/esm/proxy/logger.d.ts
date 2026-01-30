/**
 * Request context for proxy logging.
 * Stored in AsyncLocalStorage to propagate through the call stack.
 */
export interface ProxyRequestContext {
    requestId: string;
    projectSlug?: string;
    projectId?: string;
    releaseId?: string;
    branchId?: string;
    branchName?: string;
    domain?: string;
    environment?: string;
}
/**
 * Run a function with proxy request context.
 * All logs within the function will include the request context fields.
 */
export declare function runWithProxyRequestContext<T>(context: ProxyRequestContext, fn: () => T): T;
/**
 * Get the current proxy request context (if any).
 */
export declare function getProxyRequestContext(): ProxyRequestContext | undefined;
export type LogLevel = "debug" | "info" | "warn" | "error";
declare class ProxyLogger {
    private format;
    private log;
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, error?: unknown): void;
    error(message: string, context: Record<string, unknown>, error?: unknown): void;
    /**
     * Create a child logger with bound context.
     */
    child(context: Record<string, unknown>): ChildProxyLogger;
}
declare class ChildProxyLogger {
    private parent;
    private boundContext;
    constructor(parent: ProxyLogger, boundContext: Record<string, unknown>);
    private merge;
    debug(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    error(message: string, error?: unknown): void;
    error(message: string, context: Record<string, unknown>, error?: unknown): void;
    child(context: Record<string, unknown>): ChildProxyLogger;
}
export declare const proxyLogger: ProxyLogger;
export {};
//# sourceMappingURL=logger.d.ts.map