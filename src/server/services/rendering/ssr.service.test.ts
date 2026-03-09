import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SSRService } from "./ssr.service.ts";

describe("server/services/rendering/ssr.service", () => {
  describe("SSRService", () => {
    it("should be constructable without options", () => {
      const service = new SSRService();
      assertEquals(service instanceof SSRService, true);
    });

    it("should be constructable with cacheRepo option", () => {
      const mockRepo = {
        get: async () => null,
        set: async () => {},
        delete: async () => {},
        has: async () => false,
      };
      const service = new SSRService({ cacheRepo: mockRepo as any });
      assertEquals(service instanceof SSRService, true);
    });

    describe("checkMemoryPressure", () => {
      it("should return memory status with all required fields", () => {
        const service = new SSRService();
        const status = service.checkMemoryPressure();

        assertEquals(typeof status.shouldReject, "boolean");
        assertEquals(typeof status.heapUsedMB, "number");
        assertEquals(typeof status.heapLimitMB, "number");
        assertEquals(typeof status.heapUsedPercent, "number");
      });

      it("should report non-negative heap values", () => {
        const service = new SSRService();
        const status = service.checkMemoryPressure();

        assertEquals(status.heapUsedMB >= 0, true);
        assertEquals(status.heapLimitMB > 0, true);
        assertEquals(status.heapUsedPercent >= 0, true);
      });

      it("should not reject under normal test conditions", () => {
        const service = new SSRService();
        const status = service.checkMemoryPressure();
        assertEquals(status.shouldReject, false);
      });

      it("should report heap used percent between 0 and 100", () => {
        const service = new SSRService();
        const status = service.checkMemoryPressure();
        assertEquals(status.heapUsedPercent >= 0 && status.heapUsedPercent <= 100, true);
      });
    });
  });
});
