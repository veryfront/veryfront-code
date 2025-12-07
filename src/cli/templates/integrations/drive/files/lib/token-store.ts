/**
 * OAuth Token Store
 *
 * Simple in-memory token store for development.
 * Replace with a database or KV store for production.
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

// In-memory storage for development
// Use globalThis to share across esbuild bundles (each API route is bundled separately)
const TOKENS_KEY = "__veryfront_oauth_tokens__";
// deno-lint-ignore no-explicit-any
const globalStore = globalThis as any;
const tokens: Map<string, OAuthToken> = globalStore[TOKENS_KEY] ||= new Map<string, OAuthToken>();

function getKey(userId: string, service: string): string {
  return `${userId}:${service}`;
}

/**
 * Simple in-memory token store
 *
 * NOTE: This is for development only. In production, use:
 * - Database (Postgres, SQLite, etc.)
 * - KV store (Cloudflare Workers KV, Vercel KV, etc.)
 * - Encrypted file storage
 */
export const tokenStore: TokenStore = {
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

/**
 * Factory function to create a custom token store
 */
export function createTokenStore(options: {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  delete: (key: string) => Promise<void>;
}): TokenStore {
  return {
    async getToken(userId: string, service: string): Promise<OAuthToken | null> {
      const key = getKey(userId, service);
      const data = await options.get(key);
      if (!data) return null;
      try {
        return JSON.parse(data) as OAuthToken;
      } catch {
        return null;
      }
    },

    async setToken(
      userId: string,
      service: string,
      token: OAuthToken,
    ): Promise<void> {
      const key = getKey(userId, service);
      await options.set(key, JSON.stringify(token));
    },

    async revokeToken(userId: string, service: string): Promise<void> {
      const key = getKey(userId, service);
      await options.delete(key);
    },

    async isConnected(userId: string, service: string): Promise<boolean> {
      const token = await this.getToken(userId, service);
      if (!token) return false;
      // Check if token is not expired (if no expiry, token doesn't expire)
      return !token.expiresAt || token.expiresAt > Date.now();
    },
  };
}
