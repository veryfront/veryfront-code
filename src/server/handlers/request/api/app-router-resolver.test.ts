import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveAppRouteFile } from "./app-router-resolver.ts";
import type { HandlerContext } from "../../types.ts";

type DirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

function file(name: string): DirEntry {
  return { name, isFile: true, isDirectory: false, isSymlink: false };
}

function dir(name: string): DirEntry {
  return { name, isFile: false, isDirectory: true, isSymlink: false };
}

interface StatResult {
  isFile: boolean;
  isDirectory: boolean;
}

function createMockCtx(opts: {
  statMap?: Record<string, StatResult>;
  dirMap?: Record<string, DirEntry[]>;
  statError?: Set<string>;
  readDirError?: Set<string>;
}): HandlerContext {
  const { statMap = {}, dirMap = {}, statError = new Set(), readDirError = new Set() } = opts;

  return {
    projectDir: "/project",
    securityConfig: null,
    cspUserHeader: null,
    adapter: {
      fs: {
        stat: async (path: string) => {
          if (statError.has(path)) throw new Error("stat error");
          const entry = statMap[path];
          if (!entry) throw new Error(`ENOENT: ${path}`);
          return entry;
        },
        readDir: async function* (path: string) {
          if (readDirError.has(path)) throw new Error("readDir error");
          const entries = dirMap[path] ?? [];
          for (const e of entries) yield e;
        },
      },
    },
  } as unknown as HandlerContext;
}

describe("resolveAppRouteFile", () => {
  it("returns null when app directory doesn't exist", async () => {
    const ctx = createMockCtx({
      statError: new Set(["/project/app"]),
    });
    const result = await resolveAppRouteFile("/api/test", ctx);
    assertEquals(result, null);
  });

  it("returns null when app is not a directory", async () => {
    const ctx = createMockCtx({
      statMap: { "/project/app": { isFile: true, isDirectory: false } },
    });
    const result = await resolveAppRouteFile("/api/test", ctx);
    assertEquals(result, null);
  });

  it("matches exact directory with route.ts", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/hello/route.tsx": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("hello")],
        "/project/app/api/hello": [file("route.tsx")],
      },
    });
    const result = await resolveAppRouteFile("/api/hello", ctx);
    assertEquals(result, { file: "/project/app/api/hello/route.tsx", params: {} });
  });

  it("tries route.tsx, route.ts, route.jsx, route.js in order", async () => {
    // Only route.js exists
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/route.js": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [],
      },
      statError: new Set([
        "/project/app/api/route.tsx",
        "/project/app/api/route.ts",
        "/project/app/api/route.jsx",
      ]),
    });
    const result = await resolveAppRouteFile("/api", ctx);
    assertEquals(result, { file: "/project/app/api/route.js", params: {} });
  });

  it("matches route.tsx before route.ts", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/route.tsx": { isFile: true, isDirectory: false },
        "/project/app/api/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [],
      },
    });
    const result = await resolveAppRouteFile("/api", ctx);
    assertEquals(result, { file: "/project/app/api/route.tsx", params: {} });
  });

  it("matches dynamic segment [id] with param extraction", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/users/[id]/route.ts": { isFile: false, isDirectory: false },
        "/project/app/api/users/[id]/route.tsx": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("users")],
        "/project/app/api/users": [dir("[id]")],
        "/project/app/api/users/[id]": [],
      },
      statError: new Set([
        "/project/app/api/users/[id]/route.ts",
      ]),
    });
    const result = await resolveAppRouteFile("/api/users/42", ctx);
    assertEquals(result, {
      file: "/project/app/api/users/[id]/route.tsx",
      params: { id: "42" },
    });
  });

  it("matches catch-all [...slug] for multi-segment paths", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/docs/[...slug]/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("docs")],
        "/project/app/api/docs": [dir("[...slug]")],
        "/project/app/api/docs/[...slug]": [],
      },
    });
    const result = await resolveAppRouteFile("/api/docs/a/b", ctx);
    assertEquals(result, {
      file: "/project/app/api/docs/[...slug]/route.ts",
      params: { slug: ["a", "b"] },
    });
  });

  it("matches optional catch-all [[...slug]]", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/search/[[...slug]]/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("search")],
        "/project/app/api/search": [dir("[[...slug]]")],
        "/project/app/api/search/[[...slug]]": [],
      },
    });
    const result = await resolveAppRouteFile("/api/search/x/y", ctx);
    assertEquals(result, {
      file: "/project/app/api/search/[[...slug]]/route.ts",
      params: { slug: ["x", "y"] },
    });
  });

  it("matches optional catch-all [[...slug]] without segments", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/search/[[...slug]]/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("search")],
        "/project/app/api/search": [dir("[[...slug]]")],
        "/project/app/api/search/[[...slug]]": [],
      },
    });
    const result = await resolveAppRouteFile("/api/search", ctx);
    assertEquals(result, {
      file: "/project/app/api/search/[[...slug]]/route.ts",
      params: { slug: [] },
    });
  });

  it("falls back to catch-all when a dynamic route cannot consume the full path", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/files/[id]/route.ts": { isFile: true, isDirectory: false },
        "/project/app/api/files/[...slug]/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("files")],
        "/project/app/api/files": [dir("[id]"), dir("[...slug]")],
        "/project/app/api/files/[id]": [],
        "/project/app/api/files/[...slug]": [],
      },
    });
    const result = await resolveAppRouteFile("/api/files/a/b", ctx);
    assertEquals(result, {
      file: "/project/app/api/files/[...slug]/route.ts",
      params: { slug: ["a", "b"] },
    });
  });

  it("prefers exact match over dynamic segment", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/users/me/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("users")],
        "/project/app/api/users": [dir("me"), dir("[id]")],
        "/project/app/api/users/me": [],
      },
    });
    const result = await resolveAppRouteFile("/api/users/me", ctx);
    assertEquals(result, {
      file: "/project/app/api/users/me/route.ts",
      params: {},
    });
  });

  it("returns null when no route file exists in directory", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [],
      },
      statError: new Set([
        "/project/app/api/route.tsx",
        "/project/app/api/route.ts",
        "/project/app/api/route.jsx",
        "/project/app/api/route.js",
      ]),
    });
    const result = await resolveAppRouteFile("/api", ctx);
    assertEquals(result, null);
  });

  it("handles root path /", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {},
    });
    const result = await resolveAppRouteFile("/", ctx);
    assertEquals(result, { file: "/project/app/route.ts", params: {} });
  });

  it("strips trailing slash", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [],
      },
    });
    const result = await resolveAppRouteFile("/api/", ctx);
    assertEquals(result, { file: "/project/app/api/route.ts", params: {} });
  });

  it("returns null for unmatched deep paths", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [],
      },
      statError: new Set([
        "/project/app/api/route.tsx",
        "/project/app/api/route.ts",
        "/project/app/api/route.jsx",
        "/project/app/api/route.js",
      ]),
    });
    // Path has more segments than directories available
    const result = await resolveAppRouteFile("/api/nonexistent/deep/path", ctx);
    assertEquals(result, null);
  });

  it("returns null when readDir fails (directory not readable)", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
      },
      readDirError: new Set(["/project/app"]),
    });
    const result = await resolveAppRouteFile("/api/test", ctx);
    assertEquals(result, null);
  });
});
