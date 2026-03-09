import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SSRService } from "./ssr.service.ts";

describe("server/services/rendering/ssr.service", () => {
  describe("SSRService", () => {
    describe("constructor", () => {
      it("creates instance without options", () => {
        const service = new SSRService();
        assertEquals(service instanceof SSRService, true);
      });

      it("creates instance with empty options", () => {
        const service = new SSRService({});
        assertEquals(service instanceof SSRService, true);
      });

      it("creates instance with cacheRepo option", () => {
        const mockRepo = {
          get: () => Promise.resolve(null),
          set: () => Promise.resolve(),
          delete: () => Promise.resolve(),
        };
        const service = new SSRService({ cacheRepo: mockRepo as any });
        assertEquals(service instanceof SSRService, true);
      });
    });

    describe("checkMemoryPressure", () => {
      it("returns MemoryStatus object", () => {
        const service = new SSRService();
        const status = service.checkMemoryPressure();
        assertEquals(typeof status.shouldReject, "boolean");
        assertEquals(typeof status.heapUsedMB, "number");
        assertEquals(typeof status.heapLimitMB, "number");
        assertEquals(typeof status.heapUsedPercent, "number");
      });

      it("returns non-negative heap values", () => {
        const service = new SSRService();
        const status = service.checkMemoryPressure();
        assertEquals(status.heapUsedMB >= 0, true);
        assertEquals(status.heapLimitMB >= 0, true);
        assertEquals(status.heapUsedPercent >= 0, true);
      });
    });

    describe("createMemoryPressureResult", () => {
      it("returns result with 503 status", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("test-slug");
        assertEquals(result.status, 503);
      });

      it("returns non-streaming result", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("test-slug");
        assertEquals(result.isStreaming, false);
      });

      it("returns no-cache strategy", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("test-slug");
        assertEquals(result.cacheStrategy, "no-cache");
      });

      it("preserves slug in result", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("my-page");
        assertEquals(result.slug, "my-page");
      });

      it("returns HTML content", () => {
        const service = new SSRService();
        const result = service.createMemoryPressureResult("test");
        assertEquals(typeof result.html, "string");
        assertEquals((result.html?.length ?? 0) > 0, true);
      });
    });
  });
});
