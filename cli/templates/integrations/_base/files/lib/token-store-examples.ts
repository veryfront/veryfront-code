/**
 * Reference backends for `createEncryptedTokenStore` in
 * `encrypted-token-store.ts`.
 *
 * The in-memory backend below is for local development and tests only: it is
 * process-local, so tokens vanish on restart and are not shared across
 * workers. For production, implement `EncryptedKvBackend` over a durable
 * service and wire it once during startup:
 *
 * ```ts
 * import { configureTokenStore } from "./token-store.ts";
 * import { createEncryptedTokenStore } from "./encrypted-token-store.ts";
 *
 * configureTokenStore(createEncryptedTokenStore(myDurableBackend));
 * ```
 *
 * A Redis-shaped backend maps naturally onto the contract:
 *
 * ```ts
 * const redisBackend: EncryptedKvBackend = {
 *   get: (key) => redis.get(key),
 *   set: async (key, value, options) => {
 *     await (options?.expiresInMs
 *       ? redis.set(key, value, { px: options.expiresInMs })
 *       : redis.set(key, value));
 *   },
 *   delete: async (key) => {
 *     await redis.del(key);
 *   },
 *   // Run WATCH/MULTI or a small Lua script so the comparison and the write
 *   // are one atomic step on the server.
 *   compareAndSwap: (key, expected, next, options) =>
 *     redisCompareAndSwapScript(key, expected, next, options?.expiresInMs),
 *   // Use a bounded lease (for example SET NX PX plus a fenced release) so
 *   // a crashed holder cannot block token refresh forever.
 *   withLock: (key, operation) => redisWithLease(key, operation),
 * };
 * ```
 */

import type { EncryptedKvBackend } from "./encrypted-token-store.ts";

function isProductionRuntime(): boolean {
  if (typeof process !== "undefined") return process.env?.NODE_ENV === "production";
  return (globalThis as { Deno?: { env?: { get?: (name: string) => string | undefined } } }).Deno
    ?.env?.get?.("NODE_ENV") === "production";
}

interface MemoryRow {
  value: string;
  expiresAt: number | null;
}

/**
 * Development-only in-memory backend. Values are still encrypted (the store
 * requires `TOKEN_ENCRYPTION_KEY` in every mode) but nothing is durable and
 * nothing is shared across workers, so creation is refused in production.
 */
export function createMemoryKvBackend(): EncryptedKvBackend {
  if (isProductionRuntime()) {
    throw new Error(
      "The in-memory example backend is not allowed in production. Implement " +
        "EncryptedKvBackend over a durable service (Redis, Postgres, Deno KV).",
    );
  }

  const rows = new Map<string, MemoryRow>();
  const lockTails = new Map<string, Promise<void>>();

  function readRow(key: string): string | null {
    const row = rows.get(key);
    if (!row) return null;
    if (row.expiresAt !== null && Date.now() >= row.expiresAt) {
      rows.delete(key);
      return null;
    }
    return row.value;
  }

  function writeRow(key: string, value: string, expiresInMs?: number): void {
    rows.set(key, {
      value,
      expiresAt: expiresInMs === undefined ? null : Date.now() + expiresInMs,
    });
  }

  return {
    get(key) {
      return Promise.resolve(readRow(key));
    },
    set(key, value, options) {
      writeRow(key, value, options?.expiresInMs);
      return Promise.resolve();
    },
    delete(key) {
      rows.delete(key);
      return Promise.resolve();
    },
    compareAndSwap(key, expected, next, options) {
      // No await between comparison and write: within one process this block
      // is indivisible, which is exactly the guarantee the contract asks a
      // distributed backend to provide server-side.
      if (readRow(key) !== expected) return Promise.resolve(false);
      if (next === null) rows.delete(key);
      else writeRow(key, next, options?.expiresInMs);
      return Promise.resolve(true);
    },
    async withLock(key, operation) {
      const prior = lockTails.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tail = prior.catch(() => undefined).then(() => current);
      lockTails.set(key, tail);

      await prior.catch(() => undefined);
      try {
        return await operation();
      } finally {
        release();
        if (lockTails.get(key) === tail) lockTails.delete(key);
      }
    },
  };
}
