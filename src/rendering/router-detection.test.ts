import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { detectAppRouter } from "./router-detection.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";

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
    mkdir() {
      return Promise.resolve();
    },
    remove() {
      return Promise.resolve();
    },
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
    set() {
      return Promise.resolve();
    },
    delete() {
      return Promise.resolve();
    },
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
  it("propagates adapter failures instead of inspecting the host filesystem", async () => {
    const config = {} as VeryfrontConfig;
    await assertRejects(
      () => detectAppRouter("/project", config, failingAdapter, { projectId: "failure" }),
      Error,
      "adapter stat failure",
    );
  });

  it("treats genuinely missing router directories as absent", async () => {
    const missingAdapter = {
      ...failingAdapter,
      fs: {
        ...failingAdapter.fs,
        stat() {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
      },
    } as RuntimeAdapter;

    assertEquals(
      await detectAppRouter("/project", {} as VeryfrontConfig, missingAdapter, {
        projectId: "missing",
      }),
      true,
    );
  });

  it("rejects router directory settings that escape the project", async () => {
    await assertRejects(
      () =>
        detectAppRouter(
          "/project",
          { directories: { app: "../app" } } as VeryfrontConfig,
          failingAdapter,
          { projectId: "traversal" },
        ),
      Error,
      "Router directories must stay inside the project",
    );
  });
});
