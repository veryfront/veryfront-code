# @veryfront/ext-db-sqlite

> **Category:** Storage | **Contract:** `SqliteStore` | **Built-in**

SQLite-backed storage for Veryfront via better-sqlite3.

This extension registers the `SqliteStore` contract and keeps better-sqlite3 out
of core.

## Supply-chain boundary

This extension is a sensitive native storage boundary. Keep `better-sqlite3`,
`@types/better-sqlite3`, and related native SQLite dependencies in this
extension instead of importing them from core, CLI, React, or unrelated
extensions.

```ts
import extDbSqlite from "@veryfront/ext-db-sqlite";

export default {
  extensions: [extDbSqlite()],
};
```
