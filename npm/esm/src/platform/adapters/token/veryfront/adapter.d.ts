/**
 * Veryfront Token Storage Adapter
 *
 * Stores encrypted OAuth tokens in Veryfront Cloud.
 * Tokens are encrypted client-side before being sent to the API.
 */
import { type TokenStorageAdapter, type TokenStorageAdapterConfig } from "./types.js";
export declare class VeryfrontTokenAdapter implements TokenStorageAdapter {
    private client;
    private initialized;
    constructor(config: TokenStorageAdapterConfig);
    initialize(): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
    list(prefix?: string): Promise<string[]>;
    dispose(): void;
    private ensureInitialized;
}
//# sourceMappingURL=adapter.d.ts.map