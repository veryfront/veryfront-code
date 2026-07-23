import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
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

    const { getStorageStatus: _getStorageStatus, ...storeWithoutStatus } =
      createApplicationStore();
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
