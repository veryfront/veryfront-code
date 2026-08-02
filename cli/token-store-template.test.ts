import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryTokenStore } from "veryfront/oauth";
import {
  configureTokenStore,
  createDefaultTokenStore,
  createTokenStore,
} from "./templates/integrations/_base/files/lib/token-store.ts";

describe("generated OAuth token store", () => {
  const originalNodeEnv = Deno.env.get("NODE_ENV");

  afterEach(() => {
    if (originalNodeEnv === undefined) Deno.env.delete("NODE_ENV");
    else Deno.env.set("NODE_ENV", originalNodeEnv);
  });

  it("adapts one refresh-capable store for handlers and generated clients", async () => {
    const store = createTokenStore(new MemoryTokenStore("template-adapter"));
    const initial = {
      accessToken: "access-1",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 60_000,
    };

    await store.setToken("alice", "github", initial);
    assertEquals(await store.getToken("alice", "github"), initial);
    assertEquals(await store.getTokens("github", "alice"), initial);
    assertEquals(await store.isConnected("alice", "github"), true);

    const snapshot = await store.getTokenSnapshot("github", "alice");
    if (!snapshot) throw new Error("Expected a revisioned token snapshot");

    assertEquals(
      await store.compareAndSetTokens("github", "alice", snapshot.revision, {
        ...initial,
        accessToken: "access-2",
      }),
      true,
    );
    assertEquals((await store.getToken("alice", "github"))?.accessToken, "access-2");

    assertEquals(
      await store.withTokenRefreshLock("github", "alice", () => Promise.resolve("locked")),
      "locked",
    );

    const state = {
      userId: "alice",
      serviceId: "github",
      redirectUri: "https://app.example.com/api/auth/github/callback",
      scopes: ["read:user"],
      createdAt: Date.now(),
    };
    await store.setState("state-1", state);
    assertEquals(await store.consumeState("state-1"), state);
    assertEquals(await store.consumeState("state-1"), null);

    await store.revokeToken("alice", "github");
    assertEquals(await store.getTokens("github", "alice"), null);
  });

  it("rejects stores that cannot provide safe refresh concurrency", () => {
    const incompleteStore = new MemoryTokenStore("incomplete") as unknown as Record<
      string,
      unknown
    >;
    incompleteStore.withTokenRefreshLock = undefined;

    assertThrows(
      () => createTokenStore(incompleteStore as never),
      TypeError,
      "withTokenRefreshLock",
    );
  });

  it("fails closed lazily when production storage is not configured", () => {
    Deno.env.set("NODE_ENV", "production");

    assertThrows(
      () => createDefaultTokenStore(),
      Error,
      "OAuth token storage is not configured for production",
    );
  });

  it("rejects an explicitly configured memory store in production", () => {
    Deno.env.set("NODE_ENV", "production");

    assertThrows(
      () => configureTokenStore(new MemoryTokenStore("production-memory")),
      Error,
      "MemoryTokenStore is not allowed for production OAuth storage",
    );
  });

  it("uses a refresh-capable memory store only in development", async () => {
    Deno.env.set("NODE_ENV", "development");
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      const store = createDefaultTokenStore();
      await store.setTokens("github", "alice", { accessToken: "development-token" });
      const snapshot = await store.getTokenSnapshot("github", "alice");
      assertEquals(snapshot?.tokens.accessToken, "development-token");
      assertEquals(typeof snapshot?.revision, "string");
    } finally {
      console.warn = originalWarn;
    }
  });

  it("propagates refresh-lock failures from the configured backend", async () => {
    const store = createTokenStore(new MemoryTokenStore("lock-failure"));

    await assertRejects(
      () =>
        store.withTokenRefreshLock(
          "github",
          "alice",
          () => Promise.reject(new Error("backend lock failed")),
        ),
      Error,
      "backend lock failed",
    );
  });
});
