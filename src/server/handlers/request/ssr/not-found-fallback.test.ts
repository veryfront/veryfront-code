import "#veryfront/schemas/_test-setup.ts";
import "../../../../transforms/plugins/__tests__/code-parser-setup.ts";
import * as React from "react";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __setReservedComponentLoaderForTests, tryNotFoundFallback } from "./not-found-fallback.ts";
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
import { clearReactVersionCache } from "#veryfront/transforms/esm/package-registry.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
      __setReservedComponentLoaderForTests(null);
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

      it("fails closed before fallback loading when package.json is malformed", async () => {
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const projectDir = await Deno.makeTempDir({
          prefix: "vf-not-found-fallback-malformed-",
        });
        let statCalls = 0;

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          await Deno.writeTextFile(join(projectDir, "package.json"), "{ malformed");
          const adapter = createMockAdapter({
            stat: () => {
              statCalls++;
              return Promise.resolve({
                isFile: false,
                isDirectory: true,
                size: 0,
                mtime: null,
              });
            },
          });

          const result = await tryNotFoundFallback(
            new Request("http://localhost/missing"),
            "missing",
            makeCtx({ projectDir, adapter, isLocalProject: true }),
            new ResponseBuilder(),
          );

          assertEquals(result, null);
          assertEquals(statCalls, 0);
        } finally {
          if (originalFlag === undefined) {
            deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
          } else {
            setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          }
          clearReactVersionCache();
          await Deno.remove(projectDir, { recursive: true });
        }
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
            isLocalProject: true,
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

      it("renders the reserved not-found component without instrumentation in hosted production", async () => {
        const adapter = await getAdapter();

        await withTestContext("not-found-fallback-hosted", async (context) => {
          const segDir = join(context.projectDir, "app", "a", "b");
          await mkdir(segDir, { recursive: true });
          await writeTextFile(
            join(segDir, "not-found.tsx"),
            `export default function NotFound(){ return <p id="hosted-not-found">Missing Hosted</p>; }`,
          );

          const ctx = makeCtx({
            projectDir: context.projectDir,
            adapter,
            isLocalProject: false,
            resolvedEnvironment: "production",
            // Hosted production is release-addressed: computeContentSourceId
            // refuses a production content source without one.
            releaseId: "release-not-found-1",
          });
          const req = new Request("http://localhost/a/b/missing");
          const builder = new ResponseBuilder();

          const result = await tryNotFoundFallback(req, "a/b/missing", ctx, builder);
          assertExists(result);
          assertEquals(result.status, 404);
          const html = await result.text();
          // The id attribute only survives a real SSR render: the
          // extractNotFoundText fallback rebuilds the text as a bare <p>, so
          // this pins the assertion below to the render path.
          assertStringIncludes(html, '<p id="hosted-not-found">Missing Hosted</p>');
          assertEquals(html.includes("data-node-file"), false);
        });
      });

      it("keeps node positions on the reserved not-found component in hosted preview", async () => {
        const adapter = await getAdapter();

        await withTestContext("not-found-fallback-hosted-preview", async (context) => {
          const segDir = join(context.projectDir, "app", "a", "b");
          await mkdir(segDir, { recursive: true });
          await writeTextFile(
            join(segDir, "not-found.tsx"),
            `export default function NotFound(){ return <p id="preview-not-found">Missing Preview</p>; }`,
          );

          // Hosted preview compiles as production. Only the request
          // environment separates it from the case above.
          const ctx = makeCtx({
            projectDir: context.projectDir,
            adapter,
            isLocalProject: false,
            resolvedEnvironment: "preview",
          });
          const req = new Request("http://localhost/a/b/missing");
          const builder = new ResponseBuilder();

          const result = await tryNotFoundFallback(req, "a/b/missing", ctx, builder);
          assertExists(result);
          assertEquals(result.status, 404);
          const html = await result.text();
          assertStringIncludes(html, "Missing Preview");
          assertStringIncludes(html, 'data-node-file="app/a/b/not-found.tsx"');
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

      it("keeps the reserved component and React rendering on snapshot A after package state B", async () => {
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const projectDir = await Deno.makeTempDir({
          prefix: "vf-not-found-fallback-snapshot-",
        });
        const snapshotCaptured = deferred();
        const continueFallback = deferred();

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          await Deno.writeTextFile(
            join(projectDir, "package.json"),
            JSON.stringify({
              dependencies: {
                react: "^18.3.1",
                "example-package": "1.0.0",
              },
            }),
          );

          const adapter = createMockAdapter({
            stat: async (path: string) => {
              if (path === join(projectDir, "app")) {
                snapshotCaptured.resolve();
                await continueFallback.promise;
                return {
                  isFile: false,
                  isDirectory: true,
                  size: 0,
                  mtime: null,
                };
              }
              throw new Error("not found");
            },
          });
          let observed:
            | {
              reactVersion?: string;
              cacheKey?: string;
              dependencies?: Readonly<Record<string, string>>;
              source?: unknown;
              moduleServerOrigin?: string;
            }
            | undefined;
          __setReservedComponentLoaderForTests(
            (
              _dirs,
              _which,
              _projectDir,
              _mode,
              _adapter,
              _projectId,
              _contentSourceId,
              reactVersion,
              cacheKey,
              dependencies,
              source,
              moduleServerOrigin,
            ) => {
              observed = {
                reactVersion,
                cacheKey,
                dependencies,
                source,
                moduleServerOrigin,
              };
              return Promise.resolve(() => null);
            },
          );
          __setServerModuleLoaderForTests((_url, label) => {
            if (label === "React") return Promise.resolve({ default: React });
            throw new Error(`Unexpected module load: ${label}`);
          });
          __injectReactDOMServerForTests({
            renderToString: () => "<p>react-18</p>",
            renderToStaticMarkup: () => "<p>react-18</p>",
          }, "18.3.1");

          const responsePromise = tryNotFoundFallback(
            new Request("http://localhost/missing"),
            "missing",
            makeCtx({ projectDir, adapter }),
            new ResponseBuilder(),
          );

          await snapshotCaptured.promise;
          await Deno.writeTextFile(
            join(projectDir, "package.json"),
            JSON.stringify({
              dependencies: {
                react: "^19.0.0",
                "example-package": "2.0.0",
              },
            }),
          );
          continueFallback.resolve();

          const response = await responsePromise;
          assertExists(response);
          assertStringIncludes(await response.text(), "react-18");
          assertEquals(observed?.reactVersion, "18.3.1");
          assertEquals(observed?.cacheKey?.startsWith("on:"), true);
          assertEquals(observed?.dependencies, {
            react: "^18.3.1",
            "example-package": "1.0.0",
          });
          assertEquals(
            (observed?.source as { projectDir?: string } | undefined)?.projectDir,
            projectDir,
          );
          assertEquals(observed?.moduleServerOrigin, "http://localhost");
        } finally {
          continueFallback.resolve();
          __setReservedComponentLoaderForTests(null);
          if (originalFlag === undefined) {
            deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
          } else {
            setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          }
          clearReactVersionCache();
          await Deno.remove(projectDir, { recursive: true });
        }
      });
    });
  },
);
