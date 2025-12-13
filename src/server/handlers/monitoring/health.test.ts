import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assertStringIncludes } from "std/assert/mod.ts";
import { HealthHandler } from "./health.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "../../../platform/adapters/base.ts";

function createMockAdapter(options: {
  projectDirExists?: boolean;
  distDirExists?: boolean;
} = {}): RuntimeAdapter {
  const { projectDirExists = true, distDirExists = false } = options;

  return {
    platform: "deno" as any,
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
      exists: async (path: string) => {
        if (path.includes("dist")) return distDirExists;
        return projectDirExists;
      },
      stat: async (path: string) => {
        if (path.includes("dist")) {
          if (!distDirExists) throw new Error("Directory not found");
          return {
            isFile: false,
            isDirectory: true,
            isSymlink: false,
            size: 0,
            mtime: new Date(),
            atime: new Date(),
            birthtime: new Date(),
            dev: 0,
            ino: null,
            mode: null,
            nlink: null,
            uid: null,
            gid: null,
            rdev: null,
            blksize: null,
            blocks: null,
          };
        }

        if (!projectDirExists) throw new Error("Directory not found");

        return {
          isFile: false,
          isDirectory: true,
          isSymlink: false,
          size: 0,
          mtime: new Date(),
          atime: new Date(),
          birthtime: new Date(),
          dev: 0,
          ino: null,
          mode: null,
          nlink: null,
          uid: null,
          gid: null,
          rdev: null,
          blksize: null,
          blocks: null,
        };
      },
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
      platform: "deno" as any,
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

describe("HealthHandler", () => {
  let handler: HealthHandler;
  let mockContext: HandlerContext;

  beforeEach(() => {
    handler = new HealthHandler();
    mockContext = {
      adapter: createMockAdapter(),
      config: {} as any,
      projectDir: "/test/project",
      mode: "development",
      securityConfig: null,
      cspUserHeader: null,
    };
  });

  it("should have correct metadata", () => {
    assertExists(handler.metadata);
    assertEquals(handler.metadata.name, "HealthHandler");
    assertExists(handler.metadata.patterns);
    assertEquals(handler.metadata.patterns!.length, 3);
  });

  it("should match /healthz pattern", () => {
    assertExists(handler.metadata.patterns);
    const pattern = handler.metadata.patterns!.find((p) => p.pattern === "/healthz");
    assertExists(pattern);
    assertEquals(pattern.exact, true);
  });

  it("should match /readyz pattern", () => {
    assertExists(handler.metadata.patterns);
    const pattern = handler.metadata.patterns!.find((p) => p.pattern === "/readyz");
    assertExists(pattern);
    assertEquals(pattern.exact, true);
  });

  it("should match /_health pattern", () => {
    assertExists(handler.metadata.patterns);
    const pattern = handler.metadata.patterns!.find((p) => p.pattern === "/_health");
    assertExists(pattern);
    assertEquals(pattern.exact, true);
  });

  it("should return 'ok' for /healthz", async () => {
    const req = new Request("http://example.com/healthz");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const text = await result.response.text();
    assertEquals(text, "ok");
  });

  it("should return 'ready' for /readyz when ready", async () => {
    const req = new Request("http://example.com/readyz");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const text = await result.response.text();
    assertEquals(text, "ready");
  });

  it("should return 'not-ready' for /readyz when not ready", async () => {
    mockContext.adapter = createMockAdapter({ projectDirExists: false });
    const req = new Request("http://example.com/readyz");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 503);
    const text = await result.response.text();
    assertEquals(text, "not-ready");
  });

  it("should return JSON for /_health", async () => {
    const req = new Request("http://example.com/_health");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const json = await result.response.json();
    assertExists(json);
    assertEquals(json.status, "ok");
    assertExists(json.timestamp);
    assertExists(json.mode);
    assertExists(json.version);
  });

  it("should return ssr mode when no dist directory", async () => {
    mockContext.adapter = createMockAdapter({ distDirExists: false });
    const req = new Request("http://example.com/_health");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const json = await result.response.json();
    assertEquals(json.mode, "ssr");
  });

  it("should return static+ssr mode when dist directory exists", async () => {
    mockContext.adapter = createMockAdapter({ distDirExists: true });
    const req = new Request("http://example.com/_health");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const json = await result.response.json();
    assertEquals(json.mode, "static+ssr");
  });

  it("should include timestamp in health response", async () => {
    const req = new Request("http://example.com/_health");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const json = await result.response.json();
    assertExists(json.timestamp);
    // Verify it's a valid ISO string
    const date = new Date(json.timestamp);
    assertEquals(isNaN(date.getTime()), false);
  });

  it("should not handle non-health paths", async () => {
    const req = new Request("http://example.com/other");
    const result = await handler.handle(req, mockContext);

    assertEquals(result.response, undefined);
  });

  it("should have content-type text/plain for /healthz", async () => {
    const req = new Request("http://example.com/healthz");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const contentType = result.response.headers.get("content-type");
    assertExists(contentType);
    assertStringIncludes(contentType, "text/plain");
  });

  it("should have content-type application/json for /_health", async () => {
    const req = new Request("http://example.com/_health");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const contentType = result.response.headers.get("content-type");
    assertExists(contentType);
    assertStringIncludes(contentType, "application/json");
  });
});
