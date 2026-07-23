import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type BatchHandlerOptions,
  clearBatchCache,
  getBatchCacheStats,
  handleModuleBatch,
} from "./module-batch-handler.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { parseImports } from "#veryfront/transforms/esm/lexer.ts";

describe(
  "modules/server/module-batch-handler",
  { sanitizeResources: false, sanitizeOps: false },
  () => {
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

      it("should clear cache for specific project slug", () => {
        clearBatchCache("my-project");
        assertEquals(getBatchCacheStats().size, 0);
      });
    });

    describe("handleModuleBatch", () => {
      function createBatchRequest(
        paths?: string,
        extraParams?: string,
        method = "GET",
      ): Request {
        const url = new URL("http://localhost:8080/_vf_modules/_batch");

        if (paths !== undefined) url.searchParams.set("paths", paths);
        if (extraParams) {
          const extra = new URLSearchParams(extraParams);
          for (const [key, value] of extra) url.searchParams.append(key, value);
        }

        return new Request(url.toString(), { method });
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

      function extractModuleVersion(code: string, modulePath: string): string {
        const escapedPath = modulePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const match = code.match(new RegExp(`/_vf_modules/${escapedPath}[^"']*[?&]v=([^&"']+)`));
        return match?.[1] ?? "";
      }

      it("should return 400 when paths parameter is missing", async () => {
        const response = await handleModuleBatch(createBatchRequest(), createOptions());
        assertEquals(response.status, 400);
        assertEquals(await response.text(), "Missing 'paths' parameter");
      });

      it("rejects unsupported methods", async () => {
        const response = await handleModuleBatch(
          createBatchRequest("page.js", undefined, "POST"),
          createOptions(),
        );
        assertEquals(response.status, 405);
        assertEquals(response.headers.get("allow"), "GET, HEAD");
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

      it("rejects traversal and source-injection paths before filesystem access", async () => {
        for (const path of ["../secret.js", "/absolute.js", "safe.js\nexport default 1"]) {
          const response = await handleModuleBatch(createBatchRequest(path), createOptions());
          assertEquals(response.status, 400);
        }
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
        const imports = await parseImports(code);
        assertEquals(imports.length, 1);
        assertEquals(imports[0]?.n?.startsWith("/_vf_modules/hello.js?"), true);
      });

      it("returns headers without a body for HEAD requests", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/hello.tsx", "export const hello = true;");

        const response = await handleModuleBatch(
          createBatchRequest("hello.js", undefined, "HEAD"),
          createOptions({ adapter }),
        );

        assertEquals(response.status, 200);
        assertEquals(response.headers.get("X-Batch-Modules"), "1");
        assertEquals(await response.text(), "");
      });

      it("streams cached batch bundles without joining the full response", async () => {
        clearBatchCache();
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/streamed.tsx", "export const streamed = true;");
        const options = {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          releaseId: "release-streamed",
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

      it("isolates release transform caches by project directory when IDs are absent", async () => {
        clearBatchCache();
        const firstAdapter = createMockAdapter();
        firstAdapter.fs.files.set("/project-a/page.ts", "export const project = 'a';");
        const secondAdapter = createMockAdapter();
        secondAdapter.fs.files.set("/project-b/page.ts", "export const project = 'b';");

        const first = await handleModuleBatch(createBatchRequest("page.js"), {
          projectDir: "/project-a",
          adapter: firstAdapter,
          releaseId: "shared-release-name",
          dev: false,
        });
        const second = await handleModuleBatch(createBatchRequest("page.js"), {
          projectDir: "/project-b",
          adapter: secondAdapter,
          releaseId: "shared-release-name",
          dev: false,
        });

        const firstVersion = extractModuleVersion(await first.text(), "page.js");
        const secondVersion = extractModuleVersion(await second.text(), "page.js");
        assertEquals(firstVersion.length > 0, true);
        assertEquals(secondVersion.length > 0, true);
        assertEquals(firstVersion === secondVersion, false);
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

      it("sets immutable cache headers only for release-addressed batches", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/comp.tsx", "export const y = 2;");

        const mutableResponse = await handleModuleBatch(createBatchRequest("comp.js"), {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: false,
        });
        assertEquals(mutableResponse.status, 200);
        assertEquals(mutableResponse.headers.get("Cache-Control")?.includes("immutable"), false);

        const releaseResponse = await handleModuleBatch(createBatchRequest("comp.js"), {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          releaseId: "release-1",
          dev: false,
        });

        assertEquals(releaseResponse.status, 200);
        assertEquals(releaseResponse.headers.get("Cache-Control")?.includes("immutable"), true);
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
        const firstVersion = extractModuleVersion(await firstResponse.text(), "page.js");

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
        const secondVersion = extractModuleVersion(await secondResponse.text(), "page.js");

        assertEquals(firstVersion.length > 0, true);
        assertEquals(secondVersion.length > 0, true);
        assertEquals(firstVersion !== secondVersion, true);
      });
    });
  },
);
