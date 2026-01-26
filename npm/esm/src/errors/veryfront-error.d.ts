export interface BuildContext {
    file?: string;
    line?: number;
    column?: number;
    moduleId?: string;
    phase?: "parse" | "transform" | "bundle" | "optimize" | "dependency-resolution" | "circuit-breaker";
    /** Number of failures (for circuit breaker) */
    failures?: number;
    /** Missing dependencies list */
    missing?: Array<{
        specifier: string;
        fromFile: string;
        reason: string;
    }>;
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
export type VeryfrontError = {
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
export declare function createError(error: VeryfrontError): VeryfrontError;
export declare const isBuildError: (error: VeryfrontError) => error is {
    type: "build";
    message: string;
    context?: BuildContext;
};
export declare const isAPIError: (error: VeryfrontError) => error is {
    type: "api";
    message: string;
    context?: APIContext;
};
export declare const isRenderError: (error: VeryfrontError) => error is {
    type: "render";
    message: string;
    context?: RenderContext;
};
export declare const isConfigError: (error: VeryfrontError) => error is {
    type: "config";
    message: string;
    context?: ConfigContext;
};
export declare const isAgentError: (error: VeryfrontError) => error is {
    type: "agent";
    message: string;
    context?: AgentContext;
};
export declare const isFileError: (error: VeryfrontError) => error is {
    type: "file";
    message: string;
    context?: FileContext;
};
export declare const isNetworkError: (error: VeryfrontError) => error is {
    type: "network";
    message: string;
    context?: NetworkContext;
};
export declare function toError(veryfrontError: VeryfrontError): Error;
export declare function fromError(error: unknown): VeryfrontError | null;
export declare function logError(error: VeryfrontError, logger?: {
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