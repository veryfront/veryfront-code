export interface RetryConfig {
    maxRetries: number;
    initialDelay: number;
    maxDelay: number;
}
export interface RequestOptions {
    returnText?: boolean;
}
export declare function requestWithRetry(url: string, apiToken: string, retryConfig: RetryConfig, options?: RequestOptions): Promise<unknown>;
//# sourceMappingURL=retry-handler.d.ts.map