import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DATA_FETCH_TIMEOUT_MS,
  DEFAULT_CACHE_MAX_SIZE,
  DEFAULT_METRICS_COLLECT_INTERVAL_MS,
  DEFAULT_PORT,
  DEFAULT_PREFETCH_DELAY_MS,
  DEFAULT_REDIS_BATCH_DELETE_SIZE,
  DEFAULT_REDIS_SCAN_COUNT,
  DEFAULT_TIMEOUT_MS,
  defaultConfig,
  DURATION_HISTOGRAM_BOUNDARIES_MS,
  PAGE_TRANSITION_DELAY_MS,
  SANDBOX_TIMEOUT_MS,
  SIZE_HISTOGRAM_BOUNDARIES_KB,
  SSR_TIMEOUT_MS,
} from "./defaults.ts";

function assertSortedAscending(values: readonly number[]): void {
  for (let i = 1; i < values.length; i++) {
    const current = values[i];
    const previous = values[i - 1];
    assertExists(current);
    assertExists(previous);
    assertEquals(current > previous, true);
  }
}

describe("config/defaults", () => {
  describe("exported constants", () => {
    it("should have correct DEFAULT_PORT", () => {
      assertEquals(DEFAULT_PORT, 3000);
    });

    it("should have correct DEFAULT_TIMEOUT_MS", () => {
      assertEquals(DEFAULT_TIMEOUT_MS, 5000);
    });

    it("should have correct SSR_TIMEOUT_MS", () => {
      assertEquals(SSR_TIMEOUT_MS, 10000);
    });

    it("should have correct SANDBOX_TIMEOUT_MS", () => {
      assertEquals(SANDBOX_TIMEOUT_MS, 5000);
    });

    it("should have correct DATA_FETCH_TIMEOUT_MS", () => {
      assertEquals(DATA_FETCH_TIMEOUT_MS, 10000);
    });

    it("should have correct DEFAULT_CACHE_MAX_SIZE", () => {
      assertEquals(DEFAULT_CACHE_MAX_SIZE, 100);
    });

    it("should have correct DEFAULT_PREFETCH_DELAY_MS", () => {
      assertEquals(DEFAULT_PREFETCH_DELAY_MS, 100);
    });

    it("should have correct DEFAULT_METRICS_COLLECT_INTERVAL_MS", () => {
      assertEquals(DEFAULT_METRICS_COLLECT_INTERVAL_MS, 60000);
    });

    it("should have correct DEFAULT_REDIS_SCAN_COUNT", () => {
      assertEquals(DEFAULT_REDIS_SCAN_COUNT, 100);
    });

    it("should have correct DEFAULT_REDIS_BATCH_DELETE_SIZE", () => {
      assertEquals(DEFAULT_REDIS_BATCH_DELETE_SIZE, 1000);
    });

    it("should have correct PAGE_TRANSITION_DELAY_MS", () => {
      assertEquals(PAGE_TRANSITION_DELAY_MS, 150);
    });
  });

  describe("DURATION_HISTOGRAM_BOUNDARIES_MS", () => {
    it("should be sorted in ascending order", () => {
      assertSortedAscending(DURATION_HISTOGRAM_BOUNDARIES_MS);
    });

    it("should start at 5ms and end at 10000ms", () => {
      const first = DURATION_HISTOGRAM_BOUNDARIES_MS[0];
      const last = DURATION_HISTOGRAM_BOUNDARIES_MS.at(-1);
      assertExists(first);
      assertExists(last);
      assertEquals(first, 5);
      assertEquals(last, 10000);
    });

    it("should have 14 entries", () => {
      assertEquals(DURATION_HISTOGRAM_BOUNDARIES_MS.length, 14);
    });
  });

  describe("SIZE_HISTOGRAM_BOUNDARIES_KB", () => {
    it("should be sorted in ascending order", () => {
      assertSortedAscending(SIZE_HISTOGRAM_BOUNDARIES_KB);
    });

    it("should start at 1KB and end at 10000KB", () => {
      const first = SIZE_HISTOGRAM_BOUNDARIES_KB[0];
      const last = SIZE_HISTOGRAM_BOUNDARIES_KB.at(-1);
      assertExists(first);
      assertExists(last);
      assertEquals(first, 1);
      assertEquals(last, 10000);
    });

    it("should have 12 entries", () => {
      assertEquals(SIZE_HISTOGRAM_BOUNDARIES_KB.length, 12);
    });
  });

  describe("defaultConfig", () => {
    it("should have server config with correct port and hostname", () => {
      assertEquals(defaultConfig.server.port, DEFAULT_PORT);
      assertEquals(defaultConfig.server.hostname, "0.0.0.0");
    });

    it("should have timeout config with correct values", () => {
      assertEquals(defaultConfig.timeouts.default, DEFAULT_TIMEOUT_MS);
      assertEquals(defaultConfig.timeouts.api, 30000);
      assertEquals(defaultConfig.timeouts.ssr, SSR_TIMEOUT_MS);
      assertEquals(defaultConfig.timeouts.hmr, 30000);
      assertEquals(defaultConfig.timeouts.sandbox, SANDBOX_TIMEOUT_MS);
    });

    it("should have cache config with correct values", () => {
      assertEquals(defaultConfig.cache.jit.maxSize, DEFAULT_CACHE_MAX_SIZE);
      assertEquals(defaultConfig.cache.jit.tempDirPrefix, "vf-bundle-");
    });

    it("should have metrics config referencing duration boundaries", () => {
      assertEquals(defaultConfig.metrics.ssrBoundaries, DURATION_HISTOGRAM_BOUNDARIES_MS);
    });
  });
});
