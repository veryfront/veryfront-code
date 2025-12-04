import { assertEquals, assertMatch } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { loadHandlerModule } from "./loader.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createFileSystem } from "../../../platform/compat/fs.ts";

/**
 * Minimal adapter stub that reads files from the real fs via compat,
 * and fails other operations (we don't exercise server/kv here).
 */
const fs = createFileSystem();

const adapter: RuntimeAdapter = {
  id: "node",
  name: "node-stub",
  platform: "node",
  capabilities: {
    typescript: true,
    jsx: true,
    http2: true,
    websocket: true,
    workers: true,
    fileWatching: true,
    shell: true,
    kvStore: false,
    writableFs: true,
  },
  features: {
    websocket: true,
    http2: true,
    workers: true,
    jsx: true,
    typescript: true,
  },
  fs: {
    readFile: fs.readTextFile.bind(fs),
    writeFile: fs.writeTextFile.bind(fs),
    exists: fs.exists.bind(fs),
    async *readDir(path: string) {
      for await (const entry of fs.readDir(path)) {
        // Normalize to DirEntry shape
        yield {
          name: entry.name,
          isFile: entry.isFile,
          isDirectory: entry.isDirectory,
          isSymlink: "isSymlink" in entry ? (entry as any).isSymlink : false,
        };
      }
    },
    stat: fs.stat.bind(fs),
    mkdir: fs.mkdir.bind(fs),
    remove: fs.remove.bind(fs),
    makeTempDir: (prefix: string) => fs.makeTempDir({ prefix }),
    watch() {
      // Minimal watcher stub for tests
      return {
        async *[Symbol.asyncIterator]() {},
        close() {},
      };
    },
  },
  env: {
    get(key: string) {
      return Deno.env.get(key);
    },
    set(key: string, value: string) {
      Deno.env.set(key, value);
    },
    toObject() {
      return Deno.env.toObject();
    },
  },
  server: {
    upgradeWebSocket() {
      throw new Error("not implemented");
    },
  },
  // deno-lint-ignore require-await
  async serve() {
    throw new Error("not implemented");
  },
};

Deno.test("loadHandlerModule resolves .ts file without explicit extension", async () => {
  const tmpDir = await Deno.makeTempDir();
  const modulePath = join(tmpDir, "handler");

  await fs.writeTextFile(
    `${modulePath}.ts`,
    `
      import { NextResponse } from 'https://deno.land/x/next_response/mod.ts';
      export const GET = () => new Response("ok");
    `,
  );

  const route = await loadHandlerModule({
    projectDir: tmpDir,
    modulePath,
    adapter,
    config: undefined,
  });

  assertEquals(typeof route?.GET, "function");
});

Deno.test("loadHandlerModule throws on missing file", async () => {
  const tmpDir = await Deno.makeTempDir();
  const modulePath = join(tmpDir, "missing");

  let caught = "";
  try {
    await loadHandlerModule({
      projectDir: tmpDir,
      modulePath,
      adapter,
      config: undefined,
    });
  } catch (error) {
    caught = error instanceof Error ? error.message : String(error);
  }

  assertMatch(caught, /Failed to load API handler/i);
});
