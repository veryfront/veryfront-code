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