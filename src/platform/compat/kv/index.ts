/**
 * Compat - Kv
 *
 * @module platform/compat/kv
 */

export { createKVStore, openKv, polyfillDenoKv } from "./factory.ts";
export type { CreateKVStoreOptions, KvBackend, OpenKvOptions } from "./factory.ts";
export { MemoryKv } from "./memory-adapter.ts";
export { SqliteKv } from "./sqlite-adapter.ts";
export { KV_PORTABLE_LIMITS } from "./types.ts";
export type { Kv, KvEntry, KvJsonValue, KvListOptions, SqliteDatabase } from "./types.ts";
