export interface CallbackResult {
    token: string;
    error?: string;
}
export interface CallbackServer {
    port: number;
    waitForCallback(timeoutMs?: number): Promise<CallbackResult>;
    stop(): Promise<void>;
}
export declare function startCallbackServer(preferredPort?: number): Promise<CallbackServer>;
export declare function getCallbackUrl(port: number): string;
//# sourceMappingURL=callback-server.d.ts.map