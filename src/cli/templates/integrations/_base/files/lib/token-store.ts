/********************************************************************************
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
 * @see lib/token-store-examples.ts for complete production implementations
 ********************************************************************************/

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
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
}

// ============================================================================
// Encryption Utilities
// ============================================================================

export async function encryptToken(token: OAuthToken): Promise<string> {
  const key = getEncryptionKey();
  if (!key) return JSON.stringify(token);

  const data = new TextEncoder().encode(JSON.stringify(token));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, [
    "encrypt",
  ]);

  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoKey, data);

  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return `encrypted:${btoa(String.fromCharCode(...combined))}`;
}

export async function decryptToken(encrypted: string): Promise<OAuthToken | null> {
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
    const base64 = encrypted.slice("encrypted:".length);
    const combined = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));

    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "AES-GCM" }, false, [
      "decrypt",
    ]);

    const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, cryptoKey, ciphertext);

    return JSON.parse(new TextDecoder().decode(decrypted)) as OAuthToken;
  } catch (error) {
    console.error("[Token Store] Decryption failed:", error);
    return null;
  }
}

const AUTO_KEY_STORAGE = "__veryfront_auto_encryption_key__";
const TOKENS_KEY = "__veryfront_oauth_tokens__";

const globalStore = globalThis as Record<string, unknown>;

export function generateEncryptionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getEnvVar(name: string): string | undefined {
  if (typeof process !== "undefined") return process.env?.[name];
  return (globalThis as any).Deno?.env?.get(name);
}

function hexToKeyBytes(keyHex: string): Uint8Array | null {
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

/** Get encryption key from environment or auto-generate for development */
function getEncryptionKey(): Uint8Array | null {
  const keyHex = getEnvVar("TOKEN_ENCRYPTION_KEY");
  if (keyHex) return hexToKeyBytes(keyHex);

  if (!globalStore[AUTO_KEY_STORAGE]) {
    globalStore[AUTO_KEY_STORAGE] = generateEncryptionKey();
    console.log("[Token Store] Auto-generated encryption key for this session");
  }

  return hexToKeyBytes(globalStore[AUTO_KEY_STORAGE] as string);
}

// ============================================================================
// Storage Mode Detection
// ============================================================================

export type StorageMode = "memory" | "database" | "kv" | "redis" | "custom";

export function getStorageMode(): StorageMode {
  const env =
    typeof process !== "undefined"
      ? process.env
      : ((globalThis as any).Deno?.env?.toObject() as Record<string, string> | undefined) ?? {};

  if (env.DATABASE_URL) return "database";
  if (env.KV_REST_API_URL) return "kv";
  if (env.REDIS_URL) return "redis";
  return "memory";
}

export function isEncryptionEnabled(): boolean {
  return getEncryptionKey() !== null;
}

// ============================================================================
// In-Memory Store (Development)
// ============================================================================

const tokens = (globalStore[TOKENS_KEY] as Map<string, OAuthToken> | undefined) ?? new Map();
globalStore[TOKENS_KEY] = tokens;

function getKey(userId: string, service: string): string {
  return `${userId}:${service}`;
}

async function isConnected(store: Pick<TokenStore, "getToken">, userId: string, service: string): Promise<boolean> {
  const token = await store.getToken(userId, service);
  return !!token && (!token.expiresAt || token.expiresAt > Date.now());
}

const inMemoryStore: TokenStore = {
  async getToken(userId: string, service: string): Promise<OAuthToken | null> {
    return tokens.get(getKey(userId, service)) ?? null;
  },

  async setToken(userId: string, service: string, token: OAuthToken): Promise<void> {
    tokens.set(getKey(userId, service), token);
  },

  async revokeToken(userId: string, service: string): Promise<void> {
    tokens.delete(getKey(userId, service));
  },

  async isConnected(userId: string, service: string): Promise<boolean> {
    return isConnected(this, userId, service);
  },
};

// ============================================================================
// Token Store Factory
// ============================================================================

export function createTokenStore(config: TokenStoreConfig): TokenStore {
  return {
    async getToken(userId: string, service: string): Promise<OAuthToken | null> {
      const data = await config.get(getKey(userId, service));
      if (!data) return null;
      return decryptToken(data);
    },

    async setToken(userId: string, service: string, token: OAuthToken): Promise<void> {
      await config.set(getKey(userId, service), await encryptToken(token));
    },

    async revokeToken(userId: string, service: string): Promise<void> {
      await config.delete(getKey(userId, service));
    },

    async isConnected(userId: string, service: string): Promise<boolean> {
      return isConnected(this, userId, service);
    },
  };
}

// ============================================================================
// Default Export (Auto-detects environment)
// ============================================================================

export const tokenStore: TokenStore = inMemoryStore;

if (typeof process !== "undefined" && process.env?.NODE_ENV !== "production") {
  if (getStorageMode() === "memory") {
    console.warn(
      "[Token Store] Using in-memory storage (development mode). " +
        "Tokens will be lost on restart. " +
        "Set DATABASE_URL, KV_REST_API_URL, or REDIS_URL for production.",
    );
  }
}
