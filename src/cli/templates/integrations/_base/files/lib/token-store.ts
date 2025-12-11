
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

export interface TokenStoreConfig {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
}


export async function encryptToken(token: OAuthToken): Promise<string> {
  const key = getEncryptionKey();
  if (!key) {
    return JSON.stringify(token);
  }

  const encoder = new TextEncoder();
  const data = encoder.encode(JSON.stringify(token));

  const iv = crypto.getRandomValues(new Uint8Array(12));

  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    data,
  );

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

    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      key,
      { name: "AES-GCM" },
      false,
      ["decrypt"],
    );

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

const AUTO_KEY_STORAGE = "__veryfront_auto_encryption_key__";
// deno-lint-ignore no-explicit-any
const globalStore = globalThis as any;

export function generateEncryptionKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function getEncryptionKey(): Uint8Array | null {
  const keyHex = typeof process !== "undefined"
    ? process.env?.TOKEN_ENCRYPTION_KEY
    // deno-lint-ignore no-explicit-any
    : (globalThis as any).Deno?.env?.get("TOKEN_ENCRYPTION_KEY");

  if (keyHex) {
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

  if (!globalStore[AUTO_KEY_STORAGE]) {
    globalStore[AUTO_KEY_STORAGE] = generateEncryptionKey();
    console.log("[Token Store] Auto-generated encryption key for this session");
  }

  const autoKey = globalStore[AUTO_KEY_STORAGE] as string;
  const key = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    key[i] = parseInt(autoKey.slice(i * 2, i * 2 + 2), 16);
  }
  return key;
}


export type StorageMode = "memory" | "database" | "kv" | "redis" | "custom";

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

export function isEncryptionEnabled(): boolean {
  return getEncryptionKey() !== null;
}


const TOKENS_KEY = "__veryfront_oauth_tokens__";
const tokens: Map<string, OAuthToken> = globalStore[TOKENS_KEY] ||= new Map<string, OAuthToken>();

function getKey(userId: string, service: string): string {
  return `${userId}:${service}`;
}

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
    return !token.expiresAt || token.expiresAt > Date.now();
  },
};


export function createTokenStore(config: TokenStoreConfig): TokenStore {
  return {
    async getToken(userId: string, service: string): Promise<OAuthToken | null> {
      const key = getKey(userId, service);
      const data = await config.get(key);
      if (!data) return null;

      return decryptToken(data);
    },

    async setToken(
      userId: string,
      service: string,
      token: OAuthToken,
    ): Promise<void> {
      const key = getKey(userId, service);
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
      return !token.expiresAt || token.expiresAt > Date.now();
    },
  };
}


export const tokenStore: TokenStore = inMemoryStore;

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
