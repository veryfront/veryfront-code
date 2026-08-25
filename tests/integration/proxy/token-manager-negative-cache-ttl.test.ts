import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { TokenManager } from "#veryfront/proxy/token-manager.ts";
import { OAuthTokenRequestError } from "#veryfront/proxy/oauth-client.ts";
import type { TokenCache, TokenCacheEntry } from "#veryfront/proxy/cache/types.ts";

/**
 * Relocated from src/proxy/token-manager.test.ts: proving that a negative cache
 * entry expires requires advancing the process-global clock, which the semantic
 * unit-boundary audit classifies as a process effect. TokenManager exposes no
 * clock seam, and the TTL is five minutes, so waiting it out is not an option.
 * Integration is where a host effect like this is allowed to live.
 */

/** Mirrors the non-exported NEGATIVE_CACHE_TTL_MS in token-manager.ts. */
const NEGATIVE_CACHE_TTL_MS = 5 * 60 * 1_000;

/** Minimal in-memory token cache. */
class MemoryCache implements TokenCache {
  private store = new Map<string, TokenCacheEntry>();

  get(key: string): Promise<TokenCacheEntry | null> {
    return Promise.resolve(this.store.get(key) ?? null);
  }

  set(key: string, entry: TokenCacheEntry): Promise<void> {
    this.store.set(key, entry);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.store.has(key));
  }

  stats(): Promise<{ hits: number; misses: number; size: number; type: "memory" }> {
    return Promise.resolve({ hits: 0, misses: 0, size: this.store.size, type: "memory" });
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

describe("TokenManager negative cache TTL", () => {
  let mockServer: Deno.HttpServer | undefined;

  afterEach(async () => {
    await mockServer?.shutdown();
    mockServer = undefined;
  });

  it("re-fetches once a negative cache entry outlives its TTL", async () => {
    let fetchCount = 0;
    mockServer = Deno.serve({ port: 0, onListen() {} }, () => {
      fetchCount++;
      return new Response("Project missing", { status: 404 });
    });
    const serverPort = (mockServer.addr as Deno.NetAddr).port;

    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      { cache: new MemoryCache() },
    );

    await assertRejects(
      () => manager.getToken("production", "missing-project"),
      OAuthTokenRequestError,
      "404",
    );
    assertEquals(fetchCount, 1, "the first miss must reach the token service exactly once");

    const originalDateNow = Date.now;
    try {
      Date.now = () => originalDateNow() + NEGATIVE_CACHE_TTL_MS + 1_000;
      await assertRejects(
        () => manager.getToken("production", "missing-project"),
        OAuthTokenRequestError,
        "404",
      );
    } finally {
      Date.now = originalDateNow;
    }

    assertEquals(
      fetchCount,
      2,
      "an expired negative cache entry must be dropped so the project becomes reachable again",
    );

    await manager.close();
  });
});
