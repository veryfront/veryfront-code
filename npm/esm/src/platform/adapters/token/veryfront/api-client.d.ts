import { type VeryfrontTokenConfig } from "./types.js";
export declare class TokenStorageAPIClient {
    private config;
    constructor(config: VeryfrontTokenConfig);
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
    ping(): Promise<boolean>;
    private buildUrl;
    private buildHeaders;
    private fetchWithRetry;
}
//# sourceMappingURL=api-client.d.ts.map