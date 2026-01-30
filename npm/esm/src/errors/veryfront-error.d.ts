export interface BuildContext {
    file?: string;
    line?: number;
    column?: number;
    moduleId?: string;
    phase?: "parse" | "transform" | "bundle" | "optimize" | "dependency-resolution" | "circuit-breaker" | "http-bundle-validation";
    /** Number of failures (for circuit breaker) */
    failures?: number;
    /** Missing dependencies list */
    missing?: Array<{
        specifier: string;
        fromFile: string;
        reason: string;
    }>;
    /** Failed HTTP bundle specifiers */
    failed?: string[];
    /** Cache directory path */
    cacheDir?: string;
}
export interface APIContext {
    endpoint?: string;
    method?: string;
    statusCode?: number;
    headers?: Record<string, string>;
}
export interface RenderContext {
    component?: string;
    route?: string;
    phase?: "server" | "client" | "hydration";
    props?: unknown;
}
export interface ConfigContext {
    configFile?: string;
    field?: string;
    value?: unknown;
    expected?: string;
}
export interface AgentContext {
    agentId?: string;
    intent?: string;
    timeout?: number;
}
export interface FileContext {
    path?: string;
    operation?: "read" | "write" | "delete" | "mkdir";
    permissions?: string;
}
export interface NetworkContext {
    url?: string;
    timeout?: number;
    retryCount?: number;
}
/**
 * Discriminated union for serializable error data.
 *
 * This represents error DATA (plain objects), not throwable errors.
 * For throwable errors, use `VeryfrontError` class from `./types.ts`.
 */
export type VeryfrontErrorData = {
    type: "build";
    message: string;
    context?: BuildContext;
} | {
    type: "api";
    message: string;
    context?: APIContext;
} | {
    type: "render";
    message: string;
    context?: RenderContext;
} | {
    type: "config";
    message: string;
    context?: ConfigContext;
} | {
    type: "agent";
    message: string;
    context?: AgentContext;
} | {
    type: "file";
    message: string;
    context?: FileContext;
} | {
    type: "network";
    message: string;
    context?: NetworkContext;
} | {
    type: "permission";
    message: string;
    context?: FileContext;
} | {
    type: "not_supported";
    message: string;
    feature?: string;
};
export declare function createError(error: VeryfrontErrorData): VeryfrontErrorData;
export declare const isBuildError: (error: VeryfrontErrorData) => error is {
    type: "build";
    message: string;
    context?: BuildContext;
};
export declare const isAPIError: (error: VeryfrontErrorData) => error is {
    type: "api";
    message: string;
    context?: APIContext;
};
export declare const isRenderError: (error: VeryfrontErrorData) => error is {
    type: "render";
    message: string;
    context?: RenderContext;
};
export declare const isConfigError: (error: VeryfrontErrorData) => error is {
    type: "config";
    message: string;
    context?: ConfigContext;
};
export declare const isAgentError: (error: VeryfrontErrorData) => error is {
    type: "agent";
    message: string;
    context?: AgentContext;
};
export declare const isFileError: (error: VeryfrontErrorData) => error is {
    type: "file";
    message: string;
    context?: FileContext;
};
export declare const isNetworkError: (error: VeryfrontErrorData) => error is {
    type: "network";
    message: string;
    context?: NetworkContext;
};
/**
 * Convert a VeryfrontErrorData (plain object) to a throwable Error instance.
 *
 * Uses Error.captureStackTrace when available (V8 engines) to exclude toError()
 * from the stack trace, making the stack point to the actual call site.
 *
 * @see plans/architecture-audit/010.3-dual-veryfront-error-definitions.md
 */
export declare function toError(veryfrontError: VeryfrontErrorData): Error;
export declare function fromError(error: unknown): VeryfrontErrorData | null;
export declare function logError(error: VeryfrontErrorData, logger?: {
    error: (msg: string, ...args: unknown[]) => void;
}): void;
/**
 * Extract error message from any error type
 */
export declare function getErrorMessage(error: unknown): string;
/**
 * Ensure error is an Error instance
 */
export declare function ensureError(error: unknown): Error;
//# sourceMappingURL=veryfront-error.d.ts.map