import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type BatchHandlerOptions,
  buildBatchTransformCacheKey,
  clearBatchCache,
  getBatchCacheStats,
  handleModuleBatch,
} from "./module-batch-handler.ts";
import { serveModule } from "./module-server.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "../../release-assets/constants.ts";
import {
  clearReactVersionCache,
  getDependencyPinningSnapshot,
} from "../../transforms/esm/package-registry.ts";
import { buildModuleTransformCacheKey } from "#veryfront/cache/keys.ts";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(name);
  } else {
    setEnv(name, value);
  }
}

describe(
  "modules/server/module-batch-handler",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
    describe("buildBatchTransformCacheKey", () => {
      it("isolates transforms by dependency, content source, source bytes, and origin", () => {
        const flagOff = buildBatchTransformCacheKey(
          "project",
          "pages/index.js",
          false,
          "off",
          "release-a",
          "content-a",
          "https://app.example",
        );
        const firstPins = buildBatchTransformCacheKey(
          "project",
          "pages/index.js",
          false,
          "on:first",
          "release-a",
          "content-a",
          "https://app.example",
        );
        const changedPins = buildBatchTransformCacheKey(
          "project",
          "pages/index.js",
          false,
          "on:second",
          "release-a",
          "content-a",
          "https://app.example",
        );
        const changedRelease = buildBatchTransformCacheKey(
          "project",
          "pages/index.js",
          false,
          "on:first",
          "release-b",
          "content-a",
          "https://app.example",
        );
        const changedSource = buildBatchTransformCacheKey(
          "project",
          "pages/index.js",
          false,
          "on:first",
          "release-a",
          "content-b",
          "https://app.example",
        );
        const changedOrigin = buildBatchTransformCacheKey(
          "project",
          "pages/index.js",
          false,
          "on:first",
          "release-a",
          "content-a",
          "https://other.example",
        );
        const flagOffWithDifferentInputs = buildBatchTransformCacheKey(
          "project",
          "pages/index.js",
          false,
          "off",
          "release-b",
          "content-b",
          "https://other.example",
        );

        assertEquals(
          new Set([
            flagOff,
            firstPins,
            changedPins,
            changedRelease,
            changedSource,
            changedOrigin,
          ]).size,
          6,
        );
        assertEquals(flagOffWithDifferentInputs, flagOff);
        assertEquals(
          flagOff,
          buildModuleTransformCacheKey("project", "pages/index.js", false),
        );
      });

      it("isolates transforms by the configured server external package set", () => {
        const args = [
          "project",
          "pages/index.js",
          false,
          "off",
          "release-a",
          "content-a",
          "https://app.example",
        ] as const;
        const baseline = buildBatchTransformCacheKey(...args);
        const knex = buildBatchTransformCacheKey(...args, ["knex"]);
        const prismaAndKnex = buildBatchTransformCacheKey(...args, ["@prisma/client", "knex"]);
        const reordered = buildBatchTransformCacheKey(...args, ["knex", "@prisma/client"]);

        assertEquals(knex === baseline, false);
        assertEquals(prismaAndKnex === knex, false);
        assertEquals(reordered, prismaAndKnex);
      });
    });

    describe("clearBatchCache / getBatchCacheStats", () => {
      it("should start with empty cache stats", () => {
        clearBatchCache();
        const stats = getBatchCacheStats();
        assertEquals(stats.size, 0);
        assertEquals(stats.keys.length, 0);
      });

      it("should clear all cache entries", () => {
        clearBatchCache();
        assertEquals(getBatchCacheStats().size, 0);
      });

      it("should clear cache for specific project slug", async () => {
        clearBatchCache();

        async function cacheOneTransform(projectSlug: string): Promise<void> {
          const adapter = createMockAdapter();
          adapter.fs.files.set(`/test-project/${projectSlug}.tsx`, "export const value = 1;");
          const url = new URL("/_vf_modules/_batch", "http://localhost:8080");
          url.searchParams.set("paths", `${projectSlug}.js`);
          const response = await handleModuleBatch(new Request(url.toString()), {
            projectDir: "/test-project",
            adapter,
            projectSlug,
            releaseId: `rel-${projectSlug}`,
            dev: false,
          });
          assertEquals(response.status, 200, `project ${projectSlug} must serve its module`);
          await response.text();
        }

        await cacheOneTransform("a");
        await cacheOneTransform("b");
        assertEquals(getBatchCacheStats().size, 2, "both projects cached a transform");

        clearBatchCache("a");

        const stats = getBatchCacheStats();
        assertEquals(stats.size, 1, "clearing project a must leave project b's entry");
        assertEquals(
          stats.keys.every((key) => key.startsWith("b:")),
          true,
          "clearing project a must leave only project b entries",
        );

        clearBatchCache();
      });

      it("clears entries for a project that supplies a projectId", async () => {
        clearBatchCache();

        async function cacheOneTransform(
          identity: { projectSlug: string; projectId?: string },
        ): Promise<void> {
          const adapter = createMockAdapter();
          adapter.fs.files.set(
            `/test-project/${identity.projectSlug}.tsx`,
            "export const value = 1;",
          );
          const url = new URL("/_vf_modules/_batch", "http://localhost:8080");
          url.searchParams.set("paths", `${identity.projectSlug}.js`);
          const response = await handleModuleBatch(new Request(url.toString()), {
            projectDir: "/test-project",
            adapter,
            projectSlug: identity.projectSlug,
            projectId: identity.projectId,
            releaseId: `rel-${identity.projectSlug}`,
            dev: false,
          });
          assertEquals(
            response.status,
            200,
            `project ${identity.projectSlug} must serve its module`,
          );
          await response.text();
        }

        await cacheOneTransform({ projectSlug: "slug-a", projectId: "id-a" });
        await cacheOneTransform({ projectSlug: "slug-b", projectId: "id-b" });
        assertEquals(getBatchCacheStats().size, 2, "both projects cached a transform");

        clearBatchCache({ projectSlug: "slug-a", projectId: "id-a" });

        const stats = getBatchCacheStats();
        assertEquals(
          stats.size,
          1,
          "clearing a project that supplies a projectId must delete its entry, not silently match nothing",
        );
        assertEquals(
          stats.keys.every((key) => key.startsWith("id-b:")),
          true,
          "only the other project's entries may survive the invalidation",
        );

        clearBatchCache();
      });
    });

    describe("handleModuleBatch", () => {
      function createBatchRequest(
        paths?: string,
        extraParams?: string,
        origin = "http://localhost:8080",
      ): Request {
        const url = new URL("/_vf_modules/_batch", origin);

        if (paths !== undefined) url.searchParams.set("paths", paths);
        if (extraParams) {
          const extra = new URLSearchParams(extraParams);
          for (const [key, value] of extra) url.searchParams.append(key, value);
        }

        return new Request(url.toString());
      }

      function createOptions(
        overrides: Partial<BatchHandlerOptions> = {},
      ): BatchHandlerOptions {
        return {
          projectDir: "/test-project",
          adapter: createMockAdapter(),
          projectSlug: "test",
          dev: true,
          ...overrides,
        };
      }

      function extractChildVersion(code: string): string {
        const match = code.match(/\.\/child\.js\?[^"']*&v=([^"'&]+)/);
        return match?.[1] ?? "";
      }

      it("should return 400 when paths parameter is missing", async () => {
        const response = await handleModuleBatch(createBatchRequest(), createOptions());
        assertEquals(response.status, 400);
        assertEquals(await response.text(), "Missing 'paths' parameter");
      });

      it("should return 400 when paths parameter is empty string", async () => {
        const response = await handleModuleBatch(createBatchRequest(""), createOptions());
        assertEquals(response.status, 400);
        assertEquals(await response.text(), "Missing 'paths' parameter");
      });

      it("should return 400 when paths has only whitespace/commas", async () => {
        const response = await handleModuleBatch(createBatchRequest(",,,"), createOptions());
        assertEquals(response.status, 400);
        assertEquals(await response.text(), "No valid paths provided");
      });

      it("should return 400 when too many modules requested", async () => {
        const paths = Array.from({ length: 101 }, (_, i) => `module${i}.js`).join(",");
        const response = await handleModuleBatch(createBatchRequest(paths), createOptions());
        assertEquals(response.status, 400);
        assertEquals((await response.text()).includes("Too many modules"), true);
      });

      it("should return 404 when no modules could be loaded", async () => {
        const response = await handleModuleBatch(
          createBatchRequest("nonexistent.js"),
          createOptions(),
        );
        assertEquals(response.status, 404);
        assertEquals(await response.text(), "No modules could be loaded");
      });

      it("caches missing module lookups", async () => {
        clearBatchCache();
        const adapter = createMockAdapter();
        const originalStat = adapter.fs.stat;
        let statCalls = 0;
        adapter.fs.stat = (path: string) => {
          statCalls++;
          return originalStat(path);
        };
        const options = createOptions({ adapter });

        const firstResponse = await handleModuleBatch(
          createBatchRequest("components/Missing.js"),
          options,
        );
        assertEquals(firstResponse.status, 404);
        const afterFirstMiss = statCalls;
        assertEquals(afterFirstMiss > 0, true);

        const secondResponse = await handleModuleBatch(
          createBatchRequest("components/Missing.js"),
          options,
        );
        assertEquals(secondResponse.status, 404);
        assertEquals(statCalls, afterFirstMiss);
      });

      it("scopes missing module lookups by project identity", async () => {
        clearBatchCache();

        const missingAdapter = createMockAdapter();
        const firstResponse = await handleModuleBatch(
          createBatchRequest("components/Missing.js"),
          {
            projectDir: "/shared-project-dir",
            adapter: missingAdapter,
            projectId: "project-a",
            projectSlug: "project-a",
            dev: true,
          },
        );
        assertEquals(firstResponse.status, 404);

        const presentAdapter = createMockAdapter();
        presentAdapter.fs.files.set(
          "/shared-project-dir/components/Missing.tsx",
          "export const value = 1;",
        );
        const secondResponse = await handleModuleBatch(
          createBatchRequest("components/Missing.js"),
          {
            projectDir: "/shared-project-dir",
            adapter: presentAdapter,
            projectId: "project-b",
            projectSlug: "project-b",
            dev: true,
          },
        );

        assertEquals(secondResponse.status, 200);
      });

      it("should successfully batch existing modules", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test-project/hello.tsx",
          "export default function Hello() { return null; }",
        );

        const response = await handleModuleBatch(createBatchRequest("hello.js"), {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: true,
        });

        assertEquals(response.status, 200);
        assertEquals(
          response.headers.get("Content-Type"),
          "application/javascript; charset=utf-8",
        );
        assertEquals(response.headers.get("X-Batch-Modules"), "1");

        const code = await response.text();
        assertEquals(code.includes("__vf_batch_modules"), true);
        assertEquals(code.includes("getModule"), true);
      });

      it("streams cached batch bundles without joining the full response", async () => {
        clearBatchCache();
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/streamed.tsx", "export const streamed = true;");
        const options = {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          releaseId: "rel-streamed",
          dev: false,
        };

        const firstResponse = await handleModuleBatch(createBatchRequest("streamed.js"), options);
        assertEquals(firstResponse.status, 200);
        await firstResponse.text();

        const originalJoin = Array.prototype.join;
        Array.prototype.join = function patchedJoin(this: unknown[], separator?: string) {
          if (this[0] === "// Veryfront Module Batch Bundle") {
            throw new Error("full bundle join should not be used");
          }
          return originalJoin.call(this, separator);
        };

        try {
          const secondResponse = await handleModuleBatch(
            createBatchRequest("streamed.js"),
            options,
          );
          assertEquals(secondResponse.status, 200);
          const code = await secondResponse.text();
          assertEquals(code.includes("__vf_batch_modules"), true);
          assertEquals(code.includes("streamed.js"), true);
        } finally {
          Array.prototype.join = originalJoin;
        }
      });

      it("should include batch metadata headers", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/page.tsx", "export default () => null;");

        const response = await handleModuleBatch(createBatchRequest("page.js"), {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: true,
        });

        assertEquals(response.status, 200);
        assertEquals(response.headers.has("X-Batch-Duration"), true);
        assertEquals(response.headers.has("X-Batch-Slow"), true);
      });

      it("should handle mix of existing and missing modules", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/exists.tsx", "export const x = 1;");

        const response = await handleModuleBatch(
          createBatchRequest("exists.js,missing.js"),
          {
            projectDir: "/test-project",
            adapter,
            projectSlug: "test",
            dev: true,
          },
        );

        assertEquals(response.status, 200);
        const code = await response.text();
        assertEquals(code.includes("exists.js"), true);
        assertEquals(code.includes("Failed: missing.js"), true);
      });

      it("escapes module paths in the batch bundle", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/exists.tsx", "export const x = 1;");
        const attackPath = 'evil");globalThis.__pwned=1;//';

        const response = await handleModuleBatch(
          createBatchRequest(`exists.js,${attackPath}`),
          createOptions({ adapter }),
        );

        assertEquals(response.status, 200);
        const code = await response.text();
        assertStringIncludes(
          code,
          `__vf_batch_modules.set(${JSON.stringify(attackPath)}`,
          "the failing path must be emitted as a JSON-escaped literal",
        );
        assertEquals(
          code.includes('set("evil");'),
          false,
          "an attacker-supplied path must not close the string literal",
        );
      });

      it("escapes transform error text in the batch bundle", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/exists.tsx", "export const x = 1;");
        adapter.fs.files.set("/test-project/broken.tsx", "export const b = 1;");
        const errorMessage = 'boom "quoted" \\ backslash\nnewline';
        const readFile = adapter.fs.readFile;
        adapter.fs.readFile = (path: string) =>
          path.includes("broken") ? Promise.reject(new Error(errorMessage)) : readFile(path);

        const response = await handleModuleBatch(
          createBatchRequest("exists.js,broken.js"),
          createOptions({ adapter }),
        );

        assertEquals(response.status, 200);
        const code = await response.text();
        assertStringIncludes(
          code,
          `{ __vf_error: ${JSON.stringify(errorMessage)} }`,
          "the transform error must be emitted as a JSON-escaped literal",
        );
        assertEquals(
          code.includes('__vf_error: "boom "'),
          false,
          "a quote in the error message must not close the string literal",
        );
        for (const line of code.split("\n")) {
          assertEquals(
            line.trimStart().startsWith("newline"),
            false,
            "a newline in the error message must not start a new statement",
          );
        }
      });

      it("should set immutable cache headers for non-dev mode", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/comp.tsx", "export const y = 2;");

        const response = await handleModuleBatch(createBatchRequest("comp.js"), {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: false,
        });

        assertEquals(response.status, 200);
        assertEquals(response.headers.get("Cache-Control")?.includes("immutable"), true);
      });

      it("isolates identical non-dev transforms across releases with the same pins", async () => {
        clearBatchCache();
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test-project/released.ts",
          'export const value = "same-source";',
        );
        const baseOptions: BatchHandlerOptions = {
          projectDir: "/test-project",
          adapter,
          projectId: "project-1",
          projectSlug: "same-project",
          isLocalProject: false,
          dev: false,
        };

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          const snapshot = await getDependencyPinningSnapshot("/test-project");
          const firstResponse = await handleModuleBatch(
            createBatchRequest(
              "released.js",
              `pins=${encodeURIComponent(snapshot.cacheKey)}`,
            ),
            { ...baseOptions, releaseId: "rel-a" },
          );
          assertEquals(firstResponse.status, 200);
          await firstResponse.text();
          const firstKeys = getBatchCacheStats().keys;
          assertEquals(firstKeys.length, 1);

          const secondResponse = await handleModuleBatch(
            createBatchRequest(
              "released.js",
              `pins=${encodeURIComponent(snapshot.cacheKey)}`,
            ),
            { ...baseOptions, releaseId: "rel-b" },
          );
          assertEquals(secondResponse.status, 200);
          await secondResponse.text();
          const secondKeys = getBatchCacheStats().keys;

          assertEquals(secondKeys.length, 2);
          assertEquals(new Set(secondKeys).size, 2);
          assertEquals(secondKeys.some((key) => key.includes("release-rel-a")), true);
          assertEquals(secondKeys.some((key) => key.includes("release-rel-b")), true);
        } finally {
          restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          clearReactVersionCache();
        }
      });

      it("re-reads the same non-dev source path before cache lookup", async () => {
        clearBatchCache();
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const adapter = createMockAdapter();
        const sourcePath = "/test-project/changed.ts";
        const options: BatchHandlerOptions = {
          projectDir: "/test-project",
          adapter,
          projectId: "project-1",
          projectSlug: "same-project",
          releaseId: "rel-a",
          isLocalProject: false,
          dev: false,
        };
        adapter.fs.files.set(sourcePath, 'export const value = "source-a";');

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          const snapshot = await getDependencyPinningSnapshot("/test-project");
          const firstResponse = await handleModuleBatch(
            createBatchRequest(
              "changed.js",
              `pins=${encodeURIComponent(snapshot.cacheKey)}`,
            ),
            options,
          );
          assertEquals(firstResponse.status, 200);
          assertStringIncludes(await firstResponse.text(), "source-a");

          adapter.fs.files.set(sourcePath, 'export const value = "source-b";');
          const secondResponse = await handleModuleBatch(
            createBatchRequest(
              "changed.js",
              `pins=${encodeURIComponent(snapshot.cacheKey)}`,
            ),
            options,
          );
          assertEquals(secondResponse.status, 200);
          const secondCode = await secondResponse.text();

          assertStringIncludes(secondCode, "source-b");
          assertEquals(secondCode.includes("source-a"), false);
          assertEquals(getBatchCacheStats().size, 2);
        } finally {
          restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          clearReactVersionCache();
        }
      });

      it("requires HTTP revalidation when dependency pinning is enabled", async () => {
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/comp.tsx", "export const y = 2;");

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          const snapshot = await getDependencyPinningSnapshot("/test-project");
          const response = await handleModuleBatch(
            createBatchRequest("comp.js", `pins=${snapshot.cacheKey}`),
            {
              projectDir: "/test-project",
              adapter,
              projectSlug: "test",
              dev: false,
            },
          );

          assertEquals(response.status, 200);
          assertEquals(
            response.headers.get("Cache-Control"),
            "private, no-cache, max-age=0, must-revalidate",
          );
        } finally {
          restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          clearReactVersionCache();
        }
      });

      it("rejects unversioned batch requests when dependency pinning is enabled", async () => {
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/comp.tsx", "export const y = 2;");

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          const response = await handleModuleBatch(createBatchRequest("comp.js"), {
            projectDir: "/test-project",
            adapter,
            projectSlug: "test",
            dev: false,
          });

          assertEquals(response.status, 409);
          assertEquals(response.headers.get("Cache-Control"), "no-store");
          assertEquals(await response.text(), "Dependency snapshot is required");
        } finally {
          restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          clearReactVersionCache();
        }
      });

      it("rejects malformed snapshot parameters even when pinning is disabled", async () => {
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/comp.tsx", "export const y = 2;");

        try {
          deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
          clearReactVersionCache();
          for (
            const query of [
              "pins=",
              "pins=off",
              "pins=malformed",
              "pins=on%3Afirst&pins=on%3Asecond",
              "pins=on%3Aunknown",
            ]
          ) {
            const response = await handleModuleBatch(
              createBatchRequest("comp.js", query),
              {
                projectDir: "/test-project",
                adapter,
                projectSlug: "test",
                dev: false,
              },
            );

            assertEquals(response.status, 409);
            assertEquals(response.headers.get("cache-control"), "no-store");
          }
        } finally {
          restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          clearReactVersionCache();
        }
      });

      it("uses the requested dependency snapshot's React version", async () => {
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const projectDir = await Deno.makeTempDir({ prefix: "vf-batch-react-snapshot-" });
        const packageJsonPath = `${projectDir}/package.json`;
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          `${projectDir}/comp.tsx`,
          `import React from "react";\nexport default React;\n`,
        );

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          clearReactVersionCache();
          await Deno.writeTextFile(
            packageJsonPath,
            JSON.stringify({ dependencies: { react: "18.3.1" } }),
          );
          await Deno.utime(packageJsonPath, new Date(1_000), new Date(1_000));
          const snapshotA = await getDependencyPinningSnapshot(projectDir);

          await Deno.writeTextFile(
            packageJsonPath,
            JSON.stringify({ dependencies: { react: "19.2.4" } }),
          );
          await Deno.utime(packageJsonPath, new Date(2_000), new Date(2_000));
          const snapshotB = await getDependencyPinningSnapshot(projectDir);

          const currentResponse = await handleModuleBatch(
            createBatchRequest("comp.js", `pins=${snapshotB.cacheKey}`),
            {
              projectDir,
              adapter,
              projectSlug: "react-current",
              dev: true,
            },
          );
          assertEquals(currentResponse.status, 200);
          assertStringIncludes(await currentResponse.text(), "react@19.2.4");

          const historicalResponse = await handleModuleBatch(
            createBatchRequest("comp.js", `pins=${snapshotA.cacheKey}`),
            {
              projectDir,
              adapter,
              projectSlug: "react-historical",
              dev: true,
            },
          );
          assertEquals(historicalResponse.status, 200);
          assertStringIncludes(await historicalResponse.text(), "react@18.3.1");
        } finally {
          restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          clearReactVersionCache();
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("path-binds browser batch static and computed child modules", async () => {
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const projectDir = await Deno.makeTempDir({ prefix: "vf-batch-path-pins-" });
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          `${projectDir}/components/Parent.ts`,
          [
            `export { child } from "./Child.js";`,
            `const relativePath = "./Child.js";`,
            `const rootPath = "/_vf_modules/components/Child.js";`,
            `export const loadRelative = () => import(relativePath);`,
            `export const loadRoot = () => import(rootPath);`,
          ].join("\n"),
        );
        adapter.fs.files.set(
          `${projectDir}/components/Child.ts`,
          [
            `import React from "react";`,
            `import value from "snapshot-package";`,
            `export const child = [React, value];`,
          ].join("\n"),
        );

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          await Deno.writeTextFile(
            `${projectDir}/package.json`,
            JSON.stringify({
              dependencies: {
                react: "18.3.1",
                "snapshot-package": "1.0.0",
              },
            }),
          );
          clearReactVersionCache();
          const snapshot = await getDependencyPinningSnapshot(projectDir);
          const encodedSnapshot = encodeURIComponent(snapshot.cacheKey);
          const response = await handleModuleBatch(
            createBatchRequest(
              "components/Parent.js",
              `pins=${encodedSnapshot}`,
            ),
            {
              projectDir,
              adapter,
              projectSlug: "batch-path-pins",
              isLocalProject: true,
              dev: true,
            },
          );
          assertEquals(response.status, 200);
          const code = await response.text();
          const childPath = `/_vf_modules/_pins/${encodedSnapshot}/components/Child.js`;
          assertStringIncludes(code, childPath);
          assertStringIncludes(code, "/*__vf_dependency_pinned__*/");
          assertStringIncludes(
            code,
            `"/_vf_modules/_pins/${encodedSnapshot}/components/Parent.js"`,
          );
          assertEquals(code.includes("?pins="), false);

          const childResponse = await serveModule(
            new Request(`http://localhost:8080${childPath}`),
            {
              projectId: "batch-path-pins",
              projectDir,
              adapter,
              isLocalProject: true,
            },
          );
          assertEquals(childResponse.status, 200);
          const childCode = await childResponse.text();
          assertStringIncludes(childCode, "snapshot-package@1.0.0");
          assertStringIncludes(childCode, "react@18.3.1");
        } finally {
          restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          clearReactVersionCache();
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("path-binds same-origin batch literals without cross-origin cache reuse", async () => {
        clearBatchCache();
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const projectDir = await Deno.makeTempDir({ prefix: "vf-batch-origin-pins-" });
        const adapter = createMockAdapter();
        const firstOrigin = "https://batch-a.example";
        const secondOrigin = "https://batch-b.example";
        const foreignModuleUrl = "https://cdn.example/_vf_modules/shared/Foreign.js";
        adapter.fs.files.set(
          `${projectDir}/components/Parent.ts`,
          [
            `export { value as absolute } from "${firstOrigin}/_vf_modules/shared/Absolute.js";`,
            `export { value as protocol } from "//batch-a.example/_vf_modules/shared/Protocol.js";`,
            `export { value as foreign } from "${foreignModuleUrl}";`,
          ].join("\n"),
        );
        adapter.fs.files.set(
          `${projectDir}/shared/Absolute.ts`,
          `export const value = "absolute";`,
        );
        adapter.fs.files.set(
          `${projectDir}/shared/Protocol.ts`,
          `export const value = "protocol";`,
        );

        try {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
          await Deno.writeTextFile(
            `${projectDir}/package.json`,
            JSON.stringify({ dependencies: {} }),
          );
          clearReactVersionCache();
          const snapshot = await getDependencyPinningSnapshot(projectDir);
          const encodedSnapshot = encodeURIComponent(snapshot.cacheKey);
          const requestParams = `pins=${encodedSnapshot}`;
          const options: BatchHandlerOptions = {
            projectDir,
            adapter,
            projectId: "batch-origin-pins",
            projectSlug: "batch-origin-pins",
            contentSourceId: "release-origin-pins",
            isLocalProject: true,
            dev: false,
          };
          const absolutePath = `/_vf_modules/_pins/${encodedSnapshot}/shared/Absolute.js`;
          const protocolPath = `/_vf_modules/_pins/${encodedSnapshot}/shared/Protocol.js`;

          const firstResponse = await handleModuleBatch(
            createBatchRequest("components/Parent.js", requestParams, firstOrigin),
            options,
          );
          assertEquals(firstResponse.status, 200);
          const firstCode = await firstResponse.text();
          assertStringIncludes(firstCode, absolutePath);
          assertStringIncludes(firstCode, protocolPath);
          assertStringIncludes(firstCode, foreignModuleUrl);

          for (const childPath of [absolutePath, protocolPath]) {
            const childResponse = await serveModule(
              new Request(new URL(childPath, firstOrigin)),
              {
                projectId: "batch-origin-pins",
                projectSlug: "batch-origin-pins",
                projectDir,
                adapter,
                isLocalProject: true,
              },
            );
            assertEquals(childResponse.status, 200);
          }
          assertEquals(getBatchCacheStats().size, 1);

          const secondResponse = await handleModuleBatch(
            createBatchRequest("components/Parent.js", requestParams, secondOrigin),
            options,
          );
          assertEquals(secondResponse.status, 200);
          const secondCode = await secondResponse.text();
          assertStringIncludes(
            secondCode,
            `${firstOrigin}/_vf_modules/shared/Absolute.js`,
          );
          assertStringIncludes(
            secondCode,
            "//batch-a.example/_vf_modules/shared/Protocol.js",
          );
          assertStringIncludes(secondCode, foreignModuleUrl);
          assertEquals(secondCode.includes(absolutePath), false);
          assertEquals(secondCode.includes(protocolPath), false);
          assertEquals(getBatchCacheStats().size, 2);
        } finally {
          clearBatchCache();
          restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          clearReactVersionCache();
          await Deno.remove(projectDir, { recursive: true });
        }
      });

      it("uses child source content for SSR import cache busters", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test-project/page.ts",
          `import { child } from "./child.js";\nexport const page = child;\n`,
        );
        adapter.fs.files.set("/test-project/child.ts", `export const child = "one";\n`);

        const firstResponse = await handleModuleBatch(
          createBatchRequest("page.js", "ssr=true"),
          {
            projectDir: "/test-project",
            adapter,
            projectSlug: "test",
            dev: true,
          },
        );
        assertEquals(firstResponse.status, 200);
        const firstVersion = extractChildVersion(await firstResponse.text());

        adapter.fs.files.set("/test-project/child.ts", `export const child = "two";\n`);

        const secondResponse = await handleModuleBatch(
          createBatchRequest("page.js", "ssr=true"),
          {
            projectDir: "/test-project",
            adapter,
            projectSlug: "test",
            dev: true,
          },
        );
        assertEquals(secondResponse.status, 200);
        const secondVersion = extractChildVersion(await secondResponse.text());

        assertEquals(firstVersion.length > 0, true);
        assertEquals(secondVersion.length > 0, true);
        assertEquals(firstVersion !== secondVersion, true);
      });

      it("does not reuse an unchanged root transform after a preview child changes", async () => {
        clearBatchCache();
        const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
        const adapter = createMockAdapter();
        const rootSource = `import { child } from "./child.js";\nexport const page = child;\n`;
        adapter.fs.files.set("/test-project/page.ts", rootSource);
        adapter.fs.files.set(
          "/test-project/child.ts",
          `export const child = "one";\n`,
        );
        const options: BatchHandlerOptions = {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          branch: "feature-a",
          contentSourceId: "preview-feature-a",
          isLocalProject: false,
          dev: false,
        };

        try {
          deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
          clearReactVersionCache();
          const firstResponse = await handleModuleBatch(
            createBatchRequest("page.js", "ssr=true"),
            options,
          );
          assertEquals(firstResponse.status, 200);
          const firstVersion = extractChildVersion(
            await firstResponse.text(),
          );

          adapter.fs.files.set(
            "/test-project/child.ts",
            `export const child = "two";\n`,
          );
          assertEquals(
            adapter.fs.files.get("/test-project/page.ts"),
            rootSource,
          );

          const secondResponse = await handleModuleBatch(
            createBatchRequest("page.js", "ssr=true"),
            options,
          );
          assertEquals(secondResponse.status, 200);
          const secondVersion = extractChildVersion(
            await secondResponse.text(),
          );

          assertEquals(firstVersion.length > 0, true);
          assertEquals(secondVersion.length > 0, true);
          assertEquals(firstVersion !== secondVersion, true);
          assertEquals(getBatchCacheStats().size, 0);
        } finally {
          restoreEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
          clearReactVersionCache();
        }
      });
    });
  },
);
