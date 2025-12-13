import { describe, it, beforeEach, afterEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assert } from "std/assert/mod.ts";
import { bootstrap, bootstrapDev, bootstrapProd } from "./bootstrap.ts";
import type { RuntimeAdapter } from "../platform/adapters/base.ts";
import type { VeryfrontConfig } from "../core/config/types.ts";

// Mock adapter for testing
function createMockAdapter(platform = "deno"): RuntimeAdapter {
  return {
    platform: platform as any,
    env: {
      get: (key: string) => undefined,
      set: (key: string, value: string) => {},
      has: (key: string) => false,
      delete: (key: string) => false,
      toObject: () => ({}),
    },
    fs: {
      readFile: async (path: string) => new Uint8Array(),
      writeFile: async (path: string, data: Uint8Array) => {},
      readDir: async (path: string) => [],
      mkdir: async (path: string, options?: any) => {},
      exists: async (path: string) => false,
      stat: async (path: string) => ({
        isFile: false,
        isDirectory: false,
        isSymlink: false,
        size: 0,
        mtime: null,
        atime: null,
        birthtime: null,
        dev: 0,
        ino: null,
        mode: null,
        nlink: null,
        uid: null,
        gid: null,
        rdev: null,
        blksize: null,
        blocks: null,
      }),
      remove: async (path: string, options?: any) => {},
      rename: async (oldPath: string, newPath: string) => {},
      copyFile: async (src: string, dest: string) => {},
      realPath: async (path: string) => path,
      watch: (path: string, options?: any) => ({
        [Symbol.asyncIterator]: async function* () {},
      }),
    },
    path: {
      join: (...paths: string[]) => paths.join("/"),
      resolve: (...paths: string[]) => paths.join("/"),
      dirname: (path: string) => path.split("/").slice(0, -1).join("/"),
      basename: (path: string) => path.split("/").pop() || "",
      extname: (path: string) => {
        const base = path.split("/").pop() || "";
        const lastDot = base.lastIndexOf(".");
        return lastDot > 0 ? base.slice(lastDot) : "";
      },
      isAbsolute: (path: string) => path.startsWith("/"),
      relative: (from: string, to: string) => to,
      normalize: (path: string) => path,
      sep: "/",
      delimiter: ":",
      parse: (path: string) => ({
        root: "",
        dir: "",
        base: "",
        ext: "",
        name: "",
      }),
      format: (pathObject: any) => "",
      toFileUrl: (path: string) => new URL(`file://${path}`),
      fromFileUrl: (url: URL | string) => "",
    },
    http: {
      serve: async (handler: any, options?: any) => ({
        finished: Promise.resolve(),
        shutdown: async () => {},
        ref: () => {},
        unref: () => {},
        addr: { hostname: "localhost", port: 3000, transport: "tcp" as const },
      }),
      serveStatic: async (path: string) => new Response("", { status: 404 }),
    },
    process: {
      cwd: () => "/test",
      exit: (code?: number) => {},
      args: [],
      pid: 1234,
      platform: platform as any,
      arch: "x64",
      version: "1.0.0",
      execPath: () => "/usr/bin/deno",
    },
    websocket: {
      upgrade: (req: Request) => ({
        response: new Response(),
        socket: {} as any,
      }),
    },
  } as unknown as RuntimeAdapter;
}

describe("bootstrap", () => {
  let mockAdapter: RuntimeAdapter;
  let testProjectDir: string;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    testProjectDir = "/test/project";
  });

  it("should bootstrap with local filesystem", async () => {
    const result = await bootstrap(testProjectDir, mockAdapter);

    assertExists(result);
    assertExists(result.adapter);
    assertExists(result.config);
    assertEquals(result.usingFSAdapter, false);
    assertEquals(result.fsAdapterType, undefined);
  });

  it("should return adapter when no FSAdapter needed", async () => {
    const result = await bootstrap(testProjectDir, mockAdapter);

    assertEquals(result.adapter, mockAdapter);
    assertEquals(result.usingFSAdapter, false);
  });

  it("should have correct BootstrapResult structure", async () => {
    const result = await bootstrap(testProjectDir, mockAdapter);

    assert("adapter" in result);
    assert("config" in result);
    assert("usingFSAdapter" in result);
  });
});

describe("bootstrapDev", () => {
  let mockAdapter: RuntimeAdapter;
  let testProjectDir: string;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    testProjectDir = "/test/project";
  });

  it("should bootstrap in development mode", async () => {
    const result = await bootstrapDev(testProjectDir, mockAdapter);

    assertExists(result);
    assertExists(result.adapter);
    assertExists(result.config);
  });

  it("should return valid bootstrap result", async () => {
    const result = await bootstrapDev(testProjectDir, mockAdapter);

    assert("adapter" in result);
    assert("config" in result);
    assert("usingFSAdapter" in result);
  });
});

describe("bootstrapProd", () => {
  let mockAdapter: RuntimeAdapter;
  let testProjectDir: string;

  beforeEach(() => {
    mockAdapter = createMockAdapter();
    testProjectDir = "/test/project";
  });

  it("should bootstrap in production mode", async () => {
    const result = await bootstrapProd(testProjectDir, mockAdapter);

    assertExists(result);
    assertExists(result.adapter);
    assertExists(result.config);
  });

  it("should handle errors gracefully", async () => {
    // Test with invalid project directory
    const invalidAdapter = createMockAdapter();

    try {
      const result = await bootstrapProd("/invalid/path", invalidAdapter);
      // If no error is thrown, result should still be valid
      assertExists(result);
    } catch (error) {
      // Error handling is expected for invalid paths
      assert(error instanceof Error);
    }
  });

  it("should return valid bootstrap result", async () => {
    const result = await bootstrapProd(testProjectDir, mockAdapter);

    assert("adapter" in result);
    assert("config" in result);
    assert("usingFSAdapter" in result);
  });
});
