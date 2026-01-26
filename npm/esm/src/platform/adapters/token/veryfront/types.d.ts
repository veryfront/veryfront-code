/**
 * Token Storage Adapter Types
 *
 * Defines the interface for token storage backends.
 * Tokens are encrypted client-side before being sent to the backend.
 */
/**
 * Token storage adapter interface
 *
 * Simple key-value interface for storing encrypted tokens.
 * Keys are formatted as "{userId}:{serviceId}" (e.g., "user123:gmail").
 * Values are encrypted token blobs (client encrypts before sending).
 */
export interface TokenStorageAdapter {
    /** Get encrypted token by key */
    get(key: string): Promise<string | null>;
    /** Set encrypted token by key (upsert) */
    set(key: string, value: string): Promise<void>;
    /** Delete token by key (idempotent) */
    delete(key: string): Promise<void>;
    /** List all keys with optional prefix filter */
    list?(prefix?: string): Promise<string[]>;
    /** Initialize the adapter (e.g., verify connection) */
    initialize?(): Promise<void>;
    /** Cleanup resources */
    dispose?(): void;
}
/**
 * Configuration for token storage adapters
 */
export interface TokenStorageAdapterConfig {
    /** Storage type */
    type: "memory" | "veryfront-api";
    /** Veryfront Cloud configuration */
    veryfront?: {
        /** API token for authentication */
        apiToken?: string;
        /** Project slug */
        projectSlug?: string;
        /** API base URL (defaults to production) */
        baseUrl?: string;
        /** Retry configuration */
        retry?: {
            maxRetries?: number;
            initialDelay?: number;
            maxDelay?: number;
        };
    };
}
/**
 * Internal config with defaults applied
 */
export interface VeryfrontTokenConfig {
    apiBaseUrl: string;
    apiToken: string;
    projectSlug: string;
    retry: {
        maxRetries: number;
        initialDelay: number;
        maxDelay: number;
    };
}
/**
 * Create verified config from adapter config
 */
export declare function createTokenConfig(config: TokenStorageAdapterConfig): VeryfrontTokenConfig;
/**
 * Error thrown by token storage operations
 */
export declare class TokenStorageError extends Error {
    readonly statusCode?: number | undefined;
    readonly details?: Record<string, unknown> | undefined;
    constructor(message: string, statusCode?: number | undefined, details?: Record<string, unknown> | undefined);
}
//# sourceMappingURL=types.d.ts.map