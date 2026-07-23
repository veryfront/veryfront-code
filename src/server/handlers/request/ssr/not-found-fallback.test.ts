import "#veryfront/schemas/_test-setup.ts";
import "../../../../transforms/plugins/__tests__/code-parser-setup.ts";
import * as React from "react";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { cleanupBundler } from "../../../../rendering/cleanup.ts";
import { withTestContext } from "../../../../../tests/_helpers/context.ts";
import {
  __injectReactDOMServerForTests,
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

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
      stat: overrides.stat ?? (() => Promise.reject(new Deno.errors.NotFound("not found"))),
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

    afterEach(() => {
      resetReactCache();
      __setServerModuleLoaderForTests(null);
      __resetLogRecordEmitterForTests();
    });

    describe("tryNotFoundFallback", () => {
      it("returns null when app directory does not exist", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.reject(new Deno.errors.NotFound("not found")),
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
          stat: () => Promise.reject(new Deno.errors.NotFound("not found")),
        });
        const ctx = makeCtx({ adapter });
        const req = new Request("http://localhost/");
        const builder = new ResponseBuilder();

        const result = await tryNotFoundFallback(req, "", ctx, builder);
        assertEquals(result, null);
      });

      it("propagates app directory permission failures", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.reject(new Deno.errors.PermissionDenied("private-permission-canary")),
        });

        await assertRejects(
          () =>
            tryNotFoundFallback(
              new Request("http://localhost/missing"),
              "missing",
              makeCtx({ adapter }),
              new ResponseBuilder(),
            ),
          Deno.errors.PermissionDenied,
          "private-permission-canary",
        );
      });

      it("propagates custom page read permission failures", async () => {
        const adapter = createMockAdapter({
          stat: () => Promise.resolve({ isFile: false, isDirectory: true, size: 0, mtime: null }),
          readFile: () => Promise.reject(new Deno.errors.PermissionDenied("private-read-canary")),
        });

        await assertRejects(
          () =>
            tryNotFoundFallback(
              new Request("http://localhost/missing"),
              "missing",
              makeCtx({ adapter }),
              new ResponseBuilder(),
            ),
          Deno.errors.PermissionDenied,
          "private-read-canary",
        );
      });

      it("renders the nearest ancestor app not-found component without source metadata", async () => {
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
          assertEquals(html.includes("data-node-file"), false);
          assertEquals(html.includes("Root Missing"), false);
        });
      });

      it("renders with the React version configured for the project", async () => {
        const adapter = await getAdapter();
        const loadedVersions: string[] = [];
        const server = (marker: string) => ({
          renderToString: () => `<p>${marker}</p>`,
          renderToStaticMarkup: () => `<p>${marker}</p>`,
        });

        await withTestContext("not-found-fallback-react-version", async (context) => {
          __setServerModuleLoaderForTests((_url, label, reactVersion) => {
            if (label === "React") {
              loadedVersions.push(reactVersion);
              return Promise.resolve({ default: React });
            }
            throw new Error(`Unexpected module load: ${label}`);
          });
          __injectReactDOMServerForTests(server("default-react"));
          __injectReactDOMServerForTests(server("project-react-18"), "18.3.1");

          const appDir = join(context.projectDir, "src", "site");
          await mkdir(appDir, { recursive: true });
          await writeTextFile(
            join(appDir, "not-found.tsx"),
            "export default function NotFound() { return null; }",
          );

          const ctx = makeCtx({
            projectDir: context.projectDir,
            adapter,
            config: {
              react: { version: "18.3.1" },
              directories: { app: "src/site" },
            } as HandlerContext["config"],
          });
          const result = await tryNotFoundFallback(
            new Request("http://localhost/missing"),
            "missing",
            ctx,
            new ResponseBuilder(),
          );

          assertExists(result);
          assertStringIncludes(await result.text(), "project-react-18");
          assertEquals(loadedVersions, ["18.3.1"]);
        });
      });

      it("uses a generic 404 when the custom component fails to render", async () => {
        const adapter = await getAdapter();
        const entries: LogEntry[] = [];
        __registerLogRecordEmitter((entry) => entries.push(entry));

        await withTestContext("not-found-fallback-render-failure", async (context) => {
          const appDir = join(context.projectDir, "app");
          await mkdir(appDir, { recursive: true });
          await writeTextFile(
            join(appDir, "not-found.tsx"),
            `export default function NotFound() { return <p>private-source-canary</p>; }`,
          );
          __injectReactDOMServerForTests({
            renderToString: () => {
              throw new Error("private-render-error-canary");
            },
            renderToStaticMarkup: () => {
              throw new Error("private-render-error-canary");
            },
          });

          const result = await tryNotFoundFallback(
            new Request("http://localhost/private-route-canary"),
            "private-route-canary",
            makeCtx({
              projectDir: context.projectDir,
              adapter,
              isLocalProject: true,
            }),
            new ResponseBuilder(),
          );

          assertExists(result);
          assertEquals(result.status, 404);
          const html = await result.text();
          assertStringIncludes(html, "Not Found");
          assertEquals(html.includes("private-source-canary"), false);
          assertEquals(html.includes("private-route-canary"), false);
          assertEquals(html.includes("private-render-error-canary"), false);

          const failure = entries.find((entry) =>
            entry.message === "Custom not-found page render failed"
          );
          assertEquals(failure?.context, { errorCategory: "error" });
          assertEquals(JSON.stringify(entries).includes("private-render-error-canary"), false);
          assertEquals(JSON.stringify(entries).includes(context.projectDir), false);
        });
      });
    });
  },
);
