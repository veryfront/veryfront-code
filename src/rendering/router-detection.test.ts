import { assertEquals } from "std/assert/mod.ts";
import { join } from "std/path/mod.ts";
import { detectAppRouter } from "./router-detection.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "@veryfront/config";

// Adapter stub that forces router-detection to use compat fs fallback
const failingAdapter: RuntimeAdapter = {
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
  fs: {
    // deno-lint-ignore require-await
    async stat() {
      throw new Error("adapter stat failure");
    },
    // deno-lint-ignore require-yield
    async *readDir() {
      throw new Error("adapter readDir failure");
    },
    // Unused in this test
    // deno-lint-ignore require-await
    async readFile() {
      throw new Error("not implemented");
    },
    // deno-lint-ignore require-await
    async writeFile() {
      throw new Error("not implemented");
    },
    // deno-lint-ignore require-await
    async exists() {
      return false;
    },
    async mkdir() {},
    async remove() {},
    // deno-lint-ignore require-await
    async makeTempDir() {
      return "";
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
  features: {
    websocket: true,
    http2: true,
    workers: true,
    jsx: true,
    typescript: true,
  },
  kv: {
    // deno-lint-ignore require-await
    async get() {
      return null;
    },
    async set() {},
    async delete() {},
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
  // deno-lint-ignore require-await
  async serve() {
    return {
      stop: async () => {},
      addr: { hostname: "0.0.0.0", port: 0 },
    };
  },
};

Deno.test("detectAppRouter falls back to compat fs when adapter fails", async () => {
  const tmpDir = await Deno.makeTempDir();
  const appDir = join(tmpDir, "app");
  await Deno.mkdir(appDir, { recursive: true });
  await Deno.writeTextFile(
    join(appDir, "page.tsx"),
    "export default function Page() { return null; }",
  );

  const config = {} as VeryfrontConfig;
  const result = await detectAppRouter(tmpDir, config, failingAdapter);

  assertEquals(result, true, "should detect app router using compat fs fallback");
});
