import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { TokenFetchSupersededError, TokenManager } from "./token-manager.ts";
import type { TokenCache, TokenCacheEntry } from "./cache/types.ts";

/** In-memory cache that counts operations */
class SpyCache implements TokenCache {
  private store = new Map<string, TokenCacheEntry>();
  getCount = 0;
  setCount = 0;
  getGate?: Promise<void>;
  onGet?: () => void;

  async get(key: string): Promise<TokenCacheEntry | null> {
    this.getCount++;
    this.onGet?.();
    if (this.getGate) await this.getGate;
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

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.store.has(key));
  }

  async stats(): Promise<{ hits: number; misses: number; size: number; type: "memory" }> {
    return { hits: 0, misses: 0, size: this.store.size, type: "memory" };
  }

  async close(): Promise<void> {}

  seed(key: string, entry: TokenCacheEntry): void {
    this.store.set(key, entry);
  }
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
                token_type: "Bearer",
                expires_in: 3600,
              }),
              { headers: { "Content-Type": "application/json" } },
            ),
          );
        }, 50);
      });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;
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
    const [_token1, _token2] = await Promise.all([
      manager.getToken("production", "project-a"),
      manager.getToken("production", "project-b"),
    ]);

    // Different keys should result in separate fetches
    assertEquals(fetchCount, 2);
    assertEquals(cache.setCount, 2);

    await manager.close();
  });

  it("negative-caches typed 404 token failures", async () => {
    await mockServer?.shutdown();
    mockServer = Deno.serve({ port: 0, onListen() {} }, () => {
      fetchCount++;
      return new Response("Project missing", { status: 404 });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

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

    await assertRejects(
      () => manager.getToken("production", "missing-project"),
      Error,
      "404",
    );
    await assertRejects(
      () => manager.getToken("production", "missing-project"),
      Error,
      "404",
    );

    assertEquals(fetchCount, 1);

    await manager.close();
  });

  it("keeps global, project, and custom-domain cache identities distinct", async () => {
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

    await manager.getToken("production");
    await manager.getToken("production", "global");
    await manager.getToken("production", undefined, "global");

    assertEquals(fetchCount, 3);
    assertEquals(cache.setCount, 3);
    await manager.close();
  });

  it("does not invoke accessors from a malformed cache entry", async () => {
    const cache = new SpyCache();
    let tokenGetterReads = 0;
    const forgedEntry = Object.create(null);
    Object.defineProperties(forgedEntry, {
      token: {
        enumerable: true,
        get() {
          tokenGetterReads++;
          return "forged-token";
        },
      },
      expiresAt: {
        enumerable: true,
        value: Date.now() + 60_000,
      },
      scope: {
        enumerable: true,
        value: "production",
      },
    });
    cache.seed(
      JSON.stringify(["production", "project", "project"]),
      forgedEntry as TokenCacheEntry,
    );
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

    assertEquals(await manager.getToken("production", "project"), "test-token-1");
    assertEquals(tokenGetterReads, 0);
    assertEquals(fetchCount, 1);
    await manager.close();
  });

  it("supersedes a cache read that overlaps a full cache clear", async () => {
    let releaseGet!: () => void;
    let markGetStarted!: () => void;
    const getGate = new Promise<void>((resolve) => {
      releaseGet = resolve;
    });
    const getStarted = new Promise<void>((resolve) => {
      markGetStarted = resolve;
    });
    const cache = new SpyCache();
    cache.getGate = getGate;
    cache.onGet = markGetStarted;
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

    const stale = manager.getToken("production", "project");
    await getStarted;
    const clear = manager.clearCache();
    cache.getGate = undefined;
    cache.onGet = undefined;
    releaseGet();

    await assertRejects(() => stale, TokenFetchSupersededError);
    await clear;
    assertEquals(fetchCount, 0);
    assertEquals(await manager.getToken("production", "project"), "test-token-1");
    await manager.close();
  });

  it("does not let an invalidated in-flight fetch publish stale cache state", async () => {
    await mockServer?.shutdown();
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    mockServer = Deno.serve({ port: 0, onListen() {} }, async () => {
      fetchCount++;
      if (fetchCount === 1) {
        markFirstStarted();
        await firstGate;
      }
      return Response.json({
        access_token: `test-token-${fetchCount}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

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

    const stale = manager.getToken("production", "project");
    await firstStarted;
    const invalidation = manager.invalidateToken("production", "project");
    releaseFirst();

    await assertRejects(() => stale, TokenFetchSupersededError);
    await invalidation;
    assertEquals(cache.setCount, 0);
    assertEquals(await manager.getToken("production", "project"), "test-token-2");
    assertEquals(cache.setCount, 1);
    await manager.close();
  });
});
