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

export async function openKv(path?: string): Promise<Kv> {
  if (isDeno) {
    const global = globalThis as GlobalWithDenoKv;
    const open = global.Deno?.openKv;

    if (typeof open === "function") {
      try {
        return await open(path);
      } catch (error) {
        serverLogger.debug("Native Deno KV failed, trying other options:", error);
      }
    }
  }

  const sqliteStore = tryResolve<SqliteStore>("SqliteStore");
  if (sqliteStore?.openSqliteDatabase) {
    try {
      const db = await sqliteStore.openSqliteDatabase(path);
      // Extension SqliteDatabase is structurally identical to SqliteDatabase;
      // cast to satisfy the SqliteKv constructor's nominal type check.
      return new SqliteKv(db as unknown as SqliteDatabase);
    } catch (error) {
      serverLogger.debug("SqliteStore.openSqliteDatabase failed, using memory KV:", error);
    }
  } else {
    serverLogger.debug(
      "SqliteStore extension not registered. SQLite KV unavailable. " +
        "Install @veryfront/ext-db-sqlite to enable SQLite-backed KV.",
    );
  }

  return new MemoryKv();
}

export function createKVStore(options?: { path?: string }): Promise<Kv> {
  return openKv(options?.path);
}

export function polyfillDenoKv(): void {
  if (isDeno) return;

  const global = globalThis as GlobalWithDenoKv;
  global.Deno ??= {};
  global.Deno.openKv ??= openKv;
}
