import { MemoryKv } from "./memory-adapter.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { Kv } from "./types.ts";
import { serverLogger } from "@veryfront/utils";
import { isDeno } from "../runtime.ts";

interface GlobalWithDenoKv {
  Deno?: {
    openKv?: (path?: string) => Promise<Kv>;
  };
}

export async function openKv(path?: string): Promise<Kv> {
  const global = globalThis as GlobalWithDenoKv;

  if (isDeno && typeof global.Deno?.openKv === "function") {
    try {
      return await global.Deno.openKv(path);
    } catch (error) {
      serverLogger.debug("Native Deno KV not available, using polyfill:", error);
    }
  }

  try {
    const Database = (await import("better-sqlite3")).default;
    const dbPath = path || ":memory:";
    const db = new Database(dbPath);
    return new SqliteKv(db);
  } catch (error) {
    serverLogger.debug("SQLite not available, using memory KV:", error);
    return new MemoryKv();
  }
}

export async function createKVStore(options?: { path?: string }) {
  return await openKv(options?.path);
}

export function polyfillDenoKv() {
  if (!isDeno) {
    const global = globalThis as GlobalWithDenoKv;

    if (!global.Deno) {
      global.Deno = {};
    }

    if (!global.Deno.openKv) {
      global.Deno.openKv = openKv;
    }
  }
}
