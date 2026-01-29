import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { clearBatchCache, getBatchCacheStats, handleModuleBatch } from "./module-batch-handler.ts";
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
        const stats = getBatchCacheStats();
        assertEquals(stats.size, 0);
      });

      it("should clear cache for specific project slug", () => {
        // This tests that the function runs without error
        // (we can't populate the cache externally since transformCache is module-private)
        clearBatchCache("my-project");
        const stats = getBatchCacheStats();
        assertEquals(stats.size, 0);
      });
    });

    describe("handleModuleBatch", () => {
      function createBatchRequest(paths?: string, extraParams?: string): Request {
        let url = "http://localhost:8080/_vf_modules/_batch";
        const params: string[] = [];
        if (paths !== undefined) params.push(`paths=${paths}`);
        if (extraParams) params.push(extraParams);
        if (params.length > 0) url += `?${params.join("&")}`;
        return new Request(url);
      }

      function createOptions(overrides: Record<string, unknown> = {}) {
        const adapter = createMockAdapter();
        return {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: true,
          ...overrides,
        };
      }

      it("should return 400 when paths parameter is missing", async () => {
        const req = createBatchRequest();
        const response = await handleModuleBatch(req, createOptions());
        assertEquals(response.status, 400);
        const text = await response.text();
        assertEquals(text, "Missing 'paths' parameter");
      });

      it("should return 400 when paths parameter is empty string", async () => {
        const req = createBatchRequest("");
        const response = await handleModuleBatch(req, createOptions());
        assertEquals(response.status, 400);
        // Empty string is falsy, so hits "Missing 'paths' parameter"
        const text = await response.text();
        assertEquals(text, "Missing 'paths' parameter");
      });

      it("should return 400 when paths has only whitespace/commas", async () => {
        const req = createBatchRequest(",,,");
        const response = await handleModuleBatch(req, createOptions());
        assertEquals(response.status, 400);
        const text = await response.text();
        assertEquals(text, "No valid paths provided");
      });

      it("should return 400 when too many modules requested", async () => {
        const paths = Array.from({ length: 101 }, (_, i) => `module${i}.js`).join(",");
        const req = createBatchRequest(paths);
        const response = await handleModuleBatch(req, createOptions());
        assertEquals(response.status, 400);
        const text = await response.text();
        assertEquals(text.includes("Too many modules"), true);
      });

      it("should return 404 when no modules could be loaded", async () => {
        const req = createBatchRequest("nonexistent.js");
        const response = await handleModuleBatch(req, createOptions());
        assertEquals(response.status, 404);
        const text = await response.text();
        assertEquals(text, "No modules could be loaded");
      });

      it("should successfully batch existing modules", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test-project/hello.tsx",
          "export default function Hello() { return null; }",
        );

        const req = createBatchRequest("hello.js");
        const response = await handleModuleBatch(req, {
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

        const req = createBatchRequest("page.js");
        const response = await handleModuleBatch(req, {
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

        const req = createBatchRequest("exists.js,missing.js");
        const response = await handleModuleBatch(req, {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: true,
        });

        assertEquals(response.status, 200);
        const code = await response.text();
        assertEquals(code.includes("exists.js"), true);
        assertEquals(code.includes("Failed: missing.js"), true);
      });

      it("should set immutable cache headers for non-dev mode", async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set("/test-project/comp.tsx", "export const y = 2;");

        const req = createBatchRequest("comp.js");
        const response = await handleModuleBatch(req, {
          projectDir: "/test-project",
          adapter,
          projectSlug: "test",
          dev: false,
        });

        assertEquals(response.status, 200);
        const cacheControl = response.headers.get("Cache-Control");
        assertEquals(cacheControl?.includes("immutable"), true);
      });
    });
  },
);
