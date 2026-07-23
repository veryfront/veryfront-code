import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  acquireConfiguredMemoryMonitoring,
  checkMemoryPressure,
  forceGC,
  getCacheStats,
  getHeapStats,
  getInitialRapidHeapGrowthState,
  getMemoryMonitoringConfig,
  getMemoryMonitoringLogContext,
  getMemoryMonitoringState,
  getMemorySnapshot,
  getRapidHeapGrowthEvaluation,
  registerCache,
  setHeapWarningThreshold,
  startMemoryMonitoring,
  stopMemoryMonitoring,
  unregisterCache,
} from "./profiler.ts";

describe("memory/profiler", () => {
  afterEach(() => {
    unregisterCache("test-cache");
    unregisterCache("test-cache-1");
    unregisterCache("test-cache-2");
    unregisterCache("error-cache");
    stopMemoryMonitoring();
  });

  describe("registerCache / unregisterCache", () => {
    it("should register a cache that appears in getCacheStats", () => {
      registerCache("test-cache", () => ({ name: "test-cache", entries: 42 }));

      const testStat = getCacheStats().find((s) => s.name === "test-cache");
      assertEquals(testStat?.entries, 42);
    });

    it("should unregister a cache so it no longer appears", () => {
      registerCache("test-cache", () => ({ name: "test-cache", entries: 10 }));
      unregisterCache("test-cache");

      const testStat = getCacheStats().find((s) => s.name === "test-cache");
      assertEquals(testStat, undefined);
    });

    it("should handle unregistering a cache that does not exist", () => {
      unregisterCache("nonexistent");
    });

    it("rejects unsafe cache registrations", () => {
      const stats = () => ({ name: "cache", entries: 1 });

      assertThrows(() => registerCache("", stats), Error, "cache name");
      assertThrows(() => registerCache("cache\nsecret", stats), Error, "cache name");
      assertThrows(
        () => registerCache("cache", null as unknown as () => never),
        Error,
        "stats callback",
      );
    });

    it("bounds distinct cache registrations", async () => {
      const isolated = await import("./profiler.ts?cache-registry-cap-test");
      const stats = (name: string) => () => ({ name, entries: 1 });
      let capacityError: unknown;

      for (let index = 0; index < 1_100; index++) {
        const name = `bounded-cache-${index}`;
        try {
          isolated.registerCache(name, stats(name));
        } catch (error) {
          capacityError = error;
          break;
        }
      }

      assert(capacityError instanceof Error);
      assert(capacityError.message.includes("registry capacity"));
    });
  });

  describe("getCacheStats", () => {
    it("should return an array", () => {
      assert(Array.isArray(getCacheStats()));
    });

    it("should handle cache stats functions that throw", () => {
      registerCache("error-cache", () => {
        throw new Error("stats error");
      });

      const errStat = getCacheStats().find((s) => s.name === "error-cache");
      assertEquals(errStat?.entries, -1);
    });

    it("should return stats from multiple registered caches", () => {
      registerCache("test-cache-1", () => ({ name: "test-cache-1", entries: 5 }));
      registerCache("test-cache-2", () => ({ name: "test-cache-2", entries: 10 }));

      const names = getCacheStats().map((s) => s.name);
      assert(names.includes("test-cache-1"));
      assert(names.includes("test-cache-2"));
    });

    it("fails closed for malformed or identity-changing cache stats", () => {
      registerCache("test-cache", () => ({
        name: "different-cache",
        entries: Number.NaN,
      }));

      assertEquals(
        getCacheStats().find((stats) => stats.name === "test-cache"),
        { name: "test-cache", entries: -1 },
      );
    });

    it("preserves bounded cache-specific diagnostic fields", () => {
      registerCache("test-cache", () => ({
        name: "test-cache",
        entries: 2,
        cacheDirs: 2,
        mode: "memory",
      }));

      assertEquals(
        getCacheStats().find((stats) => stats.name === "test-cache"),
        { name: "test-cache", entries: 2, cacheDirs: 2, mode: "memory" },
      );
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
      const { heapUsedPercent } = getHeapStats();
      assert(heapUsedPercent >= 0);
      assert(heapUsedPercent <= 100);
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
      const { timestamp } = getMemorySnapshot();
      assert(!isNaN(new Date(timestamp).getTime()));
    });

    it("should include registered cache entries in totalCacheEntries", () => {
      registerCache("test-cache", () => ({ name: "test-cache", entries: 25 }));

      const { totalCacheEntries } = getMemorySnapshot();
      assert(totalCacheEntries >= 25);
    });
  });

  describe("getMemoryMonitoringLogContext", () => {
    it("includes top cache stats in routine memory log context", () => {
      registerCache("test-cache-1", () => ({ name: "test-cache-1", entries: 5 }));
      registerCache("test-cache-2", () => ({ name: "test-cache-2", entries: 25 }));

      const context = getMemoryMonitoringLogContext(getMemorySnapshot(), 1);

      assertEquals(context.totalCacheEntries >= 30, true);
      assertEquals(context.topCaches.length, 1);
      assertEquals(context.topCaches[0]?.name, "test-cache-2");
      assertEquals(context.topCaches[0]?.entries, 25);
    });
  });

  describe("forceGC", () => {
    it("should return a boolean", async () => {
      assertEquals(typeof (await forceGC()), "boolean");
    });
  });

  describe("getRapidHeapGrowthEvaluation", () => {
    it("seeds restart baselines from current heap so stable warm heaps do not warn", () => {
      const initialState = getInitialRapidHeapGrowthState(153.01);

      const flatSample = getRapidHeapGrowthEvaluation({
        previousHeapUsedMB: initialState.lastHeapUsedMB,
        currentHeapUsedMB: 153.01,
        pending: initialState.pending,
        thresholdMB: 100,
      });

      assertEquals(flatSample.shouldWarn, false);
      assertEquals(flatSample.pending, undefined);
    });

    it("does not warn when a one-interval spike is reclaimed on the next sample", () => {
      const first = getRapidHeapGrowthEvaluation({
        previousHeapUsedMB: 99.16,
        currentHeapUsedMB: 212.69,
        pending: undefined,
        thresholdMB: 100,
      });

      assertEquals(first.shouldWarn, false);
      assertEquals(first.pending?.baselineHeapUsedMB, 99.16);

      const settled = getRapidHeapGrowthEvaluation({
        previousHeapUsedMB: 212.69,
        currentHeapUsedMB: 153.01,
        pending: first.pending,
        thresholdMB: 100,
      });

      assertEquals(settled.shouldWarn, false);
      assertEquals(settled.pending, undefined);
    });

    it("warns when rapid heap growth remains sustained after the next sample", () => {
      const first = getRapidHeapGrowthEvaluation({
        previousHeapUsedMB: 100,
        currentHeapUsedMB: 225,
        pending: undefined,
        thresholdMB: 100,
      });
      const sustained = getRapidHeapGrowthEvaluation({
        previousHeapUsedMB: 225,
        currentHeapUsedMB: 235,
        pending: first.pending,
        thresholdMB: 100,
      });

      assertEquals(sustained.shouldWarn, true);
      assertEquals(sustained.growthMB, 135);
      assertEquals(sustained.pending, undefined);
    });

    it("defers sustained rapid heap growth warnings while heap pressure is low", () => {
      const first = getRapidHeapGrowthEvaluation({
        previousHeapUsedMB: 99.16,
        currentHeapUsedMB: 212.69,
        pending: undefined,
        thresholdMB: 100,
        currentHeapUsedPercent: 4.15,
        memoryPressureWarningThresholdPercent: 75,
      });

      const sustainedLowPressure = getRapidHeapGrowthEvaluation({
        previousHeapUsedMB: 212.69,
        currentHeapUsedMB: 235.59,
        pending: first.pending,
        thresholdMB: 100,
        currentHeapUsedPercent: 4.6,
        memoryPressureWarningThresholdPercent: 75,
      });

      assertEquals(sustainedLowPressure.shouldWarn, false);
      assertEquals(sustainedLowPressure.pending?.baselineHeapUsedMB, 99.16);
      assertEquals(sustainedLowPressure.pending?.observedGrowthMB, 113.53);
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
    });

    it("should clamp threshold to maximum 0.99", () => {
      setHeapWarningThreshold(1.5);
    });

    it("rejects non-finite thresholds", () => {
      assertThrows(() => setHeapWarningThreshold(Number.NaN), Error, "finite number");
      assertThrows(() => setHeapWarningThreshold(Number.POSITIVE_INFINITY), Error, "finite number");
    });
  });

  describe("getMemoryMonitoringConfig", () => {
    it("accepts only bounded decimal interval values", () => {
      assertEquals(
        getMemoryMonitoringConfig({
          get: (key) => key === "ENABLE_MEMORY_MONITORING" ? "true" : "1000",
        }),
        { enabled: true, intervalMs: 1000 },
      );

      for (const raw of ["0", "999", "1000ms", "2147483648"]) {
        assertThrows(
          () =>
            getMemoryMonitoringConfig({
              get: (key) => key === "MEMORY_MONITORING_INTERVAL_MS" ? raw : "true",
            }),
          Error,
          "integer between",
        );
      }
    });

    it("sanitizes unreadable environment access", () => {
      const error = assertThrows(
        () =>
          getMemoryMonitoringConfig({
            get() {
              throw new Error("private-memory-env-canary");
            },
          }),
        Error,
      );

      assertEquals((error as Error).message.includes("private-memory-env-canary"), false);
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

    it("rejects intervals that could overflow or spin the timer", () => {
      for (const interval of [0, 999, 1.5, Number.NaN, 2_147_483_648]) {
        assertThrows(() => startMemoryMonitoring(interval), Error, "integer between");
        assertEquals(getMemoryMonitoringState().active, false);
      }
    });

    it("shares configured monitoring until every owning lease is released", () => {
      const env = {
        get: (key: string) => key === "ENABLE_MEMORY_MONITORING" ? "true" : "60000",
      };
      const first = acquireConfiguredMemoryMonitoring(env);
      const second = acquireConfiguredMemoryMonitoring(env);

      first.release();
      first.release();
      assertEquals(getMemoryMonitoringState(), { active: true, intervalMs: 60000 });

      second.release();
      assertEquals(getMemoryMonitoringState(), { active: false, intervalMs: undefined });
    });

    it("does not allow a process monitor to replace an owned lease", () => {
      const lease = acquireConfiguredMemoryMonitoring({
        get: (key: string) => key === "ENABLE_MEMORY_MONITORING" ? "true" : "60000",
      });

      assertThrows(
        () => startMemoryMonitoring(61000),
        Error,
        "cannot be replaced",
      );
      assertThrows(
        () => stopMemoryMonitoring(),
        Error,
        "cannot be stopped",
      );
      lease.release();

      assertEquals(getMemoryMonitoringState(), { active: false, intervalMs: undefined });
    });

    it("rejects conflicting intervals while a server lease is active", () => {
      const lease = acquireConfiguredMemoryMonitoring({
        get: (key: string) => key === "ENABLE_MEMORY_MONITORING" ? "true" : "60000",
      });

      try {
        assertThrows(
          () =>
            acquireConfiguredMemoryMonitoring({
              get: (key: string) => key === "ENABLE_MEMORY_MONITORING" ? "true" : "61000",
            }),
          Error,
          "conflicts",
        );
      } finally {
        lease.release();
      }
    });
  });
});
