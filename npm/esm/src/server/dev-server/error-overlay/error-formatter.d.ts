export type ErrorType = "build" | "runtime" | "hydration";
export interface ErrorInfo {
    type: ErrorType;
    error: Error;
    file?: string;
    line?: number;
    column?: number;
    suggestion?: string;
}
export declare function getSuggestion(error: Error): string | undefined;
export declare function formatErrorType(type: ErrorType): string;
//# sourceMappingURL=error-formatter.d.ts.map