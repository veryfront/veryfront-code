import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { MissingCustomDomainProjectError, TokenManager } from "./token-manager.ts";
import { OAuthTokenRequestError } from "./oauth-client.ts";
import type { TokenCache, TokenCacheEntry } from "./cache/types.ts";

/** In-memory cache that counts operations */
class SpyCache implements TokenCache {
  protected store = new Map<string, TokenCacheEntry>();
  getCount = 0;
  setCount = 0;
  closeCount = 0;

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

  has(key: string): Promise<boolean> {
    return Promise.resolve(this.store.has(key));
  }

  async stats(): Promise<{ hits: number; misses: number; size: number; type: "memory" }> {
    return { hits: 0, misses: 0, size: this.store.size, type: "memory" };
  }

  async close(): Promise<void> {
    this.closeCount++;
  }
}

class RacingCache extends SpyCache {
  private getCalls = 0;

  override async get(key: string): Promise<TokenCacheEntry | null> {
    this.getCalls++;
    if (this.getCalls === 2) {
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return super.get(key);
  }
}

class DelayedSetCache extends SpyCache {
  readonly setStarted: Promise<void>;
  private signalSetStarted!: () => void;
  private readonly allowSet: Promise<void>;
  private releasePendingSet!: () => void;

  constructor() {
    super();
    this.setStarted = new Promise((resolve) => {
      this.signalSetStarted = resolve;
    });
    this.allowSet = new Promise((resolve) => {
      this.releasePendingSet = resolve;
    });
  }

  override async set(key: string, entry: TokenCacheEntry): Promise<void> {
    this.signalSetStarted();
    await this.allowSet;
    await super.set(key, entry);
  }

  releaseSet(): void {
    this.releasePendingSet();
  }
}

class CorruptCache extends SpyCache {
  override get(_key: string): Promise<TokenCacheEntry | null> {
    this.getCount++;
    return Promise.resolve({
      token: "",
      expiresAt: Date.now() + 600_000,
      scope: "preview",
      projectSlug: "wrong-project",
    });
  }
}

class DelayedClearCache extends SpyCache {
  readonly clearStarted: Promise<void>;
  private signalClearStarted!: () => void;
  private readonly allowClear: Promise<void>;
  private releasePendingClear!: () => void;

  constructor() {
    super();
    this.clearStarted = new Promise((resolve) => {
      this.signalClearStarted = resolve;
    });
    this.allowClear = new Promise((resolve) => {
      this.releasePendingClear = resolve;
    });
  }

  override async clear(): Promise<void> {
    this.signalClearStarted();
    await this.allowClear;
    await super.clear();
  }

  releaseClear(): void {
    this.releasePendingClear();
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

  it("deduplicates the cache lookup and fetch as one single-flight operation", async () => {
    const cache = new RacingCache();
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

    const [first, second] = await Promise.all([
      manager.getToken("production", "race-project"),
      manager.getToken("production", "race-project"),
    ]);

    assertEquals(first, second);
    assertEquals(fetchCount, 1);
    assertEquals(cache.getCount, 1);
    await manager.close();
  });

  it("does not trust malformed or cross-scope entries returned by a cache backend", async () => {
    const cache = new CorruptCache();
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

    assertEquals(await manager.getToken("production", "expected-project"), "test-token-1");
    assertEquals(fetchCount, 1);
    assertEquals(cache.setCount, 1);
    await manager.close();
  });

  it("does not let an in-flight fetch resurrect an invalidated token", async () => {
    const cache = new DelayedSetCache();
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

    const tokenRequest = manager.getToken("production", "invalidate-project");
    await cache.setStarted;
    const invalidation = manager.invalidateToken("production", "invalidate-project");
    cache.releaseSet();
    await Promise.all([tokenRequest, invalidation]);

    assertEquals(await cache.has("production:project:invalidate-project"), false);
    await manager.close();
  });

  it("registers a token request before an immediate invalidation can inspect it", async () => {
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

    const tokenRequest = manager.getToken("production", "immediate-invalidation");
    await manager.invalidateToken("production", "immediate-invalidation");
    await tokenRequest;

    assertEquals(await cache.has("production:project:immediate-invalidation"), false);
    await manager.close();
  });

  it("does not share a pre-invalidation request with a caller that starts afterward", async () => {
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

    const beforeInvalidation = manager.getToken("production", "ordered-invalidation");
    const invalidation = manager.invalidateToken("production", "ordered-invalidation");
    const afterInvalidation = manager.getToken("production", "ordered-invalidation");

    const [oldToken, newToken] = await Promise.all([
      beforeInvalidation,
      afterInvalidation,
      invalidation,
    ]);
    assertEquals(fetchCount, 2);
    assertEquals(oldToken === newToken, false);
    assertEquals(
      (await cache.get("production:project:ordered-invalidation"))?.token,
      newToken,
    );
    await manager.close();
  });

  it("orders clear, token fetch, and invalidation without a lifecycle deadlock", async () => {
    const cache = new DelayedClearCache();
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

    const clearing = manager.clearCache();
    await cache.clearStarted;
    const tokenRequest = manager.getToken("production", "ordered-lifecycle");
    const invalidation = manager.invalidateToken("production", "ordered-lifecycle");
    cache.releaseClear();

    await Promise.all([clearing, tokenRequest, invalidation]);
    assertEquals(await cache.has("production:project:ordered-lifecycle"), false);
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

  it("classifies custom-domain 400 and 404 failures without matching response text", async () => {
    await mockServer?.shutdown();
    mockServer = Deno.serve({ port: 0, onListen() {} }, () => {
      fetchCount++;
      return new Response("arbitrary upstream body", { status: 400 });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

    const manager = new TokenManager({
      apiBaseUrl: `http://localhost:${serverPort}`,
      apiClientId: "id",
      apiClientSecret: "secret",
      previewApiClientId: "pid",
      previewApiClientSecret: "psecret",
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const error = await assertRejects(
        () => manager.getToken("production", undefined, "custom.example"),
        MissingCustomDomainProjectError,
      );
      assertEquals(error instanceof OAuthTokenRequestError, true);
      assertEquals((error as MissingCustomDomainProjectError).status, 400);
    }
    assertEquals(fetchCount, 1);
    await manager.close();
  });

  it("does not classify project-slug failures as missing custom domains", async () => {
    await mockServer?.shutdown();
    mockServer = Deno.serve(
      { port: 0, onListen() {} },
      () => new Response("same status, different request context", { status: 400 }),
    );
    serverPort = (mockServer.addr as Deno.NetAddr).port;
    const manager = new TokenManager({
      apiBaseUrl: `http://localhost:${serverPort}`,
      apiClientId: "id",
      apiClientSecret: "secret",
      previewApiClientId: "pid",
      previewApiClientSecret: "psecret",
    });

    const error = await assertRejects(
      () => manager.getToken("production", "project"),
      OAuthTokenRequestError,
    );
    assertEquals(error instanceof MissingCustomDomainProjectError, false);
    await manager.close();
  });

  it("classifies an allowlisted structured domain miss even with a managed project slug", async () => {
    await mockServer?.shutdown();
    mockServer = Deno.serve(
      { port: 0, onListen() {} },
      () =>
        new Response(JSON.stringify({ error: "Project not found for domain" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }),
    );
    serverPort = (mockServer.addr as Deno.NetAddr).port;
    const manager = new TokenManager({
      apiBaseUrl: `http://localhost:${serverPort}`,
      apiClientId: "id",
      apiClientSecret: "secret",
      previewApiClientId: "pid",
      previewApiClientSecret: "psecret",
    });

    await assertRejects(
      () => manager.getToken("production", "managed-project"),
      MissingCustomDomainProjectError,
    );
    await manager.close();
  });

  it("validates refresh configuration and mutually exclusive project identities", async () => {
    const config = {
      apiBaseUrl: `http://localhost:${serverPort}`,
      apiClientId: "id",
      apiClientSecret: "secret",
      previewApiClientId: "pid",
      previewApiClientSecret: "psecret",
    };
    assertThrows(() => new TokenManager(config, { refreshBuffer: -1 }), RangeError);

    const manager = new TokenManager(config);
    await assertRejects(
      () => manager.invalidateToken("staging" as "production"),
      TypeError,
      "scope",
    );
    await assertRejects(
      () => manager.getToken("production", "project", "custom.example"),
      TypeError,
      "mutually exclusive",
    );
    await manager.close();
  });

  it("allows an intentionally unconfigured credential pair until a token is requested", async () => {
    const manager = new TokenManager({
      apiBaseUrl: `http://localhost:${serverPort}`,
      apiClientId: "",
      apiClientSecret: "",
      previewApiClientId: "",
      previewApiClientSecret: "",
    });

    await assertRejects(
      () => manager.getToken("production", "project"),
      TypeError,
      "apiClientId",
    );
    await manager.close();
  });

  it("rejects a token whose JWT expiry is already in the past", async () => {
    await mockServer?.shutdown();
    const payload = btoa(JSON.stringify({ exp: 1 })).replace(/=/g, "").replace(/\+/g, "-")
      .replace(/\//g, "_");
    mockServer = Deno.serve(
      { port: 0, onListen() {} },
      () =>
        new Response(
          JSON.stringify({ access_token: `header.${payload}.signature`, token_type: "Bearer" }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    serverPort = (mockServer.addr as Deno.NetAddr).port;
    const manager = new TokenManager({
      apiBaseUrl: `http://localhost:${serverPort}`,
      apiClientId: "id",
      apiClientSecret: "secret",
      previewApiClientId: "pid",
      previewApiClientSecret: "psecret",
    });

    await assertRejects(
      () => manager.getToken("production", "expired-token-project"),
      TypeError,
      "expired",
    );
    await manager.close();
  });

  it("drains an active request before closing the cache and then rejects new work", async () => {
    const cache = new DelayedSetCache();
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

    const tokenRequest = manager.getToken("production", "closing-project");
    await cache.setStarted;
    let closeCompleted = false;
    const close = manager.close().then(() => {
      closeCompleted = true;
    });
    await Promise.resolve();
    assertEquals(closeCompleted, false);

    cache.releaseSet();
    await Promise.all([tokenRequest, close]);
    assertEquals(cache.closeCount, 1);
    await assertRejects(() => manager.getToken("production", "closing-project"), Error, "closed");
  });
});
