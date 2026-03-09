import { assertEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { TokenManager } from "./token-manager.ts";
import type { TokenCache, TokenCacheEntry } from "./cache/types.ts";

/** In-memory cache that counts operations */
class SpyCache implements TokenCache {
  private store = new Map<string, TokenCacheEntry>();
  getCount = 0;
  setCount = 0;

  async get(key: string): Promise<TokenCacheEntry | null> {
    this.getCount++;
    return this.store.get(key) ?? null;
  }

  async set(key: string, entry: TokenCacheEntry): Promise<void> {
    this.setCount++;
    this.store.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async clear(): Promise<void> {
    this.store.clear();
  }

  async stats() {
    return { hits: 0, misses: 0, size: this.store.size, type: "spy" };
  }

  async close(): Promise<void> {}
}

describe("TokenManager", () => {
  let mockServer: Deno.HttpServer | undefined;
  let fetchCount: number;
  let serverPort: number;

  beforeEach(async () => {
    fetchCount = 0;
    // Create a local HTTP server that responds to OAuth token requests
    mockServer = Deno.serve({ port: 0, onListen() {} }, (_req) => {
      fetchCount++;
      // Simulate a small delay so concurrent requests overlap
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(
            new Response(
              JSON.stringify({
                access_token: "test-token-" + fetchCount,
                expires_in: 3600,
              }),
              { headers: { "Content-Type": "application/json" } },
            ),
          );
        }, 50);
      });
    });
    serverPort = mockServer.addr.port;
  });

  afterEach(async () => {
    await mockServer?.shutdown();
  });

  it("should deduplicate concurrent getToken calls to prevent duplicate fetches", async () => {
    const cache = new SpyCache();
    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      { cache },
    );

    // Fire two concurrent requests for the same scope/project
    const [token1, token2] = await Promise.all([
      manager.getToken("production", "my-project"),
      manager.getToken("production", "my-project"),
    ]);

    // Both should get the same token
    assertEquals(token1, token2);
    // Only one actual HTTP fetch should have occurred
    assertEquals(fetchCount, 1);
    // Only one cache set should have occurred
    assertEquals(cache.setCount, 1);

    await manager.close();
  });

  it("should allow separate fetches for different cache keys", async () => {
    const cache = new SpyCache();
    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      { cache },
    );

    // Fire concurrent requests for different projects
    const [token1, token2] = await Promise.all([
      manager.getToken("production", "project-a"),
      manager.getToken("production", "project-b"),
    ]);

    // Different keys should result in separate fetches
    assertEquals(fetchCount, 2);
    assertEquals(cache.setCount, 2);

    await manager.close();
  });
});
