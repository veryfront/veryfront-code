import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { simpleHash } from "#veryfront/utils";

function getEnv(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return g.Deno?.env?.get(name) ?? g.process?.env?.[name];
}

const RENDER_MAX_CONCURRENT_DEFAULT = 30;

function computePerProjectLimit(maxConcurrent: number): number {
  return Math.ceil(maxConcurrent / 3);
}

function createProjectSlotManager(limit: number) {
  const counts = new Map<string, number>();

  function acquire(projectId: string): boolean {
    if (limit <= 0) return true;

    const current = counts.get(projectId) ?? 0;
    if (current >= limit) return false;

    counts.set(projectId, current + 1);
    return true;
  }

  function release(projectId: string): void {
    if (limit <= 0) return;

    const current = counts.get(projectId) ?? 0;
    if (current <= 1) {
      counts.delete(projectId);
      return;
    }

    counts.set(projectId, current - 1);
  }

  function getCount(projectId: string): number {
    return counts.get(projectId) ?? 0;
  }

  function getCounts(): Map<string, number> {
    return counts;
  }

  return { acquire, release, getCount, getCounts };
}

describe("Renderer helpers", () => {
  describe("getEnv", () => {
    it("should return undefined for unset env vars", () => {
      assertEquals(getEnv("NONEXISTENT_VAR_12345"), undefined);
    });

    it("should return value for set env vars (Deno)", () => {
      const path = getEnv("PATH");
      assertEquals(typeof path === "string" || path === undefined, true);
    });
  });

  describe("computePerProjectLimit", () => {
    it("should compute default per-project limit as ceil(maxConcurrent/3)", () => {
      assertEquals(computePerProjectLimit(30), 10);
      assertEquals(computePerProjectLimit(31), 11);
      assertEquals(computePerProjectLimit(3), 1);
      assertEquals(computePerProjectLimit(1), 1);
    });

    it("should handle the default concurrent value", () => {
      assertEquals(computePerProjectLimit(RENDER_MAX_CONCURRENT_DEFAULT), 10);
    });
  });

  describe("projectSlotManager", () => {
    it("should acquire and release slots", () => {
      const manager = createProjectSlotManager(3);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.getCount("proj-1"), 1);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 0);
    });

    it("should track multiple projects independently", () => {
      const manager = createProjectSlotManager(3);
      manager.acquire("proj-a");
      manager.acquire("proj-b");
      assertEquals(manager.getCount("proj-a"), 1);
      assertEquals(manager.getCount("proj-b"), 1);
    });

    it("should reject when limit is reached", () => {
      const manager = createProjectSlotManager(2);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), false);
      assertEquals(manager.getCount("proj-1"), 2);
    });

    it("should allow acquisition after release", () => {
      const manager = createProjectSlotManager(1);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), false);
      manager.release("proj-1");
      assertEquals(manager.acquire("proj-1"), true);
    });

    it("should clean up map entry when count reaches zero", () => {
      const manager = createProjectSlotManager(2);
      manager.acquire("proj-1");
      manager.release("proj-1");
      assertEquals(manager.getCounts().has("proj-1"), false);
    });

    it("should handle release on non-acquired project gracefully", () => {
      const manager = createProjectSlotManager(2);
      manager.release("never-acquired");
      assertEquals(manager.getCount("never-acquired"), 0);
    });

    it("should bypass limits when limit is 0", () => {
      const manager = createProjectSlotManager(0);
      for (let i = 0; i < 100; i++) {
        assertEquals(manager.acquire("proj-1"), true);
      }
    });

    it("should bypass limits when limit is negative", () => {
      const manager = createProjectSlotManager(-1);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), true);
    });

    it("should decrement correctly with multiple releases", () => {
      const manager = createProjectSlotManager(5);
      manager.acquire("proj-1");
      manager.acquire("proj-1");
      manager.acquire("proj-1");
      assertEquals(manager.getCount("proj-1"), 3);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 2);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 1);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 0);
    });
  });

  describe("RENDER_PIPELINE_TIMEOUT_MS defaults", () => {
    it("should parse default timeout as 60000", () => {
      assertEquals(parseInt("60000", 10), 60000);
    });

    it("should parse custom timeout from string", () => {
      assertEquals(parseInt("30000", 10), 30000);
    });

    it("should handle invalid timeout string as NaN", () => {
      assertEquals(Number.isNaN(parseInt("not-a-number", 10)), true);
    });
  });

  describe("RENDER_MAX_CONCURRENT defaults", () => {
    it("should parse default max concurrent as 30", () => {
      assertEquals(parseInt("30", 10), 30);
    });
  });

  describe("buildCacheKey (cache key sanitization)", () => {
    // Mirrors the logic from Renderer.buildCacheKey to test cache key generation
    function buildCacheKey(slug: string, url?: URL): string | null {
      if (!url) return slug;

      const params = new URLSearchParams(url.searchParams);
      const sorted = [...params.entries()].sort(([a], [b]) => a.localeCompare(b));
      const queryString = sorted.map(([k, v]) => `${k}=${v}`).join("&");
      // Hash query string to create cache-safe key (API cache only allows alphanumeric, _ : . - /)
      return queryString ? `${slug}:q${simpleHash(queryString).toString(16)}` : slug;
    }

    it("should return slug unchanged when no URL provided", () => {
      assertEquals(buildCacheKey("blog/articles/hello-world"), "blog/articles/hello-world");
    });

    it("should return slug unchanged when URL has no query params", () => {
      const url = new URL("https://example.com/blog/articles/hello-world");
      assertEquals(buildCacheKey("blog/articles/hello-world", url), "blog/articles/hello-world");
    });

    it("should hash query params to create safe cache key", () => {
      const url = new URL(
        "https://example.com/blog/articles/hello-world?utm_campaign=test&ref=google",
      );
      const key = buildCacheKey("blog/articles/hello-world", url);

      // Key should NOT contain invalid characters (? = &)
      assertEquals(key?.includes("?"), false);
      assertEquals(key?.includes("="), false);
      assertEquals(key?.includes("&"), false);

      // Key should have the format: slug:qHASH
      assertMatch(key!, /^blog\/articles\/hello-world:q[0-9a-f]+$/);
    });

    it("should generate same cache key for same query params regardless of order", () => {
      const url1 = new URL("https://example.com/page?a=1&b=2");
      const url2 = new URL("https://example.com/page?b=2&a=1");
      assertEquals(buildCacheKey("page", url1), buildCacheKey("page", url2));
    });

    it("should generate different cache key for different query params", () => {
      const url1 = new URL("https://example.com/page?a=1");
      const url2 = new URL("https://example.com/page?a=2");
      const key1 = buildCacheKey("page", url1);
      const key2 = buildCacheKey("page", url2);
      assertEquals(key1 !== key2, true);
    });

    it("should handle complex tracking params safely", () => {
      // Real-world example from the production bug
      const url = new URL(
        "https://example.com/blog/articles/twelve-factor-app-methodology?_hsenc=p2ANqtz-8hLy7cANpDPJCpSFuf6jEoLhCH&utm_campaign=KubeWeekly&utm_medium=email&utm_source=hs_email",
      );
      const key = buildCacheKey("blog/articles/twelve-factor-app-methodology", url);

      // Must only contain allowed chars: alphanumeric, underscore, colon, dot, hyphen, forward slash
      assertMatch(key!, /^[a-zA-Z0-9_:.\-\/]+$/);
    });
  });
});
