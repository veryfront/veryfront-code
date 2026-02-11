/**
 * Compat - Kv
 *
 * @module platform/compat/kv
 */

export { createKVStore, openKv, polyfillDenoKv } from "./factory.ts";
export { MemoryKv } from "./memory-adapter.ts";
export { SqliteKv } from "./sqlite-adapter.ts";
export type { Kv, KvEntry, KvListOptions, SqliteDatabase } from "./types.ts";
