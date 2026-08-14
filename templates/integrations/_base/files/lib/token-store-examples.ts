/**
 * Reference backends for `createEncryptedTokenStore` in
 * `encrypted-token-store.ts`.
 *
 * The in-memory backend below is for local development and tests only: it is
 * process-local, so tokens vanish on restart and are not shared across
 * workers. For production, implement `EncryptedKvBackend` over a durable
 * service and pass it into startup through an explicit configuration
 * boundary. This example is complete and does not rely on module globals:
 *
 * ```ts
 * import { configureTokenStore } from "./token-store.ts";
 * import {
 *   createEncryptedTokenStore,
 *   type EncryptedKvBackend,
 * } from "./encrypted-token-store.ts";
 *
 * export function configureOAuthStorage(backend: EncryptedKvBackend): void {
 *   configureTokenStore(createEncryptedTokenStore(backend));
 * }
 * ```
 *
 * Redis adapter sketch (pseudocode, not a paste-ready client): replace every
 * angle-bracketed operation with the equivalent atomic operation from your
 * initialized Redis client.
 *
 * ```text
 * const redisBackend: EncryptedKvBackend = {
 *   get: (key) => <redis client get>(key),
 *   set: async (key, value, options) => {
 *     await <redis client set>(key, value, options?.expiresInMs);
 *   },
 *   delete: (key) => <redis client delete>(key),
 *   compareAndSwap: (key, expected, next, options) =>
 *     <atomic WATCH/MULTI or Lua CAS>(key, expected, next, options?.expiresInMs),
 *   withLock: (key, operation) =>
 *     <bounded, renewable, fenced Redis lease>(key, operation),
 * };
 * ```
 */

import type { EncryptedKvBackend } from "./encrypted-token-store.ts";

function runtimeMode(): string | undefined {
  try {
    if (typeof process !== "undefined" && process.env) return process.env.NODE_ENV;
  } catch {
    // Deno exposes the Node-compatible `process` global even when env access
    // is denied. Preserve the fail-closed mode decision in that runtime.
    return undefined;
  }
  try {
    return (globalThis as { Deno?: { env?: { get?: (name: string) => string | undefined } } })
      .Deno?.env?.get?.("NODE_ENV");
  } catch {
    return undefined;
  }
}

interface MemoryRow {
  value: string;
  expiresAt: number | null;
}

/**
 * Development/test in-memory backend. Values are still encrypted (the store
 * requires `TOKEN_ENCRYPTION_KEY` in every mode) but nothing is durable and
 * nothing is shared across workers, so creation is refused in production.
 */
export function createMemoryKvBackend(): EncryptedKvBackend {
  const mode = runtimeMode();
  if (mode !== "development" && mode !== "test") {
    throw new Error(
      mode === "production"
        ? "The in-memory example backend is not allowed in production. Implement " +
          "EncryptedKvBackend over a durable service (Redis, Postgres, Deno KV)."
        : "The in-memory example backend requires an explicit development or test " +
          "runtime. Set NODE_ENV accordingly, or implement EncryptedKvBackend over " +
          "a durable service (Redis, Postgres, Deno KV).",
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
