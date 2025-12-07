/**
 * Production Token Store Examples
 *
 * Copy-paste implementations for different storage backends.
 * Each example includes encryption support via TOKEN_ENCRYPTION_KEY.
 *
 * @module
 */

import {
  createTokenStore,
  encryptToken,
  decryptToken,
  type TokenStore,
  type OAuthToken,
} from "./token-store";

// ============================================================================
// Vercel KV Store
// ============================================================================

/**
 * Token store using Vercel KV (Redis-compatible)
 *
 * Required environment variables:
 * - KV_REST_API_URL
 * - KV_REST_API_TOKEN
 * - TOKEN_ENCRYPTION_KEY (recommended)
 *
 * @example
 * ```typescript
 * // lib/token-store.ts
 * import { createVercelKVStore } from './token-store-examples';
 * export const tokenStore = createVercelKVStore();
 * ```
 */
export function createVercelKVStore(): TokenStore {
  // Dynamic import to avoid bundling @vercel/kv in non-Vercel environments
  let kvPromise: Promise<typeof import("@vercel/kv")> | null = null;

  const getKV = async () => {
    if (!kvPromise) {
      kvPromise = import("@vercel/kv");
    }
    return (await kvPromise).kv;
  };

  return createTokenStore({
    async get(key: string): Promise<string | null> {
      const kv = await getKV();
      return kv.get<string>(key);
    },
    async set(key: string, value: string): Promise<void> {
      const kv = await getKV();
      await kv.set(key, value);
    },
    async delete(key: string): Promise<void> {
      const kv = await getKV();
      await kv.del(key);
    },
  });
}

// ============================================================================
// Redis Store
// ============================================================================

/**
 * Token store using Redis
 *
 * Required environment variables:
 * - REDIS_URL (e.g., redis://localhost:6379)
 * - TOKEN_ENCRYPTION_KEY (recommended)
 *
 * @example
 * ```typescript
 * // lib/token-store.ts
 * import { createRedisStore } from './token-store-examples';
 * export const tokenStore = createRedisStore();
 * ```
 */
export function createRedisStore(): TokenStore {
  let clientPromise: Promise<ReturnType<typeof import("redis").createClient>> | null = null;

  const getClient = async () => {
    if (!clientPromise) {
      clientPromise = (async () => {
        const { createClient } = await import("redis");
        const client = createClient({ url: process.env.REDIS_URL });
        await client.connect();
        return client;
      })();
    }
    return clientPromise;
  };

  return createTokenStore({
    async get(key: string): Promise<string | null> {
      const client = await getClient();
      return client.get(key);
    },
    async set(key: string, value: string): Promise<void> {
      const client = await getClient();
      await client.set(key, value);
    },
    async delete(key: string): Promise<void> {
      const client = await getClient();
      await client.del(key);
    },
  });
}

// ============================================================================
// PostgreSQL Store
// ============================================================================

/**
 * Token store using PostgreSQL
 *
 * Required environment variables:
 * - DATABASE_URL (e.g., postgres://user:pass@host:5432/db)
 * - TOKEN_ENCRYPTION_KEY (recommended)
 *
 * Required table (create with migration):
 * ```sql
 * CREATE TABLE oauth_tokens (
 *   key VARCHAR(255) PRIMARY KEY,
 *   value TEXT NOT NULL,
 *   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
 *   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
 * );
 * CREATE INDEX idx_oauth_tokens_key ON oauth_tokens(key);
 * ```
 *
 * @example
 * ```typescript
 * // lib/token-store.ts
 * import { createPostgresStore } from './token-store-examples';
 * export const tokenStore = createPostgresStore();
 * ```
 */
export function createPostgresStore(): TokenStore {
  let poolPromise: Promise<import("pg").Pool> | null = null;

  const getPool = async () => {
    if (!poolPromise) {
      poolPromise = (async () => {
        const { Pool } = await import("pg");
        return new Pool({ connectionString: process.env.DATABASE_URL });
      })();
    }
    return poolPromise;
  };

  return createTokenStore({
    async get(key: string): Promise<string | null> {
      const pool = await getPool();
      const result = await pool.query(
        "SELECT value FROM oauth_tokens WHERE key = $1",
        [key]
      );
      return result.rows[0]?.value ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      const pool = await getPool();
      await pool.query(
        `INSERT INTO oauth_tokens (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, value]
      );
    },
    async delete(key: string): Promise<void> {
      const pool = await getPool();
      await pool.query("DELETE FROM oauth_tokens WHERE key = $1", [key]);
    },
  });
}

// ============================================================================
// SQLite Store (for edge/serverless with D1, Turso, etc.)
// ============================================================================

/**
 * Token store using SQLite (Cloudflare D1, Turso, better-sqlite3)
 *
 * Required table:
 * ```sql
 * CREATE TABLE oauth_tokens (
 *   key TEXT PRIMARY KEY,
 *   value TEXT NOT NULL,
 *   updated_at INTEGER DEFAULT (strftime('%s', 'now'))
 * );
 * ```
 *
 * @param db - SQLite database instance (D1Database, Connection, or Database)
 *
 * @example With Cloudflare D1
 * ```typescript
 * // In your API route
 * export async function GET(request: Request, { env }) {
 *   const tokenStore = createSQLiteStore(env.DB);
 *   // ...
 * }
 * ```
 *
 * @example With Turso
 * ```typescript
 * import { createClient } from '@libsql/client';
 * const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_AUTH_TOKEN });
 * export const tokenStore = createSQLiteStore(db);
 * ```
 */
export function createSQLiteStore(db: {
  prepare(sql: string): { bind(...args: unknown[]): { first(): Promise<{ value?: string } | null>; run(): Promise<void> } };
}): TokenStore {
  return createTokenStore({
    async get(key: string): Promise<string | null> {
      const result = await db
        .prepare("SELECT value FROM oauth_tokens WHERE key = ?")
        .bind(key)
        .first();
      return result?.value ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      await db
        .prepare(
          `INSERT OR REPLACE INTO oauth_tokens (key, value, updated_at)
           VALUES (?, ?, strftime('%s', 'now'))`
        )
        .bind(key, value)
        .run();
    },
    async delete(key: string): Promise<void> {
      await db
        .prepare("DELETE FROM oauth_tokens WHERE key = ?")
        .bind(key)
        .run();
    },
  });
}

// ============================================================================
// Cloudflare Workers KV Store
// ============================================================================

/**
 * Token store using Cloudflare Workers KV
 *
 * @param kv - KV namespace binding from worker environment
 *
 * @example
 * ```typescript
 * // In your worker
 * export default {
 *   async fetch(request, env) {
 *     const tokenStore = createWorkersKVStore(env.OAUTH_TOKENS);
 *     // ...
 *   }
 * };
 * ```
 */
export function createWorkersKVStore(kv: {
  get(key: string): Promise<string | null>;
  put(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}): TokenStore {
  return createTokenStore({
    get: (key) => kv.get(key),
    set: (key, value) => kv.put(key, value),
    delete: (key) => kv.delete(key),
  });
}

// ============================================================================
// Prisma Store
// ============================================================================

/**
 * Token store using Prisma ORM
 *
 * Required Prisma schema:
 * ```prisma
 * model OAuthToken {
 *   key       String   @id
 *   value     String
 *   updatedAt DateTime @updatedAt
 * }
 * ```
 *
 * @example
 * ```typescript
 * import { PrismaClient } from '@prisma/client';
 * const prisma = new PrismaClient();
 * export const tokenStore = createPrismaStore(prisma);
 * ```
 */
export function createPrismaStore(prisma: {
  oAuthToken: {
    findUnique(args: { where: { key: string } }): Promise<{ value: string } | null>;
    upsert(args: { where: { key: string }; update: { value: string }; create: { key: string; value: string } }): Promise<unknown>;
    delete(args: { where: { key: string } }): Promise<unknown>;
  };
}): TokenStore {
  return createTokenStore({
    async get(key: string): Promise<string | null> {
      const record = await prisma.oAuthToken.findUnique({ where: { key } });
      return record?.value ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      await prisma.oAuthToken.upsert({
        where: { key },
        update: { value },
        create: { key, value },
      });
    },
    async delete(key: string): Promise<void> {
      try {
        await prisma.oAuthToken.delete({ where: { key } });
      } catch {
        // Ignore if not found
      }
    },
  });
}

// ============================================================================
// Drizzle ORM Store
// ============================================================================

/**
 * Token store using Drizzle ORM
 *
 * Required schema:
 * ```typescript
 * import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
 *
 * export const oauthTokens = pgTable('oauth_tokens', {
 *   key: text('key').primaryKey(),
 *   value: text('value').notNull(),
 *   updatedAt: timestamp('updated_at').defaultNow(),
 * });
 * ```
 *
 * @example
 * ```typescript
 * import { drizzle } from 'drizzle-orm/postgres-js';
 * import postgres from 'postgres';
 * import { oauthTokens } from './schema';
 *
 * const client = postgres(process.env.DATABASE_URL!);
 * const db = drizzle(client);
 * export const tokenStore = createDrizzleStore(db, oauthTokens);
 * ```
 */
export function createDrizzleStore<T extends { key: unknown; value: unknown }>(
  db: {
    select(): { from(table: T): { where(condition: unknown): { get(): Promise<{ value: string } | undefined> } } };
    insert(table: T): { values(data: { key: string; value: string }): { onConflictDoUpdate(args: { target: unknown; set: { value: string } }): { execute(): Promise<void> } } };
    delete(table: T): { where(condition: unknown): { execute(): Promise<void> } };
  },
  table: T & { key: unknown; value: unknown },
  eq: (col: unknown, val: unknown) => unknown
): TokenStore {
  return createTokenStore({
    async get(key: string): Promise<string | null> {
      const result = await db
        .select()
        .from(table)
        .where(eq(table.key, key))
        .get();
      return result?.value ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      await db
        .insert(table)
        .values({ key, value })
        .onConflictDoUpdate({ target: table.key, set: { value } })
        .execute();
    },
    async delete(key: string): Promise<void> {
      await db.delete(table).where(eq(table.key, key)).execute();
    },
  });
}

// ============================================================================
// Auto-Select Store (Recommended)
// ============================================================================

/**
 * Automatically selects the appropriate token store based on environment
 *
 * Detection order:
 * 1. DATABASE_URL -> PostgreSQL
 * 2. KV_REST_API_URL -> Vercel KV
 * 3. REDIS_URL -> Redis
 * 4. Fallback -> In-memory (development only)
 *
 * @example
 * ```typescript
 * // lib/token-store.ts
 * import { createAutoStore } from './token-store-examples';
 * export const tokenStore = createAutoStore();
 * ```
 */
export function createAutoStore(): TokenStore {
  const env = process.env;

  if (env.DATABASE_URL) {
    console.log("[Token Store] Using PostgreSQL storage");
    return createPostgresStore();
  }

  if (env.KV_REST_API_URL && env.KV_REST_API_TOKEN) {
    console.log("[Token Store] Using Vercel KV storage");
    return createVercelKVStore();
  }

  if (env.REDIS_URL) {
    console.log("[Token Store] Using Redis storage");
    return createRedisStore();
  }

  // Fallback to in-memory (imported from main module)
  console.warn(
    "[Token Store] No production storage configured. " +
    "Using in-memory storage (tokens will be lost on restart). " +
    "Set DATABASE_URL, KV_REST_API_URL, or REDIS_URL for production."
  );

  // Return in-memory store from main module
  const { tokenStore } = require("./token-store");
  return tokenStore;
}
