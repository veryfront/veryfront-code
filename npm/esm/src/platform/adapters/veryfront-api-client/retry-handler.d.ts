export interface RetryConfig {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
}
export interface RequestOptions {
    returnText?: boolean;
    /** Request timeout in milliseconds. Defaults to 30000ms (30 seconds). */
    timeoutMs?: number;
}
export declare function requestWithRetry(url: string, apiToken: string, retryConfig: RetryConfig, options?: RequestOptions): Promise<unknown>;
//# sourceMappingURL=retry-handler.d.ts.map