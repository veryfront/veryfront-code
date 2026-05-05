import { tryResolve } from "#veryfront/extensions/contracts.ts";
import { serverLogger } from "#veryfront/utils";
import { isDeno } from "../runtime.ts";
import { MemoryKv } from "./memory-adapter.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { Kv, SqliteDatabase } from "./types.ts";
import type { NodeCompat } from "#veryfront/extensions/interfaces/node-compat.ts";

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

  const nodeCompat = tryResolve<NodeCompat>("NodeCompat");
  if (nodeCompat?.openSqliteDatabase) {
    try {
      const db = await nodeCompat.openSqliteDatabase(path);
      // NodeCompatSqliteDatabase is structurally identical to SqliteDatabase;
      // cast to satisfy the SqliteKv constructor's nominal type check.
      return new SqliteKv(db as unknown as SqliteDatabase);
    } catch (error) {
      serverLogger.debug("NodeCompat.openSqliteDatabase failed, using memory KV:", error);
    }
  } else {
    serverLogger.debug(
      "NodeCompat extension not registered — SQLite KV unavailable. " +
        "Install @veryfront/ext-node-compat to enable SQLite-backed KV.",
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
