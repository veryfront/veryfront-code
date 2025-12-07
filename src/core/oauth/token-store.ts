/**
 * Token Store Implementations
 *
 * Provides in-memory and KV-based token storage for OAuth tokens.
 */

import type { TokenData, TokenStore } from "./types.ts";

/**
 * In-memory token store (default, for development)
 *
 * WARNING: Tokens are lost on server restart.
 * Use KV store for production.
 */
export class MemoryTokenStore implements TokenStore {
  private tokens: Map<string, TokenData> = new Map();

  async getTokens(service: string): Promise<TokenData | null> {
    return this.tokens.get(service) || null;
  }

  async setTokens(service: string, tokens: TokenData): Promise<void> {
    this.tokens.set(service, tokens);
  }

  async deleteTokens(service: string): Promise<void> {
    this.tokens.delete(service);
  }

  async hasTokens(service: string): Promise<boolean> {
    return this.tokens.has(service);
  }
}

/**
 * Deno KV token store (for production)
 *
 * Persists tokens across server restarts.
 */
export class KVTokenStore implements TokenStore {
  // @ts-ignore: Deno KV type
  private kv: unknown = null;
  private prefix: string;

  constructor(prefix = "oauth_tokens") {
    this.prefix = prefix;
  }

  // @ts-ignore: Deno KV type
  private async getKV(): Promise<unknown> {
    if (!this.kv) {
      // @ts-ignore: Deno global
      this.kv = await Deno.openKv();
    }
    return this.kv;
  }

  async getTokens(service: string): Promise<TokenData | null> {
    const kv = await this.getKV() as any;
    const result = await kv.get([this.prefix, service]);
    return result.value as TokenData | null;
  }

  async setTokens(service: string, tokens: TokenData): Promise<void> {
    const kv = await this.getKV() as any;
    await kv.set([this.prefix, service], tokens);
  }

  async deleteTokens(service: string): Promise<void> {
    const kv = await this.getKV() as any;
    await kv.delete([this.prefix, service]);
  }

  async hasTokens(service: string): Promise<boolean> {
    const tokens = await this.getTokens(service);
    return tokens !== null;
  }
}

// Default singleton instances
let defaultMemoryStore: MemoryTokenStore | null = null;
let defaultKVStore: KVTokenStore | null = null;

/**
 * Get the default memory token store
 */
export function getMemoryTokenStore(): MemoryTokenStore {
  if (!defaultMemoryStore) {
    defaultMemoryStore = new MemoryTokenStore();
  }
  return defaultMemoryStore;
}

/**
 * Get the default KV token store
 */
export function getKVTokenStore(): KVTokenStore {
  if (!defaultKVStore) {
    defaultKVStore = new KVTokenStore();
  }
  return defaultKVStore;
}

/**
 * Get the appropriate token store based on environment
 */
export function getTokenStore(): TokenStore {
  // Use KV in production, memory in development
  const isProd = typeof Deno !== "undefined" &&
    // @ts-ignore: Deno global
    Deno.env.get("DENO_ENV") === "production";

  if (isProd && typeof Deno !== "undefined") {
    return getKVTokenStore();
  }
  return getMemoryTokenStore();
}
