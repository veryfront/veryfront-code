import * as dntShim from "../../../../_dnt.shims.js";
import { serverLogger } from "../../../utils/index.js";
import { isDeno } from "../runtime.js";
import { MemoryKv } from "./memory-adapter.js";
import { SqliteKv } from "./sqlite-adapter.js";
import type { Kv } from "./types.js";

interface GlobalWithDenoKv {
  Deno?: {
    openKv?: (path?: string) => Promise<Kv>;
  };
}

export async function openKv(path?: string): Promise<Kv> {
  if (isDeno) {
    const global = dntShim.dntGlobalThis as GlobalWithDenoKv;
    const open = global.Deno?.openKv;

    if (typeof open === "function") {
      try {
        return await open(path);
      } catch (error) {
        serverLogger.debug("Native Deno KV failed, trying other options:", error);
      }
    }
  }

  try {
    const Database = (await import("better-sqlite3")).default;
    const db = new Database(path ?? ":memory:");
    return new SqliteKv(db);
  } catch (error) {
    serverLogger.debug("SQLite not available, using memory KV:", error);
  }

  return new MemoryKv();
}

export function createKVStore(options?: { path?: string }): Promise<Kv> {
  return openKv(options?.path);
}

export function polyfillDenoKv(): void {
  if (isDeno) return;

  const global = dntShim.dntGlobalThis as GlobalWithDenoKv;
  global.Deno ??= {};
  global.Deno.openKv ??= openKv;
}
