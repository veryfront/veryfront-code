import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type BatchHandlerOptions,
  clearBatchCache,
  getBatchCacheStats,
  handleModuleBatch,
} from "./module-batch-handler.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

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
      function createBatchRequest(paths?: string, extraParams?: string): Request {
        const url = new URL("http://localhost:8080/_vf_modules/_batch");

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
    });
  },
);
