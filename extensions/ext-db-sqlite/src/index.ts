/**
 * ext-db-sqlite: SQLite-backed storage for Veryfront.
 *
 * Provides the `SqliteStore` contract via better-sqlite3.
 *
 * @module extensions/ext-db-sqlite
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { SqliteDatabase, SqliteStore } from "veryfront/extensions/compat";

async function loadSqliteDatabase(path?: string): Promise<SqliteDatabase> {
  const mod = await import("better-sqlite3");
  // deno-lint-ignore no-explicit-any
  const DatabaseCtor = (mod as any).default ?? mod;
  // deno-lint-ignore no-explicit-any
  return new DatabaseCtor(path ?? ":memory:") as any as SqliteDatabase;
}

export class BetterSqliteStore implements SqliteStore {
  openSqliteDatabase(path?: string): Promise<SqliteDatabase> {
    return loadSqliteDatabase(path);
  }
}

const extDbSqlite: ExtensionFactory = () => {
  const store = new BetterSqliteStore();

  return {
    name: "ext-db-sqlite",
    version: "0.1.0",
    contracts: {
      provides: ["SqliteStore"],
    },
    capabilities: [
      { type: "fs:read" },
      { type: "fs:write" },
    ],

    setup(ctx) {
      ctx.provide("SqliteStore", store);
      ctx.logger.info("[ext-db-sqlite] SQLite store registered");
    },
  };
};

export default extDbSqlite;
