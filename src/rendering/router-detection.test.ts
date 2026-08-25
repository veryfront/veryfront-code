import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { join } from "#veryfront/compat/path";
import { detectAppRouter, resolveRouterModeForPage } from "./router-detection.ts";
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

  it("detects a Pages Router project without statting the missing app directory", async () => {
    let statCalls = 0;
    const adapter = {
      ...failingAdapter,
      fs: {
        ...failingAdapter.fs,
        stat: (path: string) => {
          statCalls++;
          if (path === "/project/pages") {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              isSymlink: false,
            });
          }
          return Promise.reject(new Error("File not found"));
        },
        readDir: async function* (path: string) {
          if (path === "/project") {
            yield { name: "pages", isFile: false, isDirectory: true, isSymlink: false };
          } else if (path === "/project/pages") {
            yield { name: "index.tsx", isFile: true, isDirectory: false, isSymlink: false };
          }
        },
      },
    } as RuntimeAdapter;

    const result = await detectAppRouter("/project", {} as VeryfrontConfig, adapter, {
      projectId: "stat-free-pages-project",
    });

    assertEquals(result, false);
    assertEquals(statCalls, 0);
  });

  it("recognizes the project root as a configured App Router directory", async () => {
    const adapter = {
      ...failingAdapter,
      fs: {
        ...failingAdapter.fs,
        readDir: async function* (path: string) {
          if (path === "/project") {
            yield { name: "page.tsx", isFile: true, isDirectory: false, isSymlink: false };
            yield { name: "pages", isFile: false, isDirectory: true, isSymlink: false };
          } else if (path === "/project/pages") {
            yield { name: "index.tsx", isFile: true, isDirectory: false, isSymlink: false };
          }
        },
      },
    } as RuntimeAdapter;

    const result = await detectAppRouter(
      "/project",
      { directories: { app: ".", pages: "pages" } } as VeryfrontConfig,
      adapter,
      { projectId: "root-app-project" },
    );

    assertEquals(result, true);
  });

  it("detects a Pages Router project whose parent listing omits implicit directories", async () => {
    const adapter = {
      ...failingAdapter,
      id: "cloudflare",
      fs: {
        ...failingAdapter.fs,
        stat: (path: string) => {
          if (path === "/project/pages") {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              isSymlink: false,
            });
          }
          return Promise.reject(new Error("File not found"));
        },
        readDir: async function* (path: string) {
          if (path === "/project/pages") {
            yield { name: "index.tsx", isFile: true, isDirectory: false, isSymlink: false };
          }
        },
      },
    } as RuntimeAdapter;

    const result = await detectAppRouter("/project", {} as VeryfrontConfig, adapter, {
      projectId: "implicit-kv-pages-project",
    });

    assertEquals(result, false);
  });

  it("recognizes a symlinked route directory without statting it", async () => {
    let statCalls = 0;
    const adapter = {
      ...failingAdapter,
      fs: {
        ...failingAdapter.fs,
        stat: () => {
          statCalls++;
          return Promise.reject(new Error("stat should not be called"));
        },
        readDir: async function* (path: string) {
          if (path === "/project") {
            yield { name: "pages", isFile: false, isDirectory: false, isSymlink: true };
          } else if (path === "/project/pages") {
            yield { name: "index.tsx", isFile: true, isDirectory: false, isSymlink: false };
          }
        },
      },
    } as RuntimeAdapter;

    const result = await detectAppRouter("/project", {} as VeryfrontConfig, adapter, {
      projectId: "symlinked-pages-project",
    });

    assertEquals(result, false);
    assertEquals(statCalls, 0);
  });

  it("traverses symlinked subdirectories when detecting App Router routes", async () => {
    const adapter = {
      ...failingAdapter,
      fs: {
        ...failingAdapter.fs,
        realPath: (path: string) =>
          Promise.resolve(path === "/project/app/docs" ? "/shared/docs" : path),
        readDir: async function* (path: string) {
          if (path === "/project") {
            yield { name: "app", isFile: false, isDirectory: true, isSymlink: false };
            yield { name: "pages", isFile: false, isDirectory: true, isSymlink: false };
          } else if (path === "/project/app") {
            yield { name: "docs", isFile: false, isDirectory: false, isSymlink: true };
          } else if (path === "/project/app/docs") {
            yield { name: "page.tsx", isFile: true, isDirectory: false, isSymlink: false };
          } else if (path === "/project/pages") {
            yield { name: "index.tsx", isFile: true, isDirectory: false, isSymlink: false };
          }
        },
      },
    } as RuntimeAdapter;

    const result = await detectAppRouter("/project", {} as VeryfrontConfig, adapter, {
      projectId: "nested-symlink-app-project",
    });

    assertEquals(result, true);
  });

  it("does not revisit a route directory through a symlink cycle", async () => {
    let followedCycle = false;
    const adapter = {
      ...failingAdapter,
      fs: {
        ...failingAdapter.fs,
        realPath: (path: string) =>
          Promise.resolve(path === "/project/app/loop" ? "/project/app" : path),
        readDir: async function* (path: string) {
          if (path === "/project") {
            yield { name: "app", isFile: false, isDirectory: true, isSymlink: false };
            yield { name: "pages", isFile: false, isDirectory: true, isSymlink: false };
          } else if (path === "/project/app") {
            yield { name: "loop", isFile: false, isDirectory: false, isSymlink: true };
          } else if (path === "/project/app/loop") {
            followedCycle = true;
          } else if (path === "/project/pages") {
            yield { name: "index.tsx", isFile: true, isDirectory: false, isSymlink: false };
          }
        },
      },
    } as RuntimeAdapter;

    const result = await detectAppRouter("/project", {} as VeryfrontConfig, adapter, {
      projectId: "symlink-cycle-project",
    });

    assertEquals(result, false);
    assertEquals(followedCycle, false);
  });
});

describe("resolveRouterModeForPage", () => {
  it("uses the most specific matching router root", () => {
    const config = {
      directories: {
        app: "src",
        pages: "src/pages",
      },
    } as VeryfrontConfig;

    const result = resolveRouterModeForPage(
      "/project",
      "/project/src/pages/chat/index.tsx",
      config,
    );

    assertEquals(result, "pages");
  });

  it("treats a resolved root-level page as a Pages route", () => {
    const config = {} as VeryfrontConfig;

    const result = resolveRouterModeForPage(
      "/project",
      "/project/index.mdx",
      config,
    );

    assertEquals(result, "pages");
  });

  it("honors an explicit pages router over an app/ location", () => {
    const result = resolveRouterModeForPage(
      "/project",
      "/project/app/page.tsx",
      { router: "pages" } as VeryfrontConfig,
    );

    assertEquals(result, "pages", "explicit router: pages wins over an app/ location");
  });

  it("honors an explicit app router over a pages/ location", () => {
    const result = resolveRouterModeForPage(
      "/project",
      "/project/pages/index.tsx",
      { router: "app" } as VeryfrontConfig,
    );

    assertEquals(result, "app", "explicit router: app wins over a pages/ location");
  });
});
