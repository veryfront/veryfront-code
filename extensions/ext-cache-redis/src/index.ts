/**
 * ext-cache-redis — Redis-backed `TokenCacheStore` implementation for the Veryfront
 * proxy's OAuth token cache.
 *
 * Reads configuration from `ctx.config` at setup time. Expected shape:
 *
 *   {
 *     proxy?: {
 *       cache?: {
 *         type?: "memory" | "redis";
 *         redis?: {
 *           url: string;            // or read from REDIS_URL
 *           prefix?: string;
 *           tls?: boolean;
 *           username?: string;
 *           password?: string;
 *           connectTimeout?: number;
 *         };
 *       };
 *     };
 *   }
 *
 * Falls back to the `REDIS_URL` / `REDIS_PREFIX` env vars when the config path
 * above is not populated, preserving the proxy's historical behavior.
 *
 * @module extensions/ext-cache-redis
 */

import type { ExtensionFactory } from "veryfront/extensions";
import { RedisTokenCacheStore, type RedisTokenCacheStoreOptions } from "./redis-cache.ts";

interface RedisConfigShape {
  url?: string;
  prefix?: string;
  tls?: boolean;
  username?: string;
  password?: string;
  connectTimeout?: number;
}

function readRedisConfig(config: Record<string, unknown>): RedisConfigShape {
  const proxy = config.proxy as Record<string, unknown> | undefined;
  const cache = proxy?.cache as Record<string, unknown> | undefined;
  const redis = cache?.redis as RedisConfigShape | undefined;
  return redis ?? {};
}

function redactUrl(url: string): string {
  try {
    const u = new URL(url);
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "<redacted>";
  }
}

function readEnv(name: string): string | undefined {
  try {
    const value = Deno.env.get(name);
    return value && value.length > 0 ? value : undefined;
  } catch {
    // Deno.env requires --allow-env; treat missing perms as "no override".
    return undefined;
  }
}

const extRedis: ExtensionFactory = () => {
  let store: RedisTokenCacheStore | null = null;

  return {
    name: "ext-cache-redis",
    version: "0.1.0",
    contracts: {
      provides: ["TokenCacheStore"],
    },
    capabilities: [
      { type: "net:outbound", hosts: ["*"] },
    ],

    async setup(ctx) {
      const cfg = readRedisConfig(ctx.config);
      const url = cfg.url ?? readEnv("REDIS_URL");

      if (!url) {
        ctx.logger.info(
          "[ext-cache-redis] REDIS_URL not configured — skipping TokenCacheStore registration",
        );
        return;
      }

      const options: RedisTokenCacheStoreOptions = {
        url,
        prefix: cfg.prefix ?? readEnv("REDIS_PREFIX") ?? undefined,
        tls: cfg.tls,
        username: cfg.username,
        password: cfg.password ?? readEnv("REDIS_PASSWORD"),
        connectTimeout: cfg.connectTimeout,
      };

      store = new RedisTokenCacheStore(options, { logger: ctx.logger });
      ctx.provide("TokenCacheStore", store);
      ctx.logger.info(
        `[ext-cache-redis] TokenCacheStore registered (url=${redactUrl(options.url)})`,
      );
    },

    async teardown() {
      if (store) {
        try {
          await store.close();
        } finally {
          store = null;
        }
      }
    },
  };
};

export default extRedis;
export { RedisTokenCacheStore } from "./redis-cache.ts";
export type { RedisTokenCacheStoreOptions } from "./redis-cache.ts";
