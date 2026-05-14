# @veryfront/ext-db-sqlite

> **Category:** Storage | **Contract:** `SqliteStore` | **Built-in**

SQLite-backed storage for Veryfront via better-sqlite3.

This extension registers the `SqliteStore` contract and keeps better-sqlite3
out of core.

```ts
import extDbSqlite from "@veryfront/ext-db-sqlite";

export default {
  extensions: [extDbSqlite()],
};
```
