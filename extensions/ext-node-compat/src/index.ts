/**
 * ext-node-compat — Node.js compatibility shims for Veryfront.
 *
 * Provides the `NodeCompat` contract:
 * - `importKreuzberg()` — document extraction via `@kreuzberg/wasm` (Deno)
 *   or `@kreuzberg/node` (Node/Bun).
 * - `openSqliteDatabase(path?)` — SQLite-backed persistent storage via
 *   `better-sqlite3`.
 *
 * Without this extension, core falls back to in-memory KV and document
 * extraction is unavailable.
 *
 * @module extensions/ext-node-compat
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type {
  KreuzbergExtractor,
  NodeCompat,
  NodeCompatSqliteDatabase,
} from "veryfront/extensions/interfaces";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type KreuzbergModule = {
  initWasm?: () => Promise<void>;
  extractBytes: (
    data: Uint8Array,
    mimeType: string,
  ) => Promise<{ content: string }>;
};

// ---------------------------------------------------------------------------
// Kreuzberg helper (moved from src/platform/compat/opaque-deps.ts)
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
async function loadKreuzbergNode(): Promise<any> {
  // Node / Bun: resolve @kreuzberg/node from node_modules.
  // Regular dynamic import so bundlers can optionally trace it.
  return await import("@kreuzberg/node");
}

async function loadKreuzberg(): Promise<KreuzbergExtractor> {
  // Detect Deno runtime.
  const isDeno = typeof Deno !== "undefined";

  if (!isDeno) {
    // Node / Bun path — @kreuzberg/node installed in node_modules.
    return loadKreuzbergNode();
  }

  // Deno path: use the import map entry in the root deno.json.
  // This regular import() is visible to `deno compile` so the WASM bundle
  // gets embedded in the compiled binary.
  const mod = await import("@kreuzberg/wasm") as unknown as KreuzbergModule;

  // Detect compiled binary: Deno.mainModule ends with ".ts" in dev, not in a binary.
  const mainModule = typeof (Deno as { mainModule?: string }).mainModule === "string"
    ? (Deno as { mainModule?: string }).mainModule!
    : "";
  const isDenoCompiled = mainModule !== "" && !mainModule.endsWith(".ts");

  if (isDenoCompiled) {
    // Pre-import the WASM glue and pdfium shim so kreuzberg's internal
    // computed import() calls resolve from Deno's in-process module cache
    // rather than failing on a missing file in the compiled binary.
    await import("#kreuzberg-wasm-glue");
    try {
      const kreuzbergUrl = import.meta.resolve("@kreuzberg/wasm");
      // Resolve pdfium.js relative to the kreuzberg package root.
      // We use a computed URL so this stays invisible to static analysis;
      // the important cache-warming step is the import itself.
      const pdfiumUrl = new URL("./pdfium.js", kreuzbergUrl).href;
      // deno compile cannot trace this computed URL, which is intentional:
      // failure is non-fatal and only degrades PDF extraction.
      await import(pdfiumUrl);
    } catch {
      // Non-fatal: PDF extraction may be degraded but other formats work.
    }
  }

  await mod.initWasm?.();
  return mod;
}

// ---------------------------------------------------------------------------
// SQLite helper
// ---------------------------------------------------------------------------

async function loadSqliteDatabase(path?: string): Promise<NodeCompatSqliteDatabase> {
  // better-sqlite3 is a native Node addon available via the extension's
  // import map entry.  Dynamic import lets us catch load failures gracefully.
  const mod = await import("better-sqlite3");
  // deno-lint-ignore no-explicit-any
  const DatabaseCtor = (mod as any).default ?? mod;
  // deno-lint-ignore no-explicit-any
  return new DatabaseCtor(path ?? ":memory:") as any as NodeCompatSqliteDatabase;
}

// ---------------------------------------------------------------------------
// NodeCompat implementation
// ---------------------------------------------------------------------------

class NodeCompatImpl implements NodeCompat {
  importKreuzberg(): Promise<KreuzbergExtractor> {
    return loadKreuzberg();
  }

  openSqliteDatabase(path?: string): Promise<NodeCompatSqliteDatabase> {
    return loadSqliteDatabase(path);
  }
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

const extNodeCompat: ExtensionFactory = () => {
  const impl = new NodeCompatImpl();

  return {
    name: "ext-node-compat",
    version: "0.1.0",
    capabilities: [
      { type: "contract", name: "NodeCompat" },
      { type: "fs", read: true, write: true },
    ],

    setup(ctx) {
      ctx.provide("NodeCompat", impl);
      ctx.logger.info("[ext-node-compat] NodeCompat registered");
    },
  };
};

export default extNodeCompat;
export { NodeCompatImpl };
