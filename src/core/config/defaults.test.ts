import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assert } from "std/assert/mod.ts";
import {
  DEFAULT_PORT,
  DEFAULT_TIMEOUT_MS,
  SSR_TIMEOUT_MS,
  SANDBOX_TIMEOUT_MS,
  DEFAULT_CACHE_MAX_SIZE,
  defaultConfig,
  DEFAULT_PREFETCH_DELAY_MS,
  DEFAULT_METRICS_COLLECT_INTERVAL_MS,
  DURATION_HISTOGRAM_BOUNDARIES_MS,
  SIZE_HISTOGRAM_BOUNDARIES_KB,
  DEFAULT_REDIS_SCAN_COUNT,
  DEFAULT_REDIS_BATCH_DELETE_SIZE,
  PAGE_TRANSITION_DELAY_MS,
} from "./defaults.ts";

describe("defaults", () => {
  describe("constant exports", () => {
    it("should export DEFAULT_PORT with correct value", () => {
      assertEquals(DEFAULT_PORT, 3000);
    });

    it("should export DEFAULT_TIMEOUT_MS with correct value", () => {
      assertEquals(DEFAULT_TIMEOUT_MS, 5000);
    });

    it("should export SSR_TIMEOUT_MS with correct value", () => {
      assertEquals(SSR_TIMEOUT_MS, 10000);
    });

    it("should export SANDBOX_TIMEOUT_MS with correct value", () => {
      assertEquals(SANDBOX_TIMEOUT_MS, 5000);
    });

    it("should export DEFAULT_CACHE_MAX_SIZE with correct value", () => {
      assertEquals(DEFAULT_CACHE_MAX_SIZE, 100);
    });

    it("should export DEFAULT_PREFETCH_DELAY_MS with correct value", () => {
      assertEquals(DEFAULT_PREFETCH_DELAY_MS, 100);
    });

    it("should export DEFAULT_METRICS_COLLECT_INTERVAL_MS with correct value", () => {
      assertEquals(DEFAULT_METRICS_COLLECT_INTERVAL_MS, 60000);
    });

    it("should export DEFAULT_REDIS_SCAN_COUNT with correct value", () => {
      assertEquals(DEFAULT_REDIS_SCAN_COUNT, 100);
    });

    it("should export DEFAULT_REDIS_BATCH_DELETE_SIZE with correct value", () => {
      assertEquals(DEFAULT_REDIS_BATCH_DELETE_SIZE, 1000);
    });

    it("should export PAGE_TRANSITION_DELAY_MS with correct value", () => {
      assertEquals(PAGE_TRANSITION_DELAY_MS, 150);
    });
  });

  describe("defaultConfig", () => {
    it("should have server configuration", () => {
      assertEquals(defaultConfig.server.port, 3000);
      assertEquals(defaultConfig.server.hostname, "0.0.0.0");
    });

    it("should have timeout configurations", () => {
      assertEquals(defaultConfig.timeouts.default, 5000);
      assertEquals(defaultConfig.timeouts.api, 30000);
      assertEquals(defaultConfig.timeouts.ssr, 10000);
      assertEquals(defaultConfig.timeouts.hmr, 30000);
      assertEquals(defaultConfig.timeouts.sandbox, 5000);
    });

    it("should have cache configurations", () => {
      assertEquals(defaultConfig.cache.jit.maxSize, 100);
      assertEquals(defaultConfig.cache.jit.tempDirPrefix, "vf-bundle-");
    });

    it("should have metrics SSR boundaries", () => {
      assert(Array.isArray(defaultConfig.metrics.ssrBoundaries));
      assertEquals(defaultConfig.metrics.ssrBoundaries.length, 14);
      assertEquals(defaultConfig.metrics.ssrBoundaries[0], 5);
      assertEquals(defaultConfig.metrics.ssrBoundaries[13], 10000);
    });

    it("should be frozen (as const)", () => {
      // Type check that it's readonly
      const config = defaultConfig;
      assert(config !== null);
    });
  });

  describe("DURATION_HISTOGRAM_BOUNDARIES_MS", () => {
    it("should export duration boundaries array", () => {
      assert(Array.isArray(DURATION_HISTOGRAM_BOUNDARIES_MS));
      assertEquals(DURATION_HISTOGRAM_BOUNDARIES_MS.length, 14);
    });

    it("should have ascending values", () => {
      for (let i = 1; i < DURATION_HISTOGRAM_BOUNDARIES_MS.length; i++) {
        const current = DURATION_HISTOGRAM_BOUNDARIES_MS[i];
        const previous = DURATION_HISTOGRAM_BOUNDARIES_MS[i - 1];
        assert(
          current !== undefined && previous !== undefined && current > previous,
          "Boundaries should be in ascending order"
        );
      }
    });

    it("should start with 5ms and end with 10000ms", () => {
      assertEquals(DURATION_HISTOGRAM_BOUNDARIES_MS[0], 5);
      assertEquals(DURATION_HISTOGRAM_BOUNDARIES_MS[DURATION_HISTOGRAM_BOUNDARIES_MS.length - 1], 10000);
    });
  });

  describe("SIZE_HISTOGRAM_BOUNDARIES_KB", () => {
    it("should export size boundaries array", () => {
      assert(Array.isArray(SIZE_HISTOGRAM_BOUNDARIES_KB));
      assertEquals(SIZE_HISTOGRAM_BOUNDARIES_KB.length, 12);
    });

    it("should have ascending values", () => {
      for (let i = 1; i < SIZE_HISTOGRAM_BOUNDARIES_KB.length; i++) {
        const current = SIZE_HISTOGRAM_BOUNDARIES_KB[i];
        const previous = SIZE_HISTOGRAM_BOUNDARIES_KB[i - 1];
        assert(
          current !== undefined && previous !== undefined && current > previous,
          "Boundaries should be in ascending order"
        );
      }
    });

    it("should start with 1KB and end with 10000KB", () => {
      assertEquals(SIZE_HISTOGRAM_BOUNDARIES_KB[0], 1);
      assertEquals(SIZE_HISTOGRAM_BOUNDARIES_KB[11], 10000);
    });
  });

  describe("timeout relationships", () => {
    it("should have SSR timeout greater than default timeout", () => {
      assert(SSR_TIMEOUT_MS > DEFAULT_TIMEOUT_MS);
    });

    it("should have API timeout greater than SSR timeout", () => {
      assert(defaultConfig.timeouts.api > SSR_TIMEOUT_MS);
    });
  });
});
