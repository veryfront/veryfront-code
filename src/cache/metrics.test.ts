import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  type CacheDomain,
  cacheMetrics,
  exportPrometheusMetrics,
  instrumentCache,
} from "./metrics.ts";

describe("cache/metrics", () => {
  afterEach(() => {
    cacheMetrics.reset();
  });

  describe("CacheMetricsCollector", () => {
    it("records hits correctly", () => {
      cacheMetrics.recordHit("transform", "key1", 5);
      cacheMetrics.recordHit("transform", "key2", 10);

      const stats = cacheMetrics.getDomainStats("transform");
      assertExists(stats);
      assertEquals(stats.gets, 2);
      assertEquals(stats.hits, 2);
      assertEquals(stats.misses, 0);
      assertEquals(stats.hitRate, 1.0);
    });

    it("records misses correctly", () => {
      cacheMetrics.recordMiss("http-module", "missing-key", 2);

      const stats = cacheMetrics.getDomainStats("http-module");
      assertExists(stats);
      assertEquals(stats.gets, 1);
      assertEquals(stats.hits, 0);
      assertEquals(stats.misses, 1);
      assertEquals(stats.hitRate, 0);
    });

    it("calculates hit rate correctly", () => {
      cacheMetrics.recordHit("file", "hit1");
      cacheMetrics.recordHit("file", "hit2");
      cacheMetrics.recordHit("file", "hit3");
      cacheMetrics.recordMiss("file", "miss1");

      const stats = cacheMetrics.getDomainStats("file");
      assertExists(stats);
      assertEquals(stats.hitRate, 0.75); // 3/4
    });

    it("tracks sets correctly", () => {
      cacheMetrics.recordSet("css", "style1", 1);
      cacheMetrics.recordSet("css", "style2", 2);

      const stats = cacheMetrics.getDomainStats("css");
      assertExists(stats);
      assertEquals(stats.sets, 2);
    });

    it("tracks evictions correctly", () => {
      cacheMetrics.recordEviction("render", "lru", "evicted-key");
      cacheMetrics.recordEviction("render", "ttl");

      const stats = cacheMetrics.getDomainStats("render");
      assertExists(stats);
      assertEquals(stats.evictions, 2);
    });

    it("tracks errors correctly", () => {
      cacheMetrics.recordError("data", "get", new Error("test error"));

      const stats = cacheMetrics.getDomainStats("data");
      assertExists(stats);
      assertEquals(stats.errors, 1);
    });

    it("returns null for unknown domain", () => {
      const stats = cacheMetrics.getDomainStats("transform");
      assertEquals(stats, null);
    });

    it("resets domain metrics", () => {
      cacheMetrics.recordHit("mdx", "key1");
      cacheMetrics.resetDomain("mdx");

      const stats = cacheMetrics.getDomainStats("mdx");
      assertEquals(stats, null);
    });

    it("resets all metrics", () => {
      cacheMetrics.recordHit("transform", "key1");
      cacheMetrics.recordHit("file", "key2");
      cacheMetrics.reset();

      assertEquals(cacheMetrics.getDomainStats("transform"), null);
      assertEquals(cacheMetrics.getDomainStats("file"), null);
    });
  });

  describe("getAggregateStats", () => {
    it("aggregates across all domains", () => {
      cacheMetrics.recordHit("transform", "t1");
      cacheMetrics.recordMiss("transform", "t2");
      cacheMetrics.recordHit("file", "f1");
      cacheMetrics.recordSet("http-module", "h1");
      cacheMetrics.recordEviction("render", "lru");

      const aggregate = cacheMetrics.getAggregateStats();

      assertEquals(aggregate.totalGets, 3); // 2 transform + 1 file
      assertEquals(aggregate.totalHits, 2); // 1 transform + 1 file
      assertEquals(aggregate.totalMisses, 1); // 1 transform
      assertEquals(aggregate.totalSets, 1);
      assertEquals(aggregate.totalEvictions, 1);
      assertEquals(aggregate.domainStats.size, 4);
    });

    it("calculates overall hit rate", () => {
      cacheMetrics.recordHit("transform", "t1");
      cacheMetrics.recordMiss("file", "f1");

      const aggregate = cacheMetrics.getAggregateStats();
      assertEquals(aggregate.overallHitRate, 0.5);
    });
  });

  describe("listeners", () => {
    it("notifies listeners on operations", () => {
      const events: Array<{ domain: CacheDomain; op: string; key: string }> = [];
      const listener = (domain: CacheDomain, op: string, key: string) => {
        events.push({ domain, op, key });
      };

      cacheMetrics.addListener(listener);
      cacheMetrics.recordHit("transform", "key1");
      cacheMetrics.recordSet("file", "key2");

      assertEquals(events.length, 2);
      assertEquals(events[0]?.domain, "transform");
      assertEquals(events[0]?.op, "get");
      assertEquals(events[1]?.domain, "file");
      assertEquals(events[1]?.op, "set");

      cacheMetrics.removeListener(listener);
      cacheMetrics.recordHit("transform", "key3");
      assertEquals(events.length, 2); // No new events
    });
  });

  describe("instrumentCache", () => {
    it("wraps cache and records metrics", async () => {
      const store = new Map<string, string>();
      const baseCache = {
        get: async (key: string) => store.get(key) ?? null,
        set: async (key: string, value: string) => {
          store.set(key, value);
        },
        delete: async (key: string) => {
          store.delete(key);
        },
      };

      const instrumented = instrumentCache("config", baseCache);

      await instrumented.set("k1", "v1");
      await instrumented.get("k1"); // hit
      await instrumented.get("k2"); // miss

      const stats = cacheMetrics.getDomainStats("config");
      assertExists(stats);
      assertEquals(stats.sets, 1);
      assertEquals(stats.hits, 1);
      assertEquals(stats.misses, 1);
    });

    it("records errors from underlying cache", async () => {
      const failingCache = {
        get: async (_key: string): Promise<string | null> => {
          throw new Error("Cache failure");
        },
        set: async () => {},
      };

      const instrumented = instrumentCache("module-resolve", failingCache);

      let caught = false;
      try {
        await instrumented.get("key");
      } catch {
        caught = true;
      }

      assertEquals(caught, true);
      const stats = cacheMetrics.getDomainStats("module-resolve");
      assertExists(stats);
      assertEquals(stats.errors, 1);
    });
  });

  describe("exportPrometheusMetrics", () => {
    it("exports metrics in Prometheus format", () => {
      cacheMetrics.recordHit("transform", "key1");
      cacheMetrics.recordMiss("transform", "key2");
      cacheMetrics.recordSet("file", "key3");

      const output = exportPrometheusMetrics();

      // Check for metric definitions
      assertEquals(output.includes("# HELP veryfront_cache_gets_total"), true);
      assertEquals(output.includes("# TYPE veryfront_cache_gets_total counter"), true);

      // Check for actual values
      assertEquals(output.includes('veryfront_cache_gets_total{domain="transform"} 2'), true);
      assertEquals(output.includes('veryfront_cache_hits_total{domain="transform"} 1'), true);
      assertEquals(output.includes('veryfront_cache_misses_total{domain="transform"} 1'), true);
      assertEquals(output.includes('veryfront_cache_sets_total{domain="file"} 1'), true);
    });
  });
});
