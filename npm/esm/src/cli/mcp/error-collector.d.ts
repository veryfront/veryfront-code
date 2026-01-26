/**************************
 * Error Collector for Dev Server
 *
 * Aggregates compilation, bundle, and runtime errors from the dev server
 * for exposure via MCP to coding agents.
 **************************/
export type ErrorType = "compile" | "runtime" | "bundle" | "hmr" | "module";
export interface DevError {
    /** Unique error identifier */
    id: string;
    /** Error category */
    type: ErrorType;
    /** Human-readable error message */
    message: string;
    /** Source file path (if available) */
    file?: string;
    /** Line number (if available) */
    line?: number;
    /** Column number (if available) */
    column?: number;
    /** Full stack trace (if available) */
    stack?: string;
    /** When the error occurred */
    timestamp: number;
    /** Additional context/metadata */
    context?: Record<string, unknown>;
}
export interface ErrorFilter {
    type?: ErrorType | ErrorType[];
    file?: string | RegExp;
    since?: number;
}
export type ErrorSubscriber = (error: DevError) => void;
export declare class ErrorCollector {
    private errors;
    private subscribers;
    private idCounter;
    private maxErrors;
    constructor(options?: {
        maxErrors?: number;
    });
    private generateId;
    add(error: Omit<DevError, "id" | "timestamp">): DevError;
    addCompileError(message: string, file?: string, line?: number, column?: number): DevError;
    addRuntimeError(message: string, stack?: string, context?: Record<string, unknown>): DevError;
    addBundleError(message: string, file?: string, context?: Record<string, unknown>): DevError;
    addHMRError(message: string, file?: string, context?: Record<string, unknown>): DevError;
    addModuleError(message: string, file?: string, context?: Record<string, unknown>): DevError;
    getAll(filter?: ErrorFilter): DevError[];
    get(id: string): DevError | undefined;
    clearFile(file: string): number;
    clearType(type: ErrorType): number;
    clear(): void;
    get count(): number;
    countByType(): Record<ErrorType, number>;
    subscribe(callback: ErrorSubscriber): () => void;
    toJSON(): DevError[];
    private clearWhere;
}
export declare function getErrorCollector(): ErrorCollector;
export declare function resetErrorCollector(): void;
export declare function parseCompileError(output: string): Partial<DevError> | null;
//# sourceMappingURL=error-collector.d.ts.map