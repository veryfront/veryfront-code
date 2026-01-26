export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    WARN = 2,
    ERROR = 3
}
export type LogFormat = "text" | "json";
/**
 * Structured log entry for JSON output.
 * Fields are designed for easy Grafana/Loki filtering.
 */
export interface LogEntry {
    timestamp: string;
    level: "debug" | "info" | "warn" | "error";
    service: string;
    message: string;
    context?: Record<string, unknown>;
    error?: {
        name: string;
        message: string;
        stack?: string;
    };
    requestId?: string;
    traceId?: string;
    projectSlug?: string;
    project_slug?: string;
    request_url?: string;
    domain?: string;
    project_id?: string;
    release_id?: string;
    branch_id?: string;
    branch_name?: string;
    durationMs?: number;
}
export interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    time<T>(label: string, fn: () => Promise<T>): Promise<T>;
    /**
     * Create a child logger with additional context bound to all log entries.
     */
    child(context: Record<string, unknown>): Logger;
}
/**
 * Reset the cached logger configuration.
 * This is only intended for testing purposes to ensure fresh config evaluation.
 * @internal
 */
export declare function __resetLoggerConfigForTesting(): void;
declare class ConsoleLogger implements Logger {
    private prefix;
    private boundContext;
    constructor(prefix: string, boundContext?: Record<string, unknown>);
    child(context: Record<string, unknown>): Logger;
    private formatJson;
    private formatTextLine;
    private log;
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    time<T>(label: string, fn: () => Promise<T>): Promise<T>;
}
/**
 * Determine the log level based on environment variables.
 * Exported for testing purposes.
 * @internal
 */
export declare function getDefaultLevel(envLevel?: string | undefined, debugFlag?: string | undefined): LogLevel;
export declare const cliLogger: ConsoleLogger;
export declare const serverLogger: ConsoleLogger;
export declare const rendererLogger: ConsoleLogger;
export declare const bundlerLogger: ConsoleLogger;
export declare const agentLogger: ConsoleLogger;
export declare const proxyLogger: ConsoleLogger;
export declare const logger: ConsoleLogger;
/**
 * Create a logger for a specific request context.
 * Useful for binding request-specific metadata to all logs.
 */
export declare function createRequestLogger(baseLogger: Logger, requestContext: {
    requestId?: string;
    traceId?: string;
    projectSlug?: string;
}): Logger;
export {};
//# sourceMappingURL=logger.d.ts.map