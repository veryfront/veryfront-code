import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  checkMemoryPressure,
  clearAllCaches,
  forceGC,
  getCacheStats,
  getHeapStats,
  getMemorySnapshot,
  registerCache,
  setHeapWarningThreshold,
  startMemoryMonitoring,
  stopMemoryMonitoring,
  unregisterCache,
} from "./profiler.ts";

describe("memory/profiler", () => {
  afterEach(() => {
    // Clean up any registered caches
    unregisterCache("test-cache");
    unregisterCache("test-cache-1");
    unregisterCache("test-cache-2");
    unregisterCache("error-cache");
    stopMemoryMonitoring();
  });

  describe("registerCache / unregisterCache", () => {
    it("should register a cache that appears in getCacheStats", () => {
      registerCache("test-cache", () => ({
        name: "test-cache",
        entries: 42,
      }));

      const stats = getCacheStats();
      const testStat = stats.find((s) => s.name === "test-cache");
      assertEquals(testStat?.entries, 42);
    });

    it("should unregister a cache so it no longer appears", () => {
      registerCache("test-cache", () => ({
        name: "test-cache",
        entries: 10,
      }));
      unregisterCache("test-cache");

      const stats = getCacheStats();
      const testStat = stats.find((s) => s.name === "test-cache");
      assertEquals(testStat, undefined);
    });

    it("should handle unregistering a cache that does not exist", () => {
      unregisterCache("nonexistent");
      // Should not throw
    });
  });

  describe("getCacheStats", () => {
    it("should return an array", () => {
      const stats = getCacheStats();
      assert(Array.isArray(stats));
    });

    it("should handle cache stats functions that throw", () => {
      registerCache("error-cache", () => {
        throw new Error("stats error");
      });

      const stats = getCacheStats();
      const errStat = stats.find((s) => s.name === "error-cache");
      assertEquals(errStat?.entries, -1);
    });

    it("should return stats from multiple registered caches", () => {
      registerCache("test-cache-1", () => ({
        name: "test-cache-1",
        entries: 5,
      }));
      registerCache("test-cache-2", () => ({
        name: "test-cache-2",
        entries: 10,
      }));

      const stats = getCacheStats();
      const names = stats.map((s) => s.name);
      assert(names.includes("test-cache-1"));
      assert(names.includes("test-cache-2"));
    });
  });

  describe("getHeapStats", () => {
    it("should return heap statistics with expected properties", () => {
      const stats = getHeapStats();
      assertEquals(typeof stats.usedHeapSizeMB, "number");
      assertEquals(typeof stats.totalHeapSizeMB, "number");
      assertEquals(typeof stats.heapSizeLimitMB, "number");
      assertEquals(typeof stats.externalMemoryMB, "number");
      assertEquals(typeof stats.heapUsedPercent, "number");
    });

    it("should return positive heap sizes", () => {
      const stats = getHeapStats();
      assert(stats.usedHeapSizeMB > 0);
      assert(stats.totalHeapSizeMB > 0);
      assert(stats.heapSizeLimitMB > 0);
    });

    it("should have heapUsedPercent between 0 and 100", () => {
      const stats = getHeapStats();
      assert(stats.heapUsedPercent >= 0);
      assert(stats.heapUsedPercent <= 100);
    });
  });

  describe("getMemorySnapshot", () => {
    it("should return a snapshot with expected properties", () => {
      const snapshot = getMemorySnapshot();
      assertEquals(typeof snapshot.timestamp, "string");
      assert(Array.isArray(snapshot.caches));
      assertEquals(typeof snapshot.totalCacheEntries, "number");
      assertEquals(typeof snapshot.heap.usedHeapSizeMB, "number");
    });

    it("should have a valid ISO timestamp", () => {
      const snapshot = getMemorySnapshot();
      const date = new Date(snapshot.timestamp);
      assert(!isNaN(date.getTime()));
    });

    it("should include registered cache entries in totalCacheEntries", () => {
      registerCache("test-cache", () => ({
        name: "test-cache",
        entries: 25,
      }));

      const snapshot = getMemorySnapshot();
      assert(snapshot.totalCacheEntries >= 25);
    });
  });

  describe("forceGC", () => {
    it("should return a boolean", async () => {
      const result = await forceGC();
      assertEquals(typeof result, "boolean");
    });
  });

  describe("checkMemoryPressure", () => {
    it("should return an object with critical, warning, and heapUsedPercent", () => {
      const result = checkMemoryPressure();
      assertEquals(typeof result.critical, "boolean");
      assertEquals(typeof result.warning, "boolean");
      assertEquals(typeof result.heapUsedPercent, "number");
    });

    it("should have heapUsedPercent matching getHeapStats", () => {
      const pressure = checkMemoryPressure();
      const heap = getHeapStats();
      // Values may differ slightly due to allocation between calls
      assert(Math.abs(pressure.heapUsedPercent - heap.heapUsedPercent) < 5);
    });
  });

  describe("setHeapWarningThreshold", () => {
    it("should not throw when setting valid thresholds", () => {
      setHeapWarningThreshold(0.5);
      setHeapWarningThreshold(0.9);
      setHeapWarningThreshold(0.1);
    });

    it("should clamp threshold to minimum 0.1", () => {
      setHeapWarningThreshold(0.01);
      // We can't directly read it, but it should not throw
    });

    it("should clamp threshold to maximum 0.99", () => {
      setHeapWarningThreshold(1.5);
      // We can't directly read it, but it should not throw
    });
  });

  describe("startMemoryMonitoring / stopMemoryMonitoring", () => {
    it("should start and stop without errors", () => {
      startMemoryMonitoring(60000);
      stopMemoryMonitoring();
    });

    it("should handle multiple starts (replaces interval)", () => {
      startMemoryMonitoring(60000);
      startMemoryMonitoring(60000);
      stopMemoryMonitoring();
    });

    it("should handle stop when not started", () => {
      stopMemoryMonitoring();
    });
  });

  describe("clearAllCaches", () => {
    it("should not throw when no caches are registered", () => {
      clearAllCaches();
    });

    it("should not throw when caches are registered", () => {
      registerCache("test-cache", () => ({
        name: "test-cache",
        entries: 5,
      }));
      clearAllCaches();
    });
  });
});
