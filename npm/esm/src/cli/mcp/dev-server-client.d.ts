export interface DevServerClientOptions {
    port: number;
}
export declare class DevServerClient {
    private baseUrl;
    constructor(options: DevServerClientOptions);
    /**
     * Fetch live errors from the ErrorCollector.
     */
    getLiveErrors(type?: string): Promise<unknown>;
    /**
     * Fetch live logs from the LogBuffer.
     */
    getLiveLogs(options?: {
        level?: string;
        source?: string;
        pattern?: string;
        limit?: number;
        since?: number;
    }): Promise<unknown>;
    /**
     * Fetch dev server stats.
     */
    getStats(): Promise<unknown>;
    /**
     * Trigger HMR reload.
     */
    triggerHmr(path?: string): Promise<unknown>;
    /**
     * Fetch with retry and exponential backoff.
     * Retries on connection refused / timeout (dev server may be starting up).
     */
    private pull;
}
//# sourceMappingURL=dev-server-client.d.ts.map