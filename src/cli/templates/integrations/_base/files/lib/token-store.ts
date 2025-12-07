/**
 * OAuth Token Store
 *
 * Manages OAuth tokens for connected services.
 *
 * ## Storage Modes
 *
 * **Development (default)**: In-memory storage - tokens are lost on restart.
 * **Production**: Configure via environment variables:
 *   - DATABASE_URL: Uses database storage (Postgres, SQLite, MySQL)
 *   - KV_REST_API_URL + KV_REST_API_TOKEN: Uses Vercel KV
 *   - REDIS_URL: Uses Redis
 *   - TOKEN_ENCRYPTION_KEY: Enables AES-256-GCM encryption (recommended)
 *
 * ## Security
 *
 * Tokens contain sensitive OAuth credentials. In production:
 * 1. Always use encrypted storage (set TOKEN_ENCRYPTION_KEY)
 * 2. Use HTTPS for all connections
 * 3. Implement proper access control
 * 4. Rotate encryption keys periodically
 *
 * @example Production setup with Vercel KV
 * ```bash
 * # .env
 * KV_REST_API_URL=https://your-kv.vercel-storage.com
 * KV_REST_API_TOKEN=your-token
 * TOKEN_ENCRYPTION_KEY=your-32-byte-hex-key  # Generate: openssl rand -hex 32
 * ```
 *
 * @example Production setup with Postgres
 * ```bash
 * # .env
 * DATABASE_URL=postgres://user:pass@host:5432/db
 * TOKEN_ENCRYPTION_KEY=your-32-byte-hex-key
 * ```
 *
 * @see lib/token-store-examples.ts for complete production implementations
 */

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
}

export interface TokenStore {
  getToken(userId: string, service: string): Promise<OAuthToken | null>;
  setToken(userId: string, service: string, token: OAuthToken): Promise<void>;
  revokeToken(userId: string, service: string): Promise<void>;
  isConnected(userId: string, service: string): Promise<boolean>;
}

/** Token store configuration for production backends */
export interface TokenStoreConfig {
  /** Get value by key */
  get: (key: string) => Promise<string | null>;
  /** Set value by key */
  set: (key: string, value: string) => Promise<void>;
  /** Delete value by key */
  delete: (key: string) => Promise<void>;
}

// ============================================================================
// Encryption Utilities
// ============================================================================

/**
 * Encrypts a token using AES-256-GCM
 * Requires TOKEN_ENCRYPTION_KEY environment variable (32-byte hex string)
 *
 * @example
 * ```typescript
 * const encrypted = await encryptToken(token);
 * // Store encrypted string in database
 * ```
 */
export async function encryptToken(token: OAuthToken): Promise<string> {
  const key = getEncryptionKey();
  if (!key) {
    // No encryption key - store as plain JSON (development mode)
    return JSON.stringify(token);
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(token));

  // Generate random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Import the key
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  // Encrypt
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    data,
  );

  // Combine IV + ciphertext and encode as base64
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return `encrypted:${btoa(String.fromCharCode(...combined))}`;
}

/**
 * Decrypts a token encrypted with encryptToken()
 *
 * @example
 * ```typescript
 * const token = await decryptToken(encryptedString);
 * // Use token.accessToken, token.refreshToken, etc.
 * ```
 */
export async function decryptToken(encrypted: string): Promise<OAuthToken | null> {
  // Check if it's encrypted or plain JSON
  if (!encrypted.startsWith("encrypted:")) {
    try {
      return JSON.parse(encrypted) as OAuthToken;
    } catch {
      return null;
    }
  }

  const key = getEncryptionKey();
  if (!key) {
    console.error("[Token Store] Cannot decrypt: TOKEN_ENCRYPTION_KEY not set");
    return null;
  }

  try {
    // Decode base64
    const base64 = encrypted.slice("encrypted:".length);
    const combined = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    // Extract IV and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    // Import the key
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      cryptoKey,
      ciphertext,
    );

    const decoder = new TextDecoder();
    return JSON.parse(decoder.decode(decrypted)) as OAuthToken;
  } catch (error) {
    console.error("[Token Store] Decryption failed:", error);
    return null;
  }
}

/** Get encryption key from environment */
function getEncryptionKey(): Uint8Array | null {
  const keyHex = typeof process !== "undefined"
    ? process.env?.TOKEN_ENCRYPTION_KEY
    // deno-lint-ignore no-explicit-any
    : (globalThis as any).Deno?.env?.get("TOKEN_ENCRYPTION_KEY");

  if (!keyHex) return null;

  // Convert hex string to Uint8Array (32 bytes = 64 hex chars)
  if (keyHex.length !== 64) {
    console.error("[Token Store] TOKEN_ENCRYPTION_KEY must be 64 hex characters (32 bytes)");
    return null;
  }

  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    key[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
  }
  return key;
}

// ============================================================================
// Storage Mode Detection
// ============================================================================

/** Current storage mode for diagnostics */
export type StorageMode = "memory" | "database" | "kv" | "redis" | "custom";

/** Get current storage mode based on environment */
export function getStorageMode(): StorageMode {
  const env = typeof process !== "undefined"
    ? process.env
    // deno-lint-ignore no-explicit-any
    : (globalThis as any).Deno?.env?.toObject() || {};

  if (env.DATABASE_URL) return "database";
  if (env.KV_REST_API_URL) return "kv";
  if (env.REDIS_URL) return "redis";
  return "memory";
}

/** Check if encryption is enabled */
export function isEncryptionEnabled(): boolean {
  return getEncryptionKey() !== null;
}

// ============================================================================
// In-Memory Store (Development)
// ============================================================================

// Use globalThis to share across esbuild bundles (each API route is bundled separately)
const TOKENS_KEY = "__veryfront_oauth_tokens__";
// deno-lint-ignore no-explicit-any
const globalStore = globalThis as any;
const tokens: Map<string, OAuthToken> = globalStore[TOKENS_KEY] ||= new Map<string, OAuthToken>();

function getKey(userId: string, service: string): string {
  return `${userId}:${service}`;
}

/**
 * In-memory token store for development
 *
 * WARNING: Tokens are lost when the server restarts.
 * For production, configure DATABASE_URL, KV_REST_API_URL, or REDIS_URL.
 */
const inMemoryStore: TokenStore = {
  getToken(userId: string, service: string): Promise<OAuthToken | null> {
    const key = getKey(userId, service);
    return Promise.resolve(tokens.get(key) || null);
  },

  setToken(
    userId: string,
    service: string,
    token: OAuthToken,
  ): Promise<void> {
    const key = getKey(userId, service);
    tokens.set(key, token);
    return Promise.resolve();
  },

  revokeToken(userId: string, service: string): Promise<void> {
    const key = getKey(userId, service);
    tokens.delete(key);
    return Promise.resolve();
  },

  async isConnected(userId: string, service: string): Promise<boolean> {
    const token = await this.getToken(userId, service);
    if (!token) return false;
    // Check if token is not expired (if no expiry, token doesn't expire)
    return !token.expiresAt || token.expiresAt > Date.now();
  },
};

// ============================================================================
// Token Store Factory
// ============================================================================

/**
 * Factory function to create a custom token store with encryption support
 *
 * @example With Vercel KV
 * ```typescript
 * import { kv } from '@vercel/kv';
 *
 * const kvStore = createTokenStore({
 *   get: (key) => kv.get(key),
 *   set: (key, value) => kv.set(key, value),
 *   delete: (key) => kv.del(key),
 * });
 * ```
 *
 * @example With Redis
 * ```typescript
 * import { createClient } from 'redis';
 * const redis = createClient({ url: process.env.REDIS_URL });
 *
 * const redisStore = createTokenStore({
 *   get: (key) => redis.get(key),
 *   set: (key, value) => redis.set(key, value),
 *   delete: (key) => redis.del(key),
 * });
 * ```
 */
export function createTokenStore(config: TokenStoreConfig): TokenStore {
  return {
    async getToken(userId: string, service: string): Promise<OAuthToken | null> {
      const key = getKey(userId, service);
      const data = await config.get(key);
      if (!data) return null;

      // Decrypt if encrypted, otherwise parse as JSON
      return decryptToken(data);
    },

    async setToken(
      userId: string,
      service: string,
      token: OAuthToken,
    ): Promise<void> {
      const key = getKey(userId, service);
      // Encrypt if TOKEN_ENCRYPTION_KEY is set, otherwise store as JSON
      const encrypted = await encryptToken(token);
      await config.set(key, encrypted);
    },

    async revokeToken(userId: string, service: string): Promise<void> {
      const key = getKey(userId, service);
      await config.delete(key);
    },

    async isConnected(userId: string, service: string): Promise<boolean> {
      const token = await this.getToken(userId, service);
      if (!token) return false;
      // Check if token is not expired (if no expiry, token doesn't expire)
      return !token.expiresAt || token.expiresAt > Date.now();
    },
  };
}

// ============================================================================
// Default Export (Auto-detects environment)
// ============================================================================

/**
 * Default token store - auto-selects based on environment
 *
 * In development: Uses in-memory storage (tokens lost on restart)
 * In production: Configure via environment variables for persistent storage
 *
 * @see getStorageMode() to check current mode
 * @see lib/token-store-examples.ts for production implementations
 */
export const tokenStore: TokenStore = inMemoryStore;

// Log storage mode in development
if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
  const mode = getStorageMode();
  if (mode === "memory") {
    console.warn(
      "[Token Store] Using in-memory storage (development mode). " +
      "Tokens will be lost on restart. " +
      "Set DATABASE_URL, KV_REST_API_URL, or REDIS_URL for production."
    );
  }
}
