import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { createCacheInstruments } from "./cache-instruments.ts";
import { metrics } from "@opentelemetry/api";

describe("cache-instruments", () => {
  describe("createCacheInstruments", () => {
    it("should create cache instruments with correct structure", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = createCacheInstruments(meter, config, runtimeState);

      assertExists(instruments.cacheGetCounter);
      assertExists(instruments.cacheHitCounter);
      assertExists(instruments.cacheMissCounter);
      assertExists(instruments.cacheSetCounter);
      assertExists(instruments.cacheInvalidateCounter);
      assertExists(instruments.cacheSizeGauge);
    });

    it("should return all required cache instrument properties", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "veryfront" };
      const runtimeState = { cacheSize: 100, activeRequests: 0 };

      const instruments = createCacheInstruments(meter, config, runtimeState);

      assertEquals(typeof instruments, "object");
      assertEquals("cacheGetCounter" in instruments, true);
      assertEquals("cacheHitCounter" in instruments, true);
      assertEquals("cacheMissCounter" in instruments, true);
      assertEquals("cacheSetCounter" in instruments, true);
      assertEquals("cacheInvalidateCounter" in instruments, true);
      assertEquals("cacheSizeGauge" in instruments, true);
    });

    it("should use runtime state for observable gauge", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 42, activeRequests: 0 };

      const instruments = createCacheInstruments(meter, config, runtimeState);

      assertExists(instruments.cacheSizeGauge);
    });

    it("should handle zero cache size", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 0, activeRequests: 0 };

      const instruments = createCacheInstruments(meter, config, runtimeState);

      assertExists(instruments.cacheSizeGauge);
    });

    it("should handle large cache size", () => {
      const meter = metrics.getMeter("test-meter");
      const config = { enabled: true, exporter: "console" as const, prefix: "test" };
      const runtimeState = { cacheSize: 1000000, activeRequests: 0 };

      const instruments = createCacheInstruments(meter, config, runtimeState);

      assertExists(instruments.cacheSizeGauge);
    });
  });
});
