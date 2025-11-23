import { MemoryKv } from "./memory-adapter.ts";
import { SqliteKv } from "./sqlite-adapter.ts";
import type { Kv } from "./types.ts";
import { serverLogger } from "@veryfront/utils";

/** Type-safe global with Deno KV support */
interface GlobalWithDenoKv {
  Deno?: {
    openKv?: (path?: string) => Promise<Kv>;
  };
}

const isDeno = typeof Deno !== "undefined";

/**
 * Opens a KV store using native Deno KV or polyfill fallbacks.
 * Clean implementation following KISS principle.
 */
export async function openKv(path?: string): Promise<Kv> {
  const global = globalThis as GlobalWithDenoKv;

  // Try native Deno KV first if available
  if (isDeno && typeof global.Deno?.openKv === "function") {
    try {
      return await global.Deno.openKv(path);
    } catch (error) {
      // Log the error for debugging, then fall through to polyfill
      serverLogger.debug("Native Deno KV not available, using polyfill:", error);
    }
  }

  // Try SQLite-based KV
  try {
    const Database = (await import("better-sqlite3")).default;
    const dbPath = path || ":memory:";
    const db = new Database(dbPath);
    return new SqliteKv(db);
  } catch (error) {
    // Log the error and fall back to memory KV
    serverLogger.debug("SQLite not available, using memory KV:", error);
    return new MemoryKv();
  }
}

export async function createKVStore(options?: { path?: string }) {
  return await openKv(options?.path);
}

/**
 * Polyfills Deno.openKv for non-Deno environments.
 * Simple and clear without unnecessary type assertions.
 */
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
