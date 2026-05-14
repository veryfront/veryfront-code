# @veryfront/ext-node-compatibility

> **Category:** Infrastructure | **Contract:** `NodeCompat` | **Built-in**

Provides Node.js compatibility shims for Veryfront — SQLite-backed persistence and document text extraction (PDF, DOCX, images) via Kreuzberg.

## Registration

This extension is auto-enabled by core bootstrap. Add it to `veryfront.config.ts` only when you need to override the built-in registration:

```ts
import extNodeCompat from "@veryfront/ext-node-compatibility";

export default defineConfig({
  extensions: [extNodeCompat()],
});
```

## Provided contract

`NodeCompat` — exposes:

- `openSqliteDatabase(path?)` — opens a SQLite database via `better-sqlite3`. Defaults to `:memory:`; pass a file path for persistent storage.
- `importKreuzberg()` — loads the [Kreuzberg](https://kreuzberg.dev) document-text extractor. Uses `@kreuzberg/wasm` on Deno and `@kreuzberg/node` on Node / Bun.
- `extractInWorker(buffer, mimeType)` — runs Kreuzberg extraction inside an isolated Deno Worker with a 30-second timeout, so a hung WASM call cannot block the server.

## When you need this

- The Veryfront proxy / KV layer falls back to in-memory storage when this contract is unavailable. Use this extension for persistent local development storage or any production deployment that does not have an external KV backing.
- Document upload and text-extraction features (PDF, DOCX, images, etc.) are unavailable without it.

## Capabilities

- **fs (read + write):** SQLite database files and Kreuzberg temporary files.

## Configuration

No factory options. The SQLite database path is passed per-call to `openSqliteDatabase`.
