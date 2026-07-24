import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { OAuthTokens, StoredOAuthState } from "veryfront/oauth";
import {
  type ApplicationOAuthTokenStore,
  getInstalledOAuthTokenStore,
  installOAuthTokenStore,
  type OAuthStorageStatus,
  readOAuthStorageStatus,
} from "./integrations/_base/files/lib/oauth-store-registry.ts";
import {
  ATLASSIAN_OAUTH_TOKEN_SERVICE_ALIASES,
  createOAuthTokenStoreWithServiceAliases,
} from "./integrations/_base/files/lib/oauth-token-service-aliases.ts";
import {
  hasRequiredOAuthScopes,
  satisfiesOAuthScopePolicy,
} from "./integrations/_base/files/lib/oauth-scope-utils.ts";
import {
  installRequestIdentityResolver,
  requireUserIdFromRequest,
} from "./integrations/_base/files/lib/user-id.ts";
import {
  buildTokenStorageKey,
  createTokenStore,
  decryptToken,
  encryptToken,
} from "./integrations/_base/files/lib/token-store.ts";

function createApplicationStore(): ApplicationOAuthTokenStore {
  return {
    getTokens: () => Promise.resolve(null),
    setTokens: () => Promise.resolve(),
    clearTokens: () => Promise.resolve(),
    getTokenSnapshot: () => Promise.resolve(null),
    compareAndSetTokens: () => Promise.resolve(false),
    withTokenRefreshLock: (_serviceId, _userId, operation) => operation(),
    setState: (_state: string, _meta: StoredOAuthState) => Promise.resolve(),
    consumeState: () => Promise.resolve(null),
    getStorageStatus: () => ({
      mode: "custom",
      durable: true,
      encrypted: null,
    }),
  };
}

function createStatefulApplicationStore() {
  let revision = 0;
  let storageStatusReads = 0;
  const tokenRows = new Map<
    string,
    { revision: string; tokens: OAuthTokens }
  >();
  const stateRows = new Map<string, StoredOAuthState>();
  const refreshLocks: Array<{ serviceId: string; userId: string }> = [];
  const tokenKey = (serviceId: string, userId: string) => JSON.stringify([serviceId, userId]);

  const store: ApplicationOAuthTokenStore = {
    getTokens: (serviceId, userId) =>
      Promise.resolve(tokenRows.get(tokenKey(serviceId, userId))?.tokens ?? null),
    setTokens: (serviceId, userId, tokens) => {
      tokenRows.set(tokenKey(serviceId, userId), {
        revision: `revision-${++revision}`,
        tokens,
      });
      return Promise.resolve();
    },
    clearTokens: (serviceId, userId) => {
      tokenRows.delete(tokenKey(serviceId, userId));
      return Promise.resolve();
    },
    getTokenSnapshot: (serviceId, userId) =>
      Promise.resolve(tokenRows.get(tokenKey(serviceId, userId)) ?? null),
    compareAndSetTokens: (
      serviceId,
      userId,
      expectedRevision,
      tokens,
    ) => {
      const key = tokenKey(serviceId, userId);
      const current = tokenRows.get(key);
      if (!current || current.revision !== expectedRevision) {
        return Promise.resolve(false);
      }
      tokenRows.set(key, {
        revision: `revision-${++revision}`,
        tokens,
      });
      return Promise.resolve(true);
    },
    withTokenRefreshLock: (serviceId, userId, operation) => {
      refreshLocks.push({ serviceId, userId });
      return operation();
    },
    setState: (state, meta) => {
      stateRows.set(state, meta);
      return Promise.resolve();
    },
    consumeState: (state) => {
      const meta = stateRows.get(state) ?? null;
      stateRows.delete(state);
      return Promise.resolve(meta);
    },
    getStorageStatus: () => {
      storageStatusReads++;
      return {
        mode: "custom",
        durable: true,
        encrypted: true,
      };
    },
  };

  return {
    refreshLocks,
    stateRows,
    store,
    storageStatusReads: () => storageStatusReads,
    tokenRows,
  };
}

describe("generated OAuth application seams", () => {
  it("ignores spoofed identity headers until a verified resolver is installed", async () => {
    const request = new Request("https://app.example/api/auth/github", {
      headers: {
        "x-user-id": "attacker",
        "x-veryfront-user-id": "attacker",
      },
    });

    await assertRejects(
      () => requireUserIdFromRequest(request),
      Error,
      "Request identity resolver is not configured",
    );

    let verifiedIdentity: string | null = "session-user";
    installRequestIdentityResolver(() => verifiedIdentity);
    assertEquals(await requireUserIdFromRequest(request), "session-user");

    verifiedIdentity = " untrusted ";
    assertEquals(await requireUserIdFromRequest(request), null);
  });

  it("rejects incomplete or conflicting production OAuth stores", () => {
    assertThrows(
      () =>
        installOAuthTokenStore({
          getTokens: () => Promise.resolve<OAuthTokens | null>(null),
        } as unknown as ApplicationOAuthTokenStore),
      TypeError,
      "setTokens",
    );

    const { getStorageStatus: _getStorageStatus, ...storeWithoutStatus } = createApplicationStore();
    assertThrows(
      () =>
        installOAuthTokenStore(
          storeWithoutStatus as unknown as ApplicationOAuthTokenStore,
        ),
      TypeError,
      "getStorageStatus",
    );

    const nonDurableStore = createApplicationStore();
    nonDurableStore.getStorageStatus = () => ({
      mode: "memory",
      durable: false,
      encrypted: false,
    });
    assertThrows(
      () => installOAuthTokenStore(nonDurableStore),
      TypeError,
      "must report durable storage",
    );

    const store = createApplicationStore();
    installOAuthTokenStore(store);
    assertEquals(getInstalledOAuthTokenStore(), store);

    assertThrows(
      () => installOAuthTokenStore(createApplicationStore()),
      Error,
      "already been installed",
    );
  });

  it("validates storage capabilities reported by the adapter", () => {
    const store = createApplicationStore();
    assertEquals(readOAuthStorageStatus(store), {
      mode: "custom",
      durable: true,
      encrypted: null,
    });

    store.getStorageStatus = () => ({
      mode: "unknown",
      durable: true,
      encrypted: true,
    } as unknown as OAuthStorageStatus);
    assertThrows(
      () => readOAuthStorageStatus(store),
      TypeError,
      "storage mode must be one of",
    );
  });
});

describe("generated OAuth token service aliases", () => {
  it("rejects aliases that cannot identify one stable physical slot", () => {
    const backend = createStatefulApplicationStore();

    assertThrows(
      () => createOAuthTokenStoreWithServiceAliases(backend.store, { "": "atlassian" }),
      TypeError,
      "alias keys",
    );
    assertThrows(
      () => createOAuthTokenStoreWithServiceAliases(backend.store, { jira: " atlassian" }),
      TypeError,
      "alias values",
    );
    assertThrows(
      () => createOAuthTokenStoreWithServiceAliases(backend.store, { jira: "jira" }),
      TypeError,
      "different service ID",
    );
    assertThrows(
      () =>
        createOAuthTokenStoreWithServiceAliases(backend.store, {
          confluence: "atlassian",
          jira: "confluence",
        }),
      TypeError,
      "physical service ID",
    );
  });

  it("shares Atlassian tokens across Jira and Confluence without changing users", async () => {
    const backend = createStatefulApplicationStore();
    const store = createOAuthTokenStoreWithServiceAliases(
      backend.store,
      ATLASSIAN_OAUTH_TOKEN_SERVICE_ALIASES,
    );

    await store.setTokens("jira", "alice", { accessToken: "shared-token" });
    await store.setTokens("github", "alice", { accessToken: "github-token" });

    assertEquals(await store.getTokens("confluence", "alice"), {
      accessToken: "shared-token",
    });
    assertEquals(await store.getTokens("jira", "bob"), null);
    assertEquals(
      backend.tokenRows.has(JSON.stringify(["atlassian", "alice"])),
      true,
    );
    assertEquals(
      backend.tokenRows.has(JSON.stringify(["github", "alice"])),
      true,
    );

    await store.clearTokens("confluence", "alice");
    assertEquals(await store.getTokens("jira", "alice"), null);
    assertEquals(await store.getTokens("github", "alice"), {
      accessToken: "github-token",
    });
  });

  it("uses one Atlassian revision and refresh lock slot", async () => {
    const backend = createStatefulApplicationStore();
    const store = createOAuthTokenStoreWithServiceAliases(
      backend.store,
      ATLASSIAN_OAUTH_TOKEN_SERVICE_ALIASES,
    );

    await store.setTokens("jira", "alice", { accessToken: "before-refresh" });
    const snapshot = await store.getTokenSnapshot("confluence", "alice");
    assertEquals(snapshot?.tokens.accessToken, "before-refresh");

    assertEquals(
      await store.compareAndSetTokens(
        "jira",
        "alice",
        snapshot?.revision ?? "",
        { accessToken: "after-refresh" },
      ),
      true,
    );
    assertEquals(
      await store.compareAndSetTokens(
        "confluence",
        "alice",
        snapshot?.revision ?? "",
        { accessToken: "stale-refresh" },
      ),
      false,
    );
    assertEquals(
      await store.withTokenRefreshLock(
        "confluence",
        "bob",
        () => Promise.resolve("locked"),
      ),
      "locked",
    );
    assertEquals(backend.refreshLocks, [
      { serviceId: "atlassian", userId: "bob" },
    ]);
  });

  it("keeps OAuth state logical and delegates storage capabilities", async () => {
    const backend = createStatefulApplicationStore();
    const store = createOAuthTokenStoreWithServiceAliases(
      backend.store,
      ATLASSIAN_OAUTH_TOKEN_SERVICE_ALIASES,
    );
    const state: StoredOAuthState = {
      userId: "alice",
      serviceId: "jira",
      createdAt: 1,
    };

    await store.setState("opaque-state", state);
    assertEquals(backend.stateRows.get("opaque-state"), state);
    assertEquals(await store.consumeState("opaque-state"), state);
    assertEquals(backend.stateRows.has("opaque-state"), false);
    assertEquals(store.getStorageStatus(), {
      mode: "custom",
      durable: true,
      encrypted: true,
    });
    assertEquals(backend.storageStatusReads(), 1);
  });
});

describe("generated OAuth scope validation", () => {
  it("requires every selected scope without accepting malformed scope rows", () => {
    const required = [
      "read:jira-work",
      "write:jira-work",
      "offline_access",
    ] as const;

    assertEquals(
      hasRequiredOAuthScopes(
        "read:jira-work write:jira-work offline_access extra:scope",
        required,
      ),
      true,
    );
    assertEquals(
      hasRequiredOAuthScopes("read:jira-work offline_access", required),
      false,
    );
    assertEquals(
      hasRequiredOAuthScopes(
        "read:jira-work read:jira-work write:jira-work offline_access",
        required,
      ),
      false,
    );
    assertEquals(
      hasRequiredOAuthScopes(
        " read:jira-work write:jira-work offline_access",
        required,
      ),
      false,
    );
    assertEquals(
      hasRequiredOAuthScopes("x".repeat(4_097), required),
      false,
    );
    assertEquals(hasRequiredOAuthScopes(undefined, required), false);
    assertEquals(hasRequiredOAuthScopes(undefined, []), true);
  });

  it("rejects known retired product scopes while allowing provider-added scopes", () => {
    const required = ["read:jira-work", "offline_access"] as const;
    const retired = ["read:confluence-content.all"] as const;

    assertEquals(
      satisfiesOAuthScopePolicy(
        "read:jira-work offline_access provider:implied",
        required,
        retired,
      ),
      true,
    );
    assertEquals(
      satisfiesOAuthScopePolicy(
        "read:jira-work read:confluence-content.all offline_access",
        required,
        retired,
      ),
      false,
    );
    assertEquals(
      satisfiesOAuthScopePolicy(
        "read:jira-work offline_access",
        required,
        ["read:jira-work"],
      ),
      false,
    );
  });
});

describe("legacy generated credential store hardening", () => {
  afterEach(() => Deno.env.delete("TOKEN_ENCRYPTION_KEY"));

  it("uses collision-free tuple keys", async () => {
    const rows = new Map<string, string>();
    const store = createTokenStore({
      get: (key) => Promise.resolve(rows.get(key) ?? null),
      set: (key, value) => {
        rows.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        rows.delete(key);
        return Promise.resolve();
      },
    });

    await store.setToken("alice:github", "service", { accessToken: "first" });
    await store.setToken("alice", "github:service", { accessToken: "second" });
    assertEquals(
      (await store.getToken("alice:github", "service"))?.accessToken,
      "first",
    );
    assertEquals(
      (await store.getToken("alice", "github:service"))?.accessToken,
      "second",
    );
    assertEquals(
      buildTokenStorageKey("alice:github", "service") ===
        buildTokenStorageKey("alice", "github:service"),
      false,
    );
  });

  it("fails closed for malformed keys and plaintext downgrade", async () => {
    Deno.env.set("TOKEN_ENCRYPTION_KEY", "malformed");
    await assertRejects(
      () => encryptToken({ accessToken: "secret" }),
      TypeError,
      "exactly 64 hexadecimal characters",
    );

    Deno.env.set("TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
    await assertRejects(
      () => decryptToken(JSON.stringify({ accessToken: "plaintext" })),
      Error,
      "Refusing plaintext credential",
    );
  });

  it("round-trips a large bounded encrypted token without spread overflow", async () => {
    Deno.env.set("TOKEN_ENCRYPTION_KEY", "cd".repeat(32));
    const token = { accessToken: "x".repeat(120_000), refreshToken: "refresh" };
    const encrypted = await encryptToken(token);
    assertEquals(encrypted.startsWith("encrypted:"), true);
    assertEquals(await decryptToken(encrypted), token);
  });

  it("migrates legacy delimiter keys only when explicitly enabled and unambiguous", async () => {
    const rows = new Map<string, string>([
      ["alice:github", JSON.stringify({ accessToken: "legacy" })],
      ["alice:github:service", JSON.stringify({ accessToken: "ambiguous" })],
    ]);
    const store = createTokenStore({
      get: (key) => Promise.resolve(rows.get(key) ?? null),
      set: (key, value) => {
        rows.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        rows.delete(key);
        return Promise.resolve();
      },
      legacyColonKeyMigration: "read-delete",
    });

    assertEquals(
      (await store.getToken("alice", "github"))?.accessToken,
      "legacy",
    );
    assertEquals(rows.has("alice:github"), false);
    assertEquals(rows.has(buildTokenStorageKey("alice", "github")), true);
    assertEquals(await store.getToken("alice:github", "service"), null);
  });
});
