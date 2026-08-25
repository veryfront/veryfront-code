/**
 * ext-db-sqlite: SQLite-backed storage for Veryfront.
 *
 * Provides the `SqliteStore` contract via better-sqlite3.
 *
 * @module extensions/ext-db-sqlite
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type { SqliteDatabase, SqliteStore } from "veryfront/extensions/compat";

type SqliteDatabaseCtor = new (path: string) => SqliteDatabase;

async function loadSqliteDatabase(path?: string): Promise<SqliteDatabase> {
  const mod = await import("better-sqlite3");
  const DatabaseCtor = ((mod as { default?: SqliteDatabaseCtor }).default ??
    mod) as SqliteDatabaseCtor;
  return new DatabaseCtor(path ?? ":memory:");
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
      ctx.logger.debug("[ext-db-sqlite] SQLite store registered");
    },
  };
};

export default extDbSqlite;
