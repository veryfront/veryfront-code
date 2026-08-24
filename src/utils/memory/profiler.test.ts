import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isBun } from "#veryfront/platform/compat/runtime.ts";
import { withEnv } from "#veryfront/testing";
import {
  checkMemoryPressure,
  DEFAULT_MEMORY_MONITORING_INTERVAL_MS,
  DEFAULT_PROFILER_CRITICAL_THRESHOLD,
  DEFAULT_PROFILER_WARNING_THRESHOLD,
  evaluateMemoryPressure,
  forceGC,
  getCacheStats,
  getHeapStats,
  getInitialRapidHeapGrowthState,
  getMemoryMonitoringConfig,
  getMemoryMonitoringLogContext,
  getMemoryMonitoringState,
  getMemorySnapshot,
  getRapidHeapGrowthEvaluation,
  type MemoryMonitoringEnv,
  registerCache,
  resolveEffectiveHeapLimitMB,
  setHeapWarningThreshold,
  startConfiguredMemoryMonitoring,
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

  describe("heap limit honesty", () => {
    it("reports the runtime heap limit, not the DENO_V8_FLAGS env string", async () => {
      if (isBun) return;
      const { getHeapStatistics } = await import("node:v8");
      const runtimeLimitMB = getHeapStatistics().heap_size_limit / (1024 * 1024);

      await withEnv({ DENO_V8_FLAGS: "--max-old-space-size=999999" }, async () => {
        const stats = getHeapStats();
        assert(
          Math.abs(stats.heapSizeLimitMB - runtimeLimitMB) < 1,
          `heapSizeLimitMB (${stats.heapSizeLimitMB}) must reflect the real V8 heap_size_limit ` +
            `(${runtimeLimitMB.toFixed(2)}MB), not the unverified env string`,
        );
      });
    });

    it("clamps an unverified DENO_V8_FLAGS limit to the V8 default ceiling", () => {
      const effective = resolveEffectiveHeapLimitMB({
        runtimeHeapLimitMB: undefined,
        configuredHeapLimitMB: 4096,
      });

      assertEquals(
        effective,
        2048,
        "an unverified 4096MB env limit must resolve to the 2048MB V8 default",
      );
    });

    it("uses the conservative fallback instead of Bun's moving node:v8 shim value", async () => {
      if (!isBun) return;

      await withEnv({ DENO_V8_FLAGS: "--max-old-space-size=999999" }, async () => {
        assertEquals(
          getHeapStats().heapSizeLimitMB,
          2048,
          "Bun must not use its process-derived node:v8 compatibility value as a heap ceiling",
        );
      });
    });

    it("reports over-threshold pressure at ~1.6GB used when a 4096MB flag is unverified", () => {
      const effective = resolveEffectiveHeapLimitMB({
        runtimeHeapLimitMB: undefined,
        configuredHeapLimitMB: 4096,
      });
      const heapUsedPercent = (1638.4 / effective) * 100;

      assertEquals(
        evaluateMemoryPressure(heapUsedPercent, { warning: 65, critical: 75 }),
        { critical: true, warning: true },
        "1638.4MB used against the effective limit must exceed a 75% eviction threshold",
      );
    });

    it("uses the runtime-verified limit as-is when heap statistics expose it", () => {
      assertEquals(
        resolveEffectiveHeapLimitMB({
          runtimeHeapLimitMB: 4096,
          configuredHeapLimitMB: 4096,
        }),
        4096,
        "a limit confirmed by runtime heap statistics is trusted as-is",
      );
    });

    it("falls back to the V8 default when nothing is configured or verifiable", () => {
      assertEquals(
        resolveEffectiveHeapLimitMB({
          runtimeHeapLimitMB: undefined,
          configuredHeapLimitMB: undefined,
        }),
        2048,
        "with no runtime or configured limit the V8 default old-space ceiling applies",
      );
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

    it("uses the default 65 percent warning threshold inclusively", () => {
      assertEquals(DEFAULT_PROFILER_WARNING_THRESHOLD, 65);
      assertEquals(evaluateMemoryPressure(64.99), {
        critical: false,
        warning: false,
      });
      assertEquals(evaluateMemoryPressure(65), {
        critical: false,
        warning: true,
      });
    });

    it("uses the critical threshold inclusively and reports a warning", () => {
      assertEquals(DEFAULT_PROFILER_CRITICAL_THRESHOLD, 80);
      assertEquals(evaluateMemoryPressure(80), {
        critical: true,
        warning: true,
      });
    });

    it("reports a warning for critical pressure when warning is configured higher", () => {
      assertEquals(
        evaluateMemoryPressure(80, { warning: 90, critical: 80 }),
        {
          critical: true,
          warning: true,
        },
      );
    });
  });

  describe("setHeapWarningThreshold", () => {
    it("should not throw when setting valid thresholds", () => {
      setHeapWarningThreshold(0.5);
      setHeapWarningThreshold(0.9);
      setHeapWarningThreshold(0.1);
    });
  });

  describe("startMemoryMonitoring / stopMemoryMonitoring", () => {
    it("should start and stop without errors", () => {
      assertEquals(
        getMemoryMonitoringState(),
        { active: false, intervalMs: undefined },
        "monitoring starts inactive",
      );

      startMemoryMonitoring(60000);
      assertEquals(
        getMemoryMonitoringState(),
        { active: true, intervalMs: 60000 },
        "start records the active interval",
      );

      stopMemoryMonitoring();
      assertEquals(
        getMemoryMonitoringState(),
        { active: false, intervalMs: undefined },
        "stop clears the recorded interval",
      );
    });

    it("should handle multiple starts (replaces interval)", () => {
      startMemoryMonitoring(60000);
      startMemoryMonitoring(30000);
      assertEquals(
        getMemoryMonitoringState(),
        { active: true, intervalMs: 30000 },
        "restarting replaces the recorded interval",
      );

      stopMemoryMonitoring();
      assertEquals(
        getMemoryMonitoringState(),
        { active: false, intervalMs: undefined },
        "stop clears the recorded interval",
      );
    });

    it("should handle stop when not started", () => {
      stopMemoryMonitoring();
      assertEquals(
        getMemoryMonitoringState(),
        { active: false, intervalMs: undefined },
        "stopping an unstarted monitor leaves it inactive",
      );
    });
  });

  describe("getMemoryMonitoringConfig", () => {
    const envOf = (values: Record<string, string>): MemoryMonitoringEnv => ({
      get: (key: string) => values[key],
    });

    it('enables monitoring only for the exact string "true"', () => {
      assertEquals(
        getMemoryMonitoringConfig(envOf({})).enabled,
        false,
        "monitoring stays off when ENABLE_MEMORY_MONITORING is unset",
      );
      assertEquals(
        getMemoryMonitoringConfig(envOf({ ENABLE_MEMORY_MONITORING: "true" })).enabled,
        true,
        "ENABLE_MEMORY_MONITORING=true enables monitoring",
      );

      for (const value of ["TRUE", "1", "yes", "false", ""]) {
        assertEquals(
          getMemoryMonitoringConfig(envOf({ ENABLE_MEMORY_MONITORING: value })).enabled,
          false,
          `only the exact string "true" may enable monitoring (got "${value}")`,
        );
      }
    });

    it("falls back to the default interval for unusable values", () => {
      assertEquals(
        getMemoryMonitoringConfig(envOf({})).intervalMs,
        DEFAULT_MEMORY_MONITORING_INTERVAL_MS,
        "an unset interval uses the default",
      );

      for (const raw of ["abc", "0", "-5"]) {
        assertEquals(
          getMemoryMonitoringConfig(
            envOf({ ENABLE_MEMORY_MONITORING: "true", MEMORY_MONITORING_INTERVAL_MS: raw }),
          ).intervalMs,
          DEFAULT_MEMORY_MONITORING_INTERVAL_MS,
          `a non-positive or unparseable interval must not become a spinning timer (got "${raw}")`,
        );
      }

      assertEquals(
        getMemoryMonitoringConfig(
          envOf({ ENABLE_MEMORY_MONITORING: "true", MEMORY_MONITORING_INTERVAL_MS: "5000" }),
        ).intervalMs,
        5000,
        "a positive interval is used as configured",
      );
    });

    it("starts no interval when the env does not enable monitoring", () => {
      const config = startConfiguredMemoryMonitoring(envOf({}));

      assertEquals(config.enabled, false, "an unset env must not enable monitoring");
      assertEquals(
        getMemoryMonitoringState(),
        { active: false, intervalMs: undefined },
        "the disabled path must not install a monitoring interval",
      );
    });
  });
});
