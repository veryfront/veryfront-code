
import {
  createTokenStore,
  encryptToken,
  decryptToken,
  type TokenStore,
  type OAuthToken,
} from "./token-store.ts";


export function createVercelKVStore(): TokenStore {
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
      }
    },
  });
}


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

  console.warn(
    "[Token Store] No production storage configured. " +
    "Using in-memory storage (tokens will be lost on restart). " +
    "Set DATABASE_URL, KV_REST_API_URL, or REDIS_URL for production."
  );

  const { tokenStore } = require("./token-store");
  return tokenStore;
}
