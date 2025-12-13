import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assert, assertStringIncludes } from "std/assert/mod.ts";
import { renderAppRouteToHTML } from "./build-app-route-renderer.ts";
import type { RuntimeAdapter } from "../platform/adapters/base.ts";

// Mock adapter for testing
function createMockAdapter(options: {
  rootLayoutExists?: boolean;
  segmentLayoutExists?: boolean;
  pageContent?: string;
  layoutContent?: string;
} = {}): RuntimeAdapter {
  const {
    rootLayoutExists = false,
    segmentLayoutExists = false,
    pageContent = `export default function Page() { return "Test Page"; }`,
    layoutContent = `export default function Layout({ children }) { return children; }`,
  } = options;

  const encoder = new TextEncoder();

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
      readFile: async (path: string) => {
        if (path.includes("layout.tsx")) {
          return encoder.encode(layoutContent);
        }
        return encoder.encode(pageContent);
      },
      writeFile: async (path: string, data: Uint8Array) => {},
      readDir: async (path: string) => [],
      mkdir: async (path: string, options?: any) => {},
      exists: async (path: string) => {
        if (path.includes("layout.tsx")) {
          if (path.includes("app/layout.tsx")) return rootLayoutExists;
          return segmentLayoutExists;
        }
        return true;
      },
      stat: async (path: string) => {
        const exists = path.includes("layout.tsx")
          ? (path.includes("app/layout.tsx") ? rootLayoutExists : segmentLayoutExists)
          : true;

        if (!exists) {
          throw new Error("File not found");
        }

        return {
          isFile: true,
          isDirectory: false,
          isSymlink: false,
          size: 100,
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

describe("renderAppRouteToHTML", () => {
  it("should render HTML with basic structure", async () => {
    const mockAdapter = createMockAdapter();
    const result = await renderAppRouteToHTML({
      adapter: mockAdapter,
      projectDir: "/test/project",
      routePath: "/",
      pageFile: "/test/project/app/page.tsx",
    });

    assertExists(result);
    assertStringIncludes(result, "<!DOCTYPE html>");
    assertStringIncludes(result, "<html");
    assertStringIncludes(result, "<head>");
    assertStringIncludes(result, "<body>");
  });

  it("should include React import map", async () => {
    const mockAdapter = createMockAdapter();
    const result = await renderAppRouteToHTML({
      adapter: mockAdapter,
      projectDir: "/test/project",
      routePath: "/",
      pageFile: "/test/project/app/page.tsx",
    });

    assertStringIncludes(result, 'type="importmap"');
    assertStringIncludes(result, '"react"');
    assertStringIncludes(result, '"react-dom"');
    assertStringIncludes(result, "https://esm.sh/react");
  });

  it("should include title", async () => {
    const mockAdapter = createMockAdapter();
    const result = await renderAppRouteToHTML({
      adapter: mockAdapter,
      projectDir: "/test/project",
      routePath: "/",
      pageFile: "/test/project/app/page.tsx",
    });

    assertStringIncludes(result, "<title>Veryfront App</title>");
  });

  it("should include basic styles", async () => {
    const mockAdapter = createMockAdapter();
    const result = await renderAppRouteToHTML({
      adapter: mockAdapter,
      projectDir: "/test/project",
      routePath: "/",
      pageFile: "/test/project/app/page.tsx",
    });

    assertStringIncludes(result, "<style>");
    assertStringIncludes(result, ".loading-container");
    assertStringIncludes(result, ".prose");
  });

  it("should include root div", async () => {
    const mockAdapter = createMockAdapter();
    const result = await renderAppRouteToHTML({
      adapter: mockAdapter,
      projectDir: "/test/project",
      routePath: "/",
      pageFile: "/test/project/app/page.tsx",
    });

    assertStringIncludes(result, 'id="root"');
    assertStringIncludes(result, 'class="vf-tailwind"');
  });

  it("should include app initialization script", async () => {
    const mockAdapter = createMockAdapter();
    const result = await renderAppRouteToHTML({
      adapter: mockAdapter,
      projectDir: "/test/project",
      routePath: "/",
      pageFile: "/test/project/app/page.tsx",
    });

    assertStringIncludes(result, 'type="module"');
    assertStringIncludes(result, "initializeApp");
    assertStringIncludes(result, "/_veryfront/app.js");
  });

  it("should handle root route path", async () => {
    const mockAdapter = createMockAdapter();
    const result = await renderAppRouteToHTML({
      adapter: mockAdapter,
      projectDir: "/test/project",
      routePath: "/",
      pageFile: "/test/project/app/page.tsx",
    });

    assertExists(result);
    assert(result.length > 0);
  });

  it("should handle nested route paths", async () => {
    const mockAdapter = createMockAdapter({ segmentLayoutExists: true });
    const result = await renderAppRouteToHTML({
      adapter: mockAdapter,
      projectDir: "/test/project",
      routePath: "/blog/post",
      pageFile: "/test/project/app/blog/post/page.tsx",
    });

    assertExists(result);
    assert(result.length > 0);
  });

  it("should include viewport meta tag", async () => {
    const mockAdapter = createMockAdapter();
    const result = await renderAppRouteToHTML({
      adapter: mockAdapter,
      projectDir: "/test/project",
      routePath: "/",
      pageFile: "/test/project/app/page.tsx",
    });

    assertStringIncludes(result, 'name="viewport"');
    assertStringIncludes(result, "width=device-width");
  });
});
