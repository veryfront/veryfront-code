/** Structured error handling with logging for silent failure operations */
export interface ErrorContext {
    operation: string;
    path?: string;
    slug?: string;
    details?: Record<string, unknown>;
}
export type LogLevel = "debug" | "warn" | "error";
export interface ErrorHandlingOptions<T> {
    /** Default value to return on error */
    fallback: T;
    /** Log level for error messages */
    logLevel?: LogLevel;
    /** Whether to include stack trace in logs */
    includeStack?: boolean;
}
/** Execute async operation with error logging and fallback */
export declare function withErrorContext<T>(operation: () => Promise<T>, context: ErrorContext, options: ErrorHandlingOptions<T>): Promise<T>;
/** Execute sync operation with error logging and fallback */
export declare function withErrorContextSync<T>(operation: () => T, context: ErrorContext, options: ErrorHandlingOptions<T>): T;
/** Safe file stat with logging */
export declare function safeFileStat(adapter: {
    fs: {
        stat: (path: string) => Promise<{
            isFile: boolean;
            isDirectory: boolean;
        }>;
    };
}, path: string, operation: string): Promise<{
    isFile: boolean;
    isDirectory: boolean;
} | null>;
/** Safe file read with logging */
export declare function safeFileRead(adapter: {
    fs: {
        readFile: (path: string) => Promise<string>;
    };
}, path: string, operation: string): Promise<string | null>;
/** Safe directory read with logging */
export declare function safeReadDir<T>(adapter: {
    fs: {
        readDir: (path: string) => AsyncIterable<T>;
    };
}, path: string, operation: string): Promise<T[]>;
/** Create a scoped error context helper for multiple related operations */
export declare function createErrorScope(operationPrefix: string): {
    run<T>(operation: () => Promise<T>, details: Omit<ErrorContext, "operation">, fallback: T, logLevel?: LogLevel): Promise<T>;
    runSync<T>(operation: () => T, details: Omit<ErrorContext, "operation">, fallback: T, logLevel?: LogLevel): T;
};
//# sourceMappingURL=error-context.d.ts.map