/**
 * ext-node-compatibility — Node.js compatibility shims for Veryfront.
 *
 * Provides the `NodeCompat` contract:
 * - `importKreuzberg()` — document extraction via `@kreuzberg/wasm` (Deno)
 *   or `@kreuzberg/node` (Node/Bun).
 * - `extractInWorker(buffer, mimeType)` — runs kreuzberg extraction in an
 *   isolated Deno Worker so a hung WASM call cannot block the server.
 * - `openSqliteDatabase(path?)` — SQLite-backed persistent storage via
 *   `better-sqlite3`.
 *
 * Without this extension, core falls back to in-memory KV and document
 * extraction is unavailable.
 *
 * @module extensions/ext-node-compatibility
 */

import type { ExtensionFactory } from "veryfront/extensions";
import type {
  KreuzbergExtractor,
  NodeCompat,
  NodeCompatSqliteDatabase,
} from "veryfront/extensions/compat";
import { loadKreuzberg } from "./kreuzberg.ts";

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
// Worker-based extraction (Deno only)
// ---------------------------------------------------------------------------

/** Maximum time to wait for document text extraction before aborting. */
const EXTRACTION_TIMEOUT_MS = 30_000;

function extractInWorkerDeno(
  buffer: ArrayBuffer,
  mimeType: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    // Static URL literal so `deno compile` traces the worker script into
    // the binary's embedded module graph.
    const workerUrl = new URL("./upload-extraction-worker.ts", import.meta.url);
    const worker = new Worker(workerUrl, { type: "module" });

    const timer = setTimeout(() => {
      worker.terminate();
      reject(
        new Error(
          `Text extraction timed out after ${
            EXTRACTION_TIMEOUT_MS / 1000
          }s — the file may be corrupted or unsupported`,
        ),
      );
    }, EXTRACTION_TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent) => {
      clearTimeout(timer);
      worker.terminate();
      const { content, error } = event.data as { content?: string; error?: string };
      if (error) {
        reject(new Error(error));
      } else {
        resolve(content ?? "");
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timer);
      worker.terminate();
      reject(new Error(`Text extraction worker failed: ${event.message ?? "unknown"}`));
    };

    worker.postMessage({ buffer, mimeType }, [buffer]);
  });
}

// ---------------------------------------------------------------------------
// NodeCompat implementation
// ---------------------------------------------------------------------------

class NodeCompatImpl implements NodeCompat {
  importKreuzberg(): Promise<KreuzbergExtractor> {
    return loadKreuzberg();
  }

  async extractInWorker(buffer: ArrayBuffer, mimeType: string): Promise<string> {
    const isDeno = typeof Deno !== "undefined";
    if (!isDeno) {
      // Node/Bun: @kreuzberg/node uses native bindings — no WASM hang risk,
      // no global Worker needed. Call kreuzberg directly.
      const { extractBytes } = await loadKreuzberg();
      const result = await extractBytes(new Uint8Array(buffer), mimeType);
      return result.content;
    }
    return extractInWorkerDeno(buffer, mimeType);
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
    name: "ext-node-compatibility",
    version: "0.1.0",
    capabilities: [
      { type: "contract", name: "NodeCompat" },
      { type: "fs", read: true, write: true },
    ],

    setup(ctx) {
      ctx.provide("NodeCompat", impl);
      ctx.logger.info("[ext-node-compatibility] NodeCompat registered");
    },
  };
};

export default extNodeCompat;
export { NodeCompatImpl };
