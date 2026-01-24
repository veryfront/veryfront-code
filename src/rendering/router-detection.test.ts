import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { detectAppRouter } from "./router-detection.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { makeTempDir, mkdir, writeTextFile } from "#veryfront/testing/deno-compat.ts";

const failingAdapter: RuntimeAdapter = {
  id: "node",
  name: "node-stub",
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
  fs: {
    stat() {
      throw new Error("adapter stat failure");
    },
    readDir() {
      throw new Error("adapter readDir failure");
    },
    readFile() {
      throw new Error("not implemented");
    },
    writeFile() {
      throw new Error("not implemented");
    },
    exists() {
      return Promise.resolve(false);
    },
    mkdir() {},
    remove() {},
    makeTempDir() {
      return Promise.resolve("");
    },
    watch() {
      return {
        async *[Symbol.asyncIterator]() {},
        close() {},
      };
    },
  },
  env: {
    get() {
      return undefined;
    },
    set() {},
    toObject() {
      return {};
    },
  },
  shell: {
    statSync() {
      return { isFile: false, isDirectory: false };
    },
    readFileSync() {
      return "";
    },
  },
  kv: {
    get() {
      return Promise.resolve(null);
    },
    set() {},
    delete() {},
    async *list() {},
  },
  watcher: {
    watch() {
      return {
        async *[Symbol.asyncIterator]() {},
        close() {},
      };
    },
  },
  server: {
    upgradeWebSocket() {
      throw new Error("not implemented");
    },
  },
  serve() {
    return Promise.resolve({
      stop: () => Promise.resolve(),
      addr: { hostname: "0.0.0.0", port: 0 },
    });
  },
};

describe("detectAppRouter", () => {
  it("falls back to compat fs when adapter fails", async () => {
    const tmpDir = await makeTempDir();
    const appDir = join(tmpDir, "app");

    await mkdir(appDir, { recursive: true });
    await writeTextFile(
      join(appDir, "page.tsx"),
      "export default function Page() { return null; }",
    );

    const config = {} as VeryfrontConfig;
    const result = await detectAppRouter(tmpDir, config, failingAdapter);

    assertEquals(result, true, "should detect app router using compat fs fallback");
  });
});
