import "#veryfront/schemas/_test-setup.ts";
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

  it("resolves routes from the configured app directory", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/src/routes": { isFile: false, isDirectory: true },
        "/project/src/routes/api/hello/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/src/routes": [dir("api")],
        "/project/src/routes/api": [dir("hello")],
        "/project/src/routes/api/hello": [file("route.ts")],
      },
    });
    ctx.config = { directories: { app: "src/routes" } };

    const result = await resolveAppRouteFile("/api/hello", ctx);

    assertEquals(result, { file: "/project/src/routes/api/hello/route.ts", params: {} });
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

  it("keeps special parameter names as own keys on a null-prototype record", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/[__proto__]/[toString]/route.ts": {
          isFile: true,
          isDirectory: false,
        },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("[__proto__]")],
        "/project/app/api/[__proto__]": [dir("[toString]")],
        "/project/app/api/[__proto__]/[toString]": [],
      },
    });

    const result = await resolveAppRouteFile("/api/prototype/value", ctx);

    assertEquals(result?.file, "/project/app/api/[__proto__]/[toString]/route.ts");
    assertEquals(Object.getPrototypeOf(result?.params), null);
    assertEquals(Object.hasOwn(result?.params ?? {}, "__proto__"), true);
    assertEquals(Object.hasOwn(result?.params ?? {}, "toString"), true);
    assertEquals(result?.params["__proto__"], "prototype");
    assertEquals(Object.getOwnPropertyDescriptor(result?.params ?? {}, "toString")?.value, "value");
  });

  it("matches a dotted dynamic name through the canonical route parser", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/[version.number]/route.ts": {
          isFile: true,
          isDirectory: false,
        },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("[version.number]")],
        "/project/app/api/[version.number]": [],
      },
    });

    const result = await resolveAppRouteFile("/api/v2", ctx);

    assertEquals(result, {
      file: "/project/app/api/[version.number]/route.ts",
      params: { "version.number": "v2" },
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

  it("extracts a dotted catch-all name through the canonical route parser", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/docs/[...path.parts]/route.ts": {
          isFile: true,
          isDirectory: false,
        },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("docs")],
        "/project/app/api/docs": [dir("[...path.parts]")],
        "/project/app/api/docs/[...path.parts]": [],
      },
    });

    const result = await resolveAppRouteFile("/api/docs/a/b", ctx);

    assertEquals(result, {
      file: "/project/app/api/docs/[...path.parts]/route.ts",
      params: { "path.parts": ["a", "b"] },
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

  it("extracts a dotted optional catch-all name with no segments", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/search/[[...query.parts]]/route.ts": {
          isFile: true,
          isDirectory: false,
        },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("search")],
        "/project/app/api/search": [dir("[[...query.parts]]")],
        "/project/app/api/search/[[...query.parts]]": [],
      },
    });

    const result = await resolveAppRouteFile("/api/search", ctx);

    assertEquals(result, {
      file: "/project/app/api/search/[[...query.parts]]/route.ts",
      params: { "query.parts": [] },
    });
  });

  it("does not classify invalid parameter directories as routes", async () => {
    const invalidDirectories = [
      "[bad name]",
      "[.slug]",
      "[slug..part]",
      "[id].tsx",
    ];
    const statMap: Record<string, StatResult> = {
      "/project/app": { isFile: false, isDirectory: true },
    };
    const dirMap: Record<string, DirEntry[]> = {
      "/project/app": [dir("api")],
      "/project/app/api": invalidDirectories.map(dir),
    };
    for (const directory of invalidDirectories) {
      statMap[`/project/app/api/${directory}/route.ts`] = {
        isFile: true,
        isDirectory: false,
      };
      dirMap[`/project/app/api/${directory}`] = [];
    }
    const ctx = createMockCtx({ statMap, dirMap });

    assertEquals(await resolveAppRouteFile("/api/value", ctx), null);
  });

  it("resolves hyphenated parameter directories", async () => {
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/posts/[post-id]/route.ts": {
          isFile: true,
          isDirectory: false,
        },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("posts")],
        "/project/app/api/posts": [dir("[post-id]")],
        "/project/app/api/posts/[post-id]": [],
      },
    });

    assertEquals(await resolveAppRouteFile("/api/posts/123", ctx), {
      file: "/project/app/api/posts/[post-id]/route.ts",
      params: { "post-id": "123" },
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
    // Both candidates are genuinely resolvable so only precedence decides.
    const ctx = createMockCtx({
      statMap: {
        "/project/app": { isFile: false, isDirectory: true },
        "/project/app/api/users/me/route.ts": { isFile: true, isDirectory: false },
        "/project/app/api/users/[id]/route.ts": { isFile: true, isDirectory: false },
      },
      dirMap: {
        "/project/app": [dir("api")],
        "/project/app/api": [dir("users")],
        "/project/app/api/users": [dir("me"), dir("[id]")],
        "/project/app/api/users/me": [],
        "/project/app/api/users/[id]": [],
      },
    });
    const result = await resolveAppRouteFile("/api/users/me", ctx);
    assertEquals(
      result,
      {
        file: "/project/app/api/users/me/route.ts",
        params: {},
      },
      "an exact segment must win over a resolvable [id] route",
    );
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
