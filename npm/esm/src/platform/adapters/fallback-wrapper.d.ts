export interface FallbackOptions {
    operationName: string;
    logError?: boolean;
    rethrowOnFallbackFailure?: boolean;
}
export declare class FallbackExecutionError extends Error {
    readonly primaryError: unknown;
    readonly fallbackError?: unknown | undefined;
    constructor(message: string, primaryError: unknown, fallbackError?: unknown | undefined);
}
export declare function withFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>, options: FallbackOptions): Promise<T>;
export declare function withFallbackSync<T>(primary: () => T, fallback: () => T, options: FallbackOptions): T;
export interface AsyncAdapterFallback<T> {
    execute: () => Promise<T>;
}
export interface SyncAdapterFallback<T> {
    executeSync: () => T;
}
export declare function createAdapterFallback<T>(adapterOperation: () => Promise<T>, directOperation: () => Promise<T>, operationName: string, options?: Partial<Omit<FallbackOptions, "operationName">>): AsyncAdapterFallback<T>;
export declare function createAdapterFallbackSync<T>(adapterOperation: () => T, directOperation: () => T, operationName: string, options?: Partial<Omit<FallbackOptions, "operationName">>): SyncAdapterFallback<T>;
//# sourceMappingURL=fallback-wrapper.d.ts.map