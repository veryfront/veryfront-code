import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  TokenFetchSupersededError,
  TokenManager,
  TokenResolutionCapacityError,
} from "./token-manager.ts";
import { OAuthTokenRequestError } from "./oauth-client.ts";
import type { TokenCache, TokenCacheEntry } from "./cache/types.ts";

/** Base64url-encodes a JWT segment without padding. */
function encodeJwtSegment(value: string): string {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** In-memory cache that counts operations */
class SpyCache implements TokenCache {
  private store = new Map<string, TokenCacheEntry>();
  getCount = 0;
  setCount = 0;
  getGate?: Promise<void>;
  onGet?: () => void;
  snapshotGetBeforeGate = false;

  async get(key: string): Promise<TokenCacheEntry | null> {
    this.getCount++;
    this.onGet?.();
    const snapshot = this.snapshotGetBeforeGate ? this.store.get(key) ?? null : undefined;
    if (this.getGate) await this.getGate;
    return this.snapshotGetBeforeGate ? snapshot! : this.store.get(key) ?? null;
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

  it("rejects invalid token-fetch resource policies at construction", () => {
    const config = {
      apiBaseUrl: `http://localhost:${serverPort}`,
      apiClientId: "id",
      apiClientSecret: "secret",
      previewApiClientId: "pid",
      previewApiClientSecret: "psecret",
    };

    assertThrows(
      () => new TokenManager(config, { maxConcurrentFetches: 0 }),
      RangeError,
      "Token fetch concurrency",
    );
    assertThrows(
      () => new TokenManager(config, { maxQueuedFetches: -1 }),
      RangeError,
      "Token fetch queue capacity",
    );
    assertThrows(
      () => new TokenManager(config, { maxConcurrentResolutions: 0 }),
      RangeError,
      "Token resolution concurrency",
    );
    assertThrows(
      () => new TokenManager(config, { refreshBuffer: -1 }),
      RangeError,
      "Token refresh buffer",
    );
  });

  it("bounds complete token resolutions before slow cache I/O starts", async () => {
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
      { cache, maxConcurrentResolutions: 1 },
    );

    const first = manager.getToken("production", "first-project");
    await getStarted;
    const capacityErrors = await Promise.all(
      Array.from({ length: 200 }, (_, index) =>
        assertRejects(
          () => manager.getToken("production", `overflow-${index}`),
          TokenResolutionCapacityError,
        )),
    );
    const capacityError = capacityErrors[0];
    assertInstanceOf(capacityError, TokenResolutionCapacityError);
    assertEquals(capacityError.capacity, "resolutions");
    assertEquals(
      capacityErrors.every((error) =>
        error instanceof TokenResolutionCapacityError &&
        error.capacity === "resolutions"
      ),
      true,
    );
    assertEquals(cache.getCount, 1);
    assertEquals(fetchCount, 0);

    cache.getGate = undefined;
    cache.onGet = undefined;
    releaseGet();
    assertEquals(await first, "test-token-1");
    assertEquals(
      await manager.getToken("production", "after-release"),
      "test-token-2",
    );
    assertEquals(cache.getCount, 2);
    await manager.close();
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

  it("bounds distinct-identity OAuth fanout and rejects saturated admission", async () => {
    await mockServer?.shutdown();
    let activeFetches = 0;
    let maximumActiveFetches = 0;
    let markFirstWaveStarted!: () => void;
    const firstWaveStarted = new Promise<void>((resolve) => {
      markFirstWaveStarted = resolve;
    });
    let releaseFetches!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetches = resolve;
    });
    mockServer = Deno.serve({ port: 0, onListen() {} }, async () => {
      const requestNumber = ++fetchCount;
      activeFetches++;
      maximumActiveFetches = Math.max(maximumActiveFetches, activeFetches);
      if (activeFetches === 2) markFirstWaveStarted();
      await fetchGate;
      activeFetches--;
      return Response.json({
        access_token: `test-token-${requestNumber}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      {
        cache: new SpyCache(),
        maxConcurrentFetches: 2,
        maxQueuedFetches: 2,
      },
    );

    const admitted = ["one", "two", "three", "four"].map((projectSlug) =>
      manager.getToken("production", projectSlug)
    );
    const overflow = manager.getToken("production", "five");
    const overflowRejected = assertRejects(
      () => overflow,
      TokenResolutionCapacityError,
      "OAuth token resolution capacity is exhausted",
    );

    await firstWaveStarted;
    assertEquals(activeFetches, 2);
    assertEquals(fetchCount, 2);
    const overflowError = await overflowRejected;
    assertInstanceOf(overflowError, TokenResolutionCapacityError);
    assertEquals(overflowError.capacity, "admission");

    releaseFetches();
    await Promise.all(admitted);
    assertEquals(fetchCount, 4);
    assertEquals(maximumActiveFetches, 2);
    await manager.close();
  });

  it("removes an invalidated queued producer and admits its replacement", async () => {
    await mockServer?.shutdown();
    let markActiveFetchStarted!: () => void;
    const activeFetchStarted = new Promise<void>((resolve) => {
      markActiveFetchStarted = resolve;
    });
    let releaseActiveFetch!: () => void;
    const activeFetchGate = new Promise<void>((resolve) => {
      releaseActiveFetch = resolve;
    });
    mockServer = Deno.serve({ port: 0, onListen() {} }, async () => {
      const requestNumber = ++fetchCount;
      if (requestNumber === 1) {
        markActiveFetchStarted();
        await activeFetchGate;
      }
      return Response.json({
        access_token: `test-token-${requestNumber}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      {
        cache: new SpyCache(),
        maxConcurrentFetches: 1,
        maxQueuedFetches: 1,
        maxConcurrentResolutions: 4,
      },
    );

    const active = manager.getToken("production", "active-project");
    await activeFetchStarted;
    const queued = manager.getToken("production", "invalidated-project");
    const queuedRejected = assertRejects(
      () => queued,
      TokenFetchSupersededError,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    await manager.invalidateToken("production", "invalidated-project");
    await queuedRejected;
    const replacement = manager.getToken("production", "replacement-project");
    releaseActiveFetch();

    assertEquals(await active, "test-token-1");
    assertEquals(await replacement, "test-token-2");
    assertEquals(fetchCount, 2);
    await manager.close();
  });

  it("close aborts and drains both active and queued token producers", async () => {
    await mockServer?.shutdown();
    let markActiveFetchStarted!: () => void;
    const activeFetchStarted = new Promise<void>((resolve) => {
      markActiveFetchStarted = resolve;
    });
    let releaseServerHandler!: () => void;
    const serverHandlerGate = new Promise<void>((resolve) => {
      releaseServerHandler = resolve;
    });
    mockServer = Deno.serve({ port: 0, onListen() {} }, async () => {
      fetchCount++;
      markActiveFetchStarted();
      await serverHandlerGate;
      return Response.json({
        access_token: "must-not-publish",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      {
        cache: new SpyCache(),
        maxConcurrentFetches: 1,
        maxQueuedFetches: 1,
      },
    );

    const active = manager.getToken("production", "active-project");
    await activeFetchStarted;
    const queued = manager.getToken("production", "queued-project");
    const activeRejected = assertRejects(
      () => active,
      TokenFetchSupersededError,
    );
    const queuedRejected = assertRejects(
      () => queued,
      TokenFetchSupersededError,
    );
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    await Promise.all([manager.close(), activeRejected, queuedRejected]);
    releaseServerHandler();
    assertEquals(fetchCount, 1);
  });

  it("lets one waiter abort without cancelling or duplicating shared OAuth work", async () => {
    await mockServer?.shutdown();
    let markFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    let releaseFetch!: () => void;
    const fetchGate = new Promise<void>((resolve) => {
      releaseFetch = resolve;
    });
    mockServer = Deno.serve({ port: 0, onListen() {} }, async () => {
      fetchCount++;
      markFetchStarted();
      await fetchGate;
      return Response.json({
        access_token: "shared-token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      { cache: new SpyCache(), maxConcurrentResolutions: 2 },
    );
    const disconnected = new Error("request disconnected");
    const leaderController = new AbortController();
    const leader = manager.getToken(
      "production",
      "shared-project",
      undefined,
      { signal: leaderController.signal },
    );
    await fetchStarted;

    const follower = manager.getToken("production", "shared-project");
    await Promise.resolve();
    await Promise.resolve();
    leaderController.abort(disconnected);

    const leaderError = await assertRejects(() => leader, Error, disconnected.message);
    assertEquals(leaderError, disconnected);
    const lateFollower = manager.getToken("production", "shared-project");
    const overflowError = await assertRejects(
      () => manager.getToken("production", "shared-project"),
      TokenResolutionCapacityError,
    );
    assertInstanceOf(overflowError, TokenResolutionCapacityError);
    assertEquals(overflowError.capacity, "resolutions");
    assertEquals(fetchCount, 1);
    releaseFetch();
    assertEquals(await Promise.all([follower, lateFollower]), [
      "shared-token",
      "shared-token",
    ]);
    assertEquals(fetchCount, 1);
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

    const fresh = await assertRejects(
      () => manager.getToken("production", "missing-project"),
      OAuthTokenRequestError,
      "404",
    );
    assertInstanceOf(fresh, OAuthTokenRequestError);
    assertEquals(fresh.status, 404, "the fresh failure must carry the upstream status");
    const replayed = await assertRejects(
      () => manager.getToken("production", "missing-project"),
      OAuthTokenRequestError,
      "404",
    );
    assertInstanceOf(replayed, OAuthTokenRequestError);
    assertEquals(
      replayed.status,
      404,
      "the replayed failure must stay typed so callers classify it by status, not by message",
    );
    assertEquals(
      replayed.responseText,
      "Project missing",
      "the replayed failure must carry the cached upstream response text",
    );

    assertEquals(fetchCount, 1);

    await manager.close();
  });

  it("does not negative-cache transient token service failures", async () => {
    await mockServer?.shutdown();
    mockServer = Deno.serve({ port: 0, onListen() {} }, () => {
      fetchCount++;
      return new Response("upstream down", { status: 500 });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      { cache: new SpyCache() },
    );

    await assertRejects(
      () => manager.getToken("production", "flaky-project"),
      OAuthTokenRequestError,
      "500",
    );
    await assertRejects(
      () => manager.getToken("production", "flaky-project"),
      OAuthTokenRequestError,
      "500",
    );

    assertEquals(
      fetchCount,
      2,
      "a transient 5xx must not be negative cached; the second call must re-hit the token endpoint",
    );

    await manager.close();
  });

  it("mints preview tokens with the preview API client credentials", async () => {
    await mockServer?.shutdown();
    const credentials: Array<{ client_id: unknown; client_secret: unknown }> = [];
    mockServer = Deno.serve({ port: 0, onListen() {} }, async (req) => {
      fetchCount++;
      const body = await req.json() as Record<string, unknown>;
      credentials.push({ client_id: body.client_id, client_secret: body.client_secret });
      return Response.json({
        access_token: `token-${fetchCount}`,
        token_type: "Bearer",
        expires_in: 3600,
      });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      { cache: new SpyCache() },
    );

    await manager.getToken("preview", "p");
    await manager.getToken("production", "p");

    assertEquals(
      credentials,
      [
        { client_id: "pid", client_secret: "psecret" },
        { client_id: "id", client_secret: "secret" },
      ],
      "preview scope must mint with the preview API client credentials and production scope with the production ones",
    );

    await manager.close();
  });

  it("derives cached expiry from the JWT exp claim when expires_in is absent", async () => {
    await mockServer?.shutdown();
    let exp = 0;
    mockServer = Deno.serve({ port: 0, onListen() {} }, () => {
      fetchCount++;
      return Response.json({
        access_token: `e30.${encodeJwtSegment(JSON.stringify({ exp }))}.sig`,
        token_type: "Bearer",
      });
    });
    serverPort = (mockServer.addr as Deno.NetAddr).port;

    const manager = new TokenManager(
      {
        apiBaseUrl: `http://localhost:${serverPort}`,
        apiClientId: "id",
        apiClientSecret: "secret",
        previewApiClientId: "pid",
        previewApiClientSecret: "psecret",
      },
      { cache: new SpyCache() },
    );

    exp = Math.floor(Date.now() / 1_000) + 30;
    await manager.getToken("production", "expiring-soon");
    await manager.getToken("production", "expiring-soon");
    assertEquals(
      fetchCount,
      2,
      "a JWT expiring inside the refresh buffer must not be served from cache",
    );

    exp = Math.floor(Date.now() / 1_000) + 3_600;
    await manager.getToken("production", "long-lived");
    await manager.getToken("production", "long-lived");
    assertEquals(
      fetchCount,
      3,
      "a JWT exp beyond the refresh buffer must keep the cached token",
    );

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

  it("does not reuse a per-key generation after invalidation overlaps a stale cache read", async () => {
    const gate = Promise.withResolvers<void>();
    const started = Promise.withResolvers<void>();
    const cache = new SpyCache();
    cache.seed(JSON.stringify(["production", "project", "project"]), {
      token: "stale-cached-token",
      expiresAt: Date.now() + 60 * 60 * 1_000,
      scope: "production",
      projectSlug: "project",
    });
    cache.snapshotGetBeforeGate = true;
    cache.getGate = gate.promise;
    cache.onGet = () => started.resolve();
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

    const staleRead = manager.getToken("production", "project");
    await started.promise;
    await manager.invalidateToken("production", "project");
    gate.resolve();

    await assertRejects(() => staleRead, TokenFetchSupersededError);
    assertEquals(fetchCount, 0);
    cache.getGate = undefined;
    cache.onGet = undefined;
    cache.snapshotGetBeforeGate = false;
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
