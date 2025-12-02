import { MemoryKv } from "./memory-adapter.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { Kv } from "./types.ts";
import { serverLogger } from "@veryfront/utils";
import { isDeno } from "../runtime.ts";

interface GlobalWithDenoKv {
  Deno: {
    openKv: (path?: string) => Promise<Kv>;
  };
}

export async function openKv(path?: string): Promise<Kv> {
  // 1. Try native Deno KV
  if (isDeno) {
    const global = globalThis as unknown as GlobalWithDenoKv;
    if (typeof global.Deno?.openKv === "function") {
      try {
        return await global.Deno.openKv(path);
      } catch (error) {
        serverLogger.debug("Native Deno KV failed, trying other options:", error);
      }
    }
  }

  // 2. Try SQLite (Node.js/Bun compatible)
  try {
    const Database = (await import("better-sqlite3")).default;
    const dbPath = path || ":memory:";
    const db = new Database(dbPath);
    return new SqliteKv(db);
  } catch (error) {
    serverLogger.debug("SQLite not available, using memory KV:", error);
  }

  // 3. Fallback to in-memory KV
  return new MemoryKv();
}

export async function createKVStore(options?: { path?: string }) {
  return await openKv(options?.path);
}

export function polyfillDenoKv() {
  if (!isDeno) {
    const global = globalThis as unknown as GlobalWithDenoKv;

    if (!global.Deno) {
      global.Deno = {} as GlobalWithDenoKv["Deno"];
    }

    if (!global.Deno.openKv) {
      global.Deno.openKv = openKv;
    }
  }
}
