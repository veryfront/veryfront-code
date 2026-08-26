import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { MemoryTokenStore, type RefreshCapableTokenStore } from "veryfront/oauth";
import {
  configureTokenStore,
  createDefaultTokenStore,
  createTokenStore,
  getRefreshableAccessToken,
} from "../templates/integrations/_base/files/lib/token-store.ts";

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

  it("fails closed on superseded grants when revision-guarded delete is unavailable", async () => {
    const memory = new MemoryTokenStore("legacy-clearless");
    const clearlessStore = {
      getTokens: (serviceId, userId) => memory.getTokens(serviceId, userId),
      getTokenSnapshot: (serviceId, userId) => memory.getTokenSnapshot(serviceId, userId),
      setTokens: (serviceId, userId, tokens) => memory.setTokens(serviceId, userId, tokens),
      compareAndSetTokens: (serviceId, userId, expectedRevision, tokens) =>
        memory.compareAndSetTokens(serviceId, userId, expectedRevision, tokens),
      withTokenRefreshLock: (serviceId, userId, operation) =>
        memory.withTokenRefreshLock(serviceId, userId, operation),
      clearTokens: (serviceId, userId) => memory.clearTokens(serviceId, userId),
      setState: (state, metadata) => memory.setState(state, metadata),
      consumeState: (state) => memory.consumeState(state),
    } satisfies RefreshCapableTokenStore;
    const store = createTokenStore(clearlessStore);
    await store.setTokens("drive", "alice", {
      accessToken: "legacy-drive-token",
      refreshToken: "legacy-refresh",
      scope: "https://www.googleapis.com/auth/drive",
      expiresAt: Date.now() + 60_000,
    });

    const token = await getRefreshableAccessToken(
      store,
      "drive",
      "alice",
      async () => {
        throw new Error("refresh must not be reached");
      },
    );

    assertEquals(await store.isConnected("alice", "drive"), false);
    assertEquals(token, null);
    assertEquals((await memory.getTokens("drive", "alice"))?.accessToken, "legacy-drive-token");
  });

  it("fails closed unless memory storage is explicitly allowed", () => {
    for (const mode of [undefined, "production", "staging", "preview"]) {
      if (mode === undefined) Deno.env.delete("NODE_ENV");
      else Deno.env.set("NODE_ENV", mode);

      assertThrows(
        () => createDefaultTokenStore(),
        Error,
        "NODE_ENV is explicitly development or test",
      );
    }
  });

  it("rejects an explicitly configured memory store outside development and test", () => {
    for (const mode of [undefined, "production", "staging", "preview"]) {
      if (mode === undefined) Deno.env.delete("NODE_ENV");
      else Deno.env.set("NODE_ENV", mode);

      assertThrows(
        () => configureTokenStore(new MemoryTokenStore(`memory-${mode ?? "unset"}`)),
        Error,
        "NODE_ENV is explicitly development or test",
      );
    }
  });

  it("uses a refresh-capable memory store only in development and test", async () => {
    const originalWarn = console.warn;
    console.warn = () => {};

    try {
      for (const mode of ["development", "test"]) {
        Deno.env.set("NODE_ENV", mode);
        const store = createDefaultTokenStore();
        await store.setTokens("github", "alice", { accessToken: `${mode}-token` });
        const snapshot = await store.getTokenSnapshot("github", "alice");
        assertEquals(snapshot?.tokens.accessToken, `${mode}-token`);
        assertEquals(typeof snapshot?.revision, "string");
      }
    } finally {
      console.warn = originalWarn;
    }
  });

  it("uses Deno runtime mode when process exists without env", () => {
    Deno.env.set("NODE_ENV", "development");
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
    const originalWarn = console.warn;
    console.warn = () => {};
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: {},
    });

    try {
      assertEquals(typeof createDefaultTokenStore(), "object");
    } finally {
      console.warn = originalWarn;
      if (processDescriptor) Object.defineProperty(globalThis, "process", processDescriptor);
      else Reflect.deleteProperty(globalThis, "process");
    }
  });

  it("treats denied Deno environment access as an unset runtime mode", () => {
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
    const denoDescriptor = Object.getOwnPropertyDescriptor(globalThis, "Deno");
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis, "Deno", {
      configurable: true,
      value: {
        env: {
          get() {
            throw new Error("PermissionDenied");
          },
        },
      },
    });

    try {
      assertThrows(
        () => createDefaultTokenStore(),
        Error,
        "NODE_ENV is explicitly development or test",
      );
    } finally {
      if (processDescriptor) Object.defineProperty(globalThis, "process", processDescriptor);
      else Reflect.deleteProperty(globalThis, "process");
      if (denoDescriptor) Object.defineProperty(globalThis, "Deno", denoDescriptor);
      else Reflect.deleteProperty(globalThis, "Deno");
    }
  });

  it("treats denied process environment access as an unset runtime mode", () => {
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: {
        env: new Proxy({}, {
          get() {
            throw new Error("PermissionDenied");
          },
        }),
      },
    });

    try {
      assertThrows(
        () => createDefaultTokenStore(),
        Error,
        "NODE_ENV is explicitly development or test",
      );
    } finally {
      if (processDescriptor) Object.defineProperty(globalThis, "process", processDescriptor);
      else Reflect.deleteProperty(globalThis, "process");
    }
  });

  it("serializes concurrent refresh and persists it with compare-and-set", async () => {
    const store = createTokenStore(new MemoryTokenStore("refresh-concurrency"));
    await store.setTokens("github", "alice", {
      accessToken: "expiring",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 1_000,
    });
    let refreshes = 0;
    const refresh = async () => {
      refreshes++;
      await Promise.resolve();
      return {
        accessToken: "refreshed",
        refreshToken: "refresh-2",
        expiresAt: Date.now() + 10 * 60_000,
      };
    };

    const tokens = await Promise.all([
      getRefreshableAccessToken(store, "github", "alice", refresh),
      getRefreshableAccessToken(store, "github", "alice", refresh),
    ]);

    assertEquals(tokens, ["refreshed", "refreshed"]);
    assertEquals(refreshes, 1);
    assertEquals((await store.getTokens("github", "alice"))?.accessToken, "refreshed");
  });

  it("preserves the existing refresh token when a provider omits one", async () => {
    const store = createTokenStore(new MemoryTokenStore("refresh-token-preserve"));
    await store.setTokens("github", "alice", {
      accessToken: "expiring",
      refreshToken: "refresh-1",
      expiresAt: Date.now() + 1_000,
    });

    assertEquals(
      await getRefreshableAccessToken(
        store,
        "github",
        "alice",
        async () => ({
          accessToken: "refreshed",
          expiresAt: Date.now() + 10 * 60_000,
        }),
      ),
      "refreshed",
    );
    assertEquals((await store.getTokens("github", "alice"))?.refreshToken, "refresh-1");
  });

  it("preserves current scope metadata when a provider refresh omits it", async () => {
    const store = createTokenStore(new MemoryTokenStore("refresh-scope-preserve"));
    await store.setTokens("github", "alice", {
      accessToken: "expiring",
      refreshToken: "refresh-1",
      scope: "repo read:user",
      scopeSource: "explicit",
      expiresAt: Date.now() + 1_000,
    });

    assertEquals(
      await getRefreshableAccessToken(
        store,
        "github",
        "alice",
        async () => ({
          accessToken: "refreshed",
          expiresAt: Date.now() + 10 * 60_000,
        }),
      ),
      "refreshed",
    );

    const refreshed = await store.getTokens("github", "alice");
    assertEquals(refreshed?.scope, "repo read:user");
    assertEquals(refreshed?.scopeSource, "explicit");
  });

  it("does not overwrite a concurrent reconnect when refresh loses CAS", async () => {
    const store = createTokenStore(new MemoryTokenStore("refresh-cas"));
    await store.setTokens("github", "alice", {
      accessToken: "expired",
      refreshToken: "refresh-1",
      expiresAt: Date.now() - 1,
    });

    const accessToken = await getRefreshableAccessToken(
      store,
      "github",
      "alice",
      async () => {
        await store.setTokens("github", "alice", {
          accessToken: "reauthorized",
          refreshToken: "refresh-new",
          expiresAt: Date.now() + 60_000,
        });
        return { accessToken: "stale-refresh" };
      },
    );

    assertEquals(accessToken, "reauthorized");
    assertEquals((await store.getTokens("github", "alice"))?.accessToken, "reauthorized");
  });

  it("does not return a superseded latest token after refresh loses CAS", async () => {
    const store = createTokenStore(new MemoryTokenStore("refresh-cas-superseded"));
    await store.setTokens("drive", "alice", {
      accessToken: "expired-readonly",
      refreshToken: "refresh-1",
      scope:
        "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/drive.file",
      expiresAt: Date.now() - 1,
    });

    const accessToken = await getRefreshableAccessToken(
      store,
      "drive",
      "alice",
      async () => {
        await store.setTokens("drive", "alice", {
          accessToken: "legacy-drive-token",
          refreshToken: "legacy-refresh",
          scope: "https://www.googleapis.com/auth/drive",
          expiresAt: Date.now() + 60_000,
        });
        return { accessToken: "stale-refresh", expiresAt: Date.now() + 60_000 };
      },
    );

    assertEquals(accessToken, null);
    assertEquals(await store.getTokens("drive", "alice"), null);
  });

  it("retains the token row when the provider refresh fails", async () => {
    const store = createTokenStore(new MemoryTokenStore("refresh-failure"));
    await store.setTokens("github", "alice", {
      accessToken: "expired",
      refreshToken: "refresh-1",
      expiresAt: Date.now() - 1,
    });

    assertEquals(
      await getRefreshableAccessToken(
        store,
        "github",
        "alice",
        () => Promise.reject(new Error("provider unavailable")),
      ),
      null,
    );
    assertEquals((await store.getTokens("github", "alice"))?.refreshToken, "refresh-1");
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
