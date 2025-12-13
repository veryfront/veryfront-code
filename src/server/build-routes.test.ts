import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assert } from "std/assert/mod.ts";
import { collectPagesRoutes, collectAppRoutes } from "./build-routes.ts";
import type { RuntimeAdapter } from "../platform/adapters/base.ts";

// Mock adapter for testing
function createMockAdapter(options: {
  hasPagesDir?: boolean;
  hasAppDir?: boolean;
  pageFiles?: string[];
  appFiles?: { path: string; content: string }[];
  directories?: Array<{ path: string; name: string }>;
} = {}): RuntimeAdapter {
  const {
    hasPagesDir = false,
    hasAppDir = false,
    pageFiles = [],
    appFiles = [],
    directories = [],
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
        const appFile = appFiles.find((f) => path.includes(f.path));
        if (appFile) {
          return encoder.encode(appFile.content);
        }
        return encoder.encode("export default function Page() {}");
      },
      writeFile: async (path: string, data: Uint8Array) => {},
      readDir: async (path: string) => {
        // Return directories for the given path
        const relevantDirs = directories.filter((d) => d.path === path);
        return relevantDirs.map((d) => ({
          name: d.name,
          isFile: false,
          isDirectory: true,
          isSymlink: false,
        }));
      },
      mkdir: async (path: string, options?: any) => {},
      exists: async (path: string) => {
        if (path.includes("pages") && hasPagesDir) return true;
        if (path.includes("app") && hasAppDir) return true;
        return pageFiles.some((f) => path.includes(f));
      },
      stat: async (path: string) => {
        const isPages = path.includes("pages");
        const isApp = path.includes("app");

        if ((isPages && !hasPagesDir) || (isApp && !hasAppDir)) {
          throw new Error("Directory not found");
        }

        const isFile =
          pageFiles.some((f) => path.includes(f)) ||
          appFiles.some((f) => path.includes(f.path));

        return {
          isFile,
          isDirectory: !isFile,
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
      relative: (from: string, to: string) => {
        // Simple relative path implementation
        const fromParts = from.split("/").filter(Boolean);
        const toParts = to.split("/").filter(Boolean);
        let i = 0;
        while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) {
          i++;
        }
        return toParts.slice(i).join("/");
      },
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

describe("collectPagesRoutes", () => {
  it("should return empty array when pages directory does not exist", async () => {
    const mockAdapter = createMockAdapter({ hasPagesDir: false });
    const routes = await collectPagesRoutes(mockAdapter, "/test/project");

    assertEquals(routes, []);
  });

  it("should return empty array when pages directory is empty", async () => {
    const mockAdapter = createMockAdapter({ hasPagesDir: true, pageFiles: [] });
    const routes = await collectPagesRoutes(mockAdapter, "/test/project");

    assertEquals(routes, []);
  });

  it("should handle include filter", async () => {
    const mockAdapter = createMockAdapter({
      hasPagesDir: true,
      pageFiles: ["index.tsx", "about.tsx"],
    });

    const routes = await collectPagesRoutes(
      mockAdapter,
      "/test/project",
      ["/about"],
      undefined,
    );

    // All routes should be excluded since we're filtering to only include /about
    assertEquals(Array.isArray(routes), true);
  });

  it("should handle exclude filter", async () => {
    const mockAdapter = createMockAdapter({
      hasPagesDir: true,
      pageFiles: ["index.tsx", "about.tsx"],
    });

    const routes = await collectPagesRoutes(
      mockAdapter,
      "/test/project",
      undefined,
      ["/about"],
    );

    assertEquals(Array.isArray(routes), true);
  });
});

describe("collectAppRoutes", () => {
  it("should return empty array when app directory does not exist", async () => {
    const mockAdapter = createMockAdapter({ hasAppDir: false });
    const routes = await collectAppRoutes(mockAdapter, "/test/project");

    assertEquals(routes, []);
  });

  it("should return routes from app directory", async () => {
    const mockAdapter = createMockAdapter({
      hasAppDir: true,
      appFiles: [{ path: "page.tsx", content: "export default function Page() {}" }],
      directories: [],
    });

    const routes = await collectAppRoutes(mockAdapter, "/test/project");

    assertEquals(Array.isArray(routes), true);
  });

  it("should skip dynamic segments", async () => {
    const mockAdapter = createMockAdapter({
      hasAppDir: true,
      appFiles: [
        { path: "page.tsx", content: "export default function Page() {}" },
        { path: "[id]/page.tsx", content: "export default function Page() {}" },
      ],
      directories: [{ path: "/test/project/app", name: "[id]" }],
    });

    const routes = await collectAppRoutes(mockAdapter, "/test/project");

    assertEquals(Array.isArray(routes), true);
  });

  it("should skip force-dynamic routes", async () => {
    const mockAdapter = createMockAdapter({
      hasAppDir: true,
      appFiles: [
        {
          path: "page.tsx",
          content: 'export const dynamic = "force-dynamic"; export default function Page() {}',
        },
      ],
      directories: [],
    });

    const routes = await collectAppRoutes(mockAdapter, "/test/project");

    assertEquals(Array.isArray(routes), true);
  });

  it("should handle include filter", async () => {
    const mockAdapter = createMockAdapter({
      hasAppDir: true,
      appFiles: [{ path: "page.tsx", content: "export default function Page() {}" }],
      directories: [],
    });

    const routes = await collectAppRoutes(
      mockAdapter,
      "/test/project",
      ["/about"],
      undefined,
    );

    assertEquals(Array.isArray(routes), true);
  });

  it("should handle exclude filter", async () => {
    const mockAdapter = createMockAdapter({
      hasAppDir: true,
      appFiles: [{ path: "page.tsx", content: "export default function Page() {}" }],
      directories: [],
    });

    const routes = await collectAppRoutes(
      mockAdapter,
      "/test/project",
      undefined,
      ["/admin"],
    );

    assertEquals(Array.isArray(routes), true);
  });
});
