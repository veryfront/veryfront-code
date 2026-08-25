import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { serverLogger } from "#veryfront/utils";
import { isDeno } from "../runtime.ts";
import { MemoryKv } from "./memory-adapter.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { Kv, SqliteDatabase } from "./types.ts";
import type { SqliteStore } from "#veryfront/extensions/compat/native-services.ts";

interface GlobalWithDenoKv {
  Deno?: {
    openKv?: (path?: string) => Promise<Kv>;
  };
}

/**
 * Open a cross-runtime KV store.
 *
 * An explicit path requests durable storage and fails if no durable backend can
 * open it. Omit the path, or use `:memory:`, to permit a volatile memory store.
 */
export async function openKv(path?: string): Promise<Kv> {
  const requiresDurableBackend = path !== undefined && path !== ":memory:";
  const backendFailures: unknown[] = [];

  if (isDeno) {
    const global = globalThis as GlobalWithDenoKv;
    const open = global.Deno?.openKv;

    if (typeof open === "function") {
      try {
        return await open(path);
      } catch (error) {
        backendFailures.push(error);
        serverLogger.warn("Native Deno KV failed, trying other options:", error);
      }
    }
  }

  const sqliteStore = tryResolve<SqliteStore>("SqliteStore");
  if (sqliteStore?.openSqliteDatabase) {
    try {
      const db = await sqliteStore.openSqliteDatabase(path);
      // Extension SqliteDatabase is structurally identical to SqliteDatabase;
      // cast to satisfy the SqliteKv constructor's nominal type check.
      return new SqliteKv(db as SqliteDatabase);
    } catch (error) {
      backendFailures.push(error);
      serverLogger.warn(
        "SqliteStore.openSqliteDatabase failed:",
        error,
      );
    }
  } else {
    serverLogger.debug(
      "SqliteStore extension not registered. SQLite KV unavailable. " +
        "Install @veryfront/ext-db-sqlite to enable SQLite-backed KV.",
    );
  }

  if (requiresDurableBackend) {
    const message = `Could not open a durable KV store for explicit path "${path}". ` +
      "Configure native Deno KV or install @veryfront/ext-db-sqlite.";
    if (backendFailures.length) throw new AggregateError(backendFailures, message);
    throw new Error(message);
  }

  // In-memory KV: all data is lost on process restart. Log at warn so operators
  // can detect unintentional memory-only mode in production.
  serverLogger.warn(
    "openKv: falling back to in-memory KV store — data will not persist across restarts. " +
      "Configure Deno KV or install @veryfront/ext-db-sqlite for durable storage.",
  );
  return new MemoryKv();
}

/**
 * Create a cross-runtime KV store.
 *
 * An explicit path requests durable storage and fails if no durable backend can
 * open it. Omit the path, or use `:memory:`, to permit a volatile memory store.
 */
export function createKVStore(options?: { path?: string }): Promise<Kv> {
  return openKv(options?.path);
}

export function polyfillDenoKv(): void {
  if (isDeno) return;

  const global = globalThis as GlobalWithDenoKv;
  global.Deno ??= {};
  global.Deno.openKv ??= openKv;
}
