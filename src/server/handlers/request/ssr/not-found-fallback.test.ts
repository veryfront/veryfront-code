import "../../../../transforms/plugins/__tests__/code-parser-setup.ts";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { cleanupBundler } from "../../../../rendering/cleanup.ts";
import { withTestContext } from "../../../../../tests/_helpers/context.ts";

function createMockAdapter(
  overrides: {
    stat?: (
      path: string,
    ) => Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtime: null }>;
    readFile?: (path: string) => Promise<string>;
  } = {},
): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(false),
      readFile: overrides.readFile ?? (() => Promise.resolve("")),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: overrides.stat ?? (() => Promise.reject(new Error("not found"))),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  };
}

describe(
  "server/handlers/request/ssr/not-found-fallback",
  { sanitizeOps: false, sanitizeResources: false },
  () => {
    afterAll(async () => {
      await cleanupBundler();
    });

    describe("tryNotFoundFallback", () => {
      it("returns null when app directory does not exist", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.reject(new Error("ENOENT")),
        });
        const ctx = makeCtx({ adapter });
        const req = new Request("http://localhost/not-found");
        const builder = new ResponseBuilder();

        const result = await tryNotFoundFallback(req, "not-found", ctx, builder);
        assertEquals(result, null);
      });

      it("returns null when app path is not a directory", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.resolve({ isFile: true, isDirectory: false, size: 0, mtime: null }),
        });
        const ctx = makeCtx({ adapter });
        const req = new Request("http://localhost/not-found");
        const builder = new ResponseBuilder();

        const result = await tryNotFoundFallback(req, "not-found", ctx, builder);
        assertEquals(result, null);
      });

      it("returns null when slug is empty and app directory doesn't exist", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.reject(new Error("ENOENT")),
        });
        const ctx = makeCtx({ adapter });
        const req = new Request("http://localhost/");
        const builder = new ResponseBuilder();

        const result = await tryNotFoundFallback(req, "", ctx, builder);
        assertEquals(result, null);
      });

      it("renders the nearest ancestor app not-found component", async () => {
        const adapter = await getAdapter();

        await withTestContext("not-found-fallback-success", async (context) => {
          const segDir = join(context.projectDir, "app", "a", "b");
          await mkdir(segDir, { recursive: true });
          await writeTextFile(
            join(context.projectDir, "app", "not-found.tsx"),
            `export default function RootNotFound(){ return <p>Root Missing</p>; }`,
          );
          await writeTextFile(
            join(segDir, "not-found.tsx"),
            `export default function NotFound(){ return <p>Missing B</p>; }`,
          );

          const ctx = makeCtx({
            projectDir: context.projectDir,
            adapter,
          });
          const req = new Request("http://localhost/a/b/missing");
          const builder = new ResponseBuilder();

          const result = await tryNotFoundFallback(req, "a/b/missing", ctx, builder);
          assertExists(result);
          assertEquals(result.status, 404);
          const html = await result.text();
          assertStringIncludes(html, "Missing B");
          assertStringIncludes(html, 'data-node-file="app/a/b/not-found.tsx"');
          assertEquals(html.includes("Root Missing"), false);
        });
      });
    });
  },
);
