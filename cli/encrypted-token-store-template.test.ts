import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertNotEquals,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import type { StoredOAuthState } from "veryfront/oauth";
import {
  createEncryptedTokenStore,
  type EncryptedKvBackend,
  generateEncryptionKey,
} from "./templates/integrations/_base/files/lib/encrypted-token-store.ts";
import { createMemoryKvBackend } from "./templates/integrations/_base/files/lib/token-store-examples.ts";
import { createTokenStore } from "./templates/integrations/_base/files/lib/token-store.ts";

const ENVELOPE_PREFIX = "vf-aes-gcm.v1:";

function oauthState(userId: string): StoredOAuthState {
  return {
    userId,
    serviceId: "github",
    redirectUri: "https://app.example.com/api/auth/github/callback",
    scopes: ["read:user"],
    createdAt: Date.now(),
  };
}

/** Expose the raw rows so tests can assert what actually hits storage. */
function inspectableBackend(): EncryptedKvBackend & { rows: Map<string, string> } {
  const backend = createMemoryKvBackend();
  const rows = new Map<string, string>();
  return {
    rows,
    async get(key) {
      return await backend.get(key);
    },
    async set(key, value, options) {
      rows.set(key, value);
      await backend.set(key, value, options);
    },
    async delete(key) {
      rows.delete(key);
      await backend.delete(key);
    },
    async compareAndSwap(key, expected, next, options) {
      const swapped = await backend.compareAndSwap(key, expected, next, options);
      if (swapped) {
        if (next === null) rows.delete(key);
        else rows.set(key, next);
      }
      return swapped;
    },
    withLock(key, operation) {
      return backend.withLock(key, operation);
    },
  };
}

describe("generated encrypted OAuth token store", () => {
  const originalKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  const originalNodeEnv = Deno.env.get("NODE_ENV");

  beforeEach(() => {
    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    Deno.env.set("NODE_ENV", "development");
  });

  afterEach(() => {
    if (originalKey === undefined) Deno.env.delete("TOKEN_ENCRYPTION_KEY");
    else Deno.env.set("TOKEN_ENCRYPTION_KEY", originalKey);
    if (originalNodeEnv === undefined) Deno.env.delete("NODE_ENV");
    else Deno.env.set("NODE_ENV", originalNodeEnv);
  });

  it("fails closed when TOKEN_ENCRYPTION_KEY is not configured", () => {
    Deno.env.delete("TOKEN_ENCRYPTION_KEY");

    assertThrows(
      () => createEncryptedTokenStore(createMemoryKvBackend()),
      Error,
      "TOKEN_ENCRYPTION_KEY is not set",
    );
  });

  it("rejects malformed encryption keys instead of downgrading", () => {
    for (const bad of ["", "not-hex", "abcd", "zz".repeat(32)]) {
      Deno.env.set("TOKEN_ENCRYPTION_KEY", bad);
      assertThrows(
        () => createEncryptedTokenStore(createMemoryKvBackend()),
        Error,
        "TOKEN_ENCRYPTION_KEY",
      );
    }
  });

  it("rejects backends that cannot provide atomic operations", () => {
    const incomplete = createMemoryKvBackend() as unknown as Record<string, unknown>;
    incomplete.compareAndSwap = undefined;

    assertThrows(
      () => createEncryptedTokenStore(incomplete as never),
      TypeError,
      "compareAndSwap",
    );
  });

  it("never writes token plaintext to the backend", async () => {
    const backend = inspectableBackend();
    const store = createEncryptedTokenStore(backend);
    const tokens = { accessToken: "super-secret-access", refreshToken: "super-secret-refresh" };

    await store.setTokens("github", "alice", tokens);

    assertEquals(backend.rows.size, 1);
    for (const stored of backend.rows.values()) {
      assertEquals(stored.startsWith(ENVELOPE_PREFIX), true);
      assertEquals(stored.includes("super-secret-access"), false);
      assertEquals(stored.includes("super-secret-refresh"), false);
    }
    assertEquals(await store.getTokens("github", "alice"), tokens);
  });

  it("uses a fresh IV for every encryption", async () => {
    const backend = inspectableBackend();
    const store = createEncryptedTokenStore(backend);
    const tokens = { accessToken: "same-token" };

    await store.setTokens("github", "alice", tokens);
    const first = [...backend.rows.values()][0];
    await store.setTokens("github", "alice", tokens);
    const second = [...backend.rows.values()][0];

    assertNotEquals(first, second);
  });

  it("refuses plaintext rows found in the backend", async () => {
    const backend = createMemoryKvBackend();
    const store = createEncryptedTokenStore(backend);
    await backend.set(
      'veryfront:oauth:v1:tokens:["github","alice"]',
      JSON.stringify({ revision: "r1", tokens: { accessToken: "plaintext" } }),
    );

    await assertRejects(
      () => store.getTokens("github", "alice"),
      Error,
      "never reads plaintext",
    );
  });

  it("rejects tampered ciphertext", async () => {
    const backend = inspectableBackend();
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "secret" });

    const entry = [...backend.rows.entries()][0];
    if (!entry) throw new Error("Expected a stored row");
    const [key, stored] = entry;
    const body = stored.slice(ENVELOPE_PREFIX.length);
    const index = 20;
    const replacement = body[index] === "A" ? "B" : "A";
    await backend.set(
      key,
      ENVELOPE_PREFIX + body.slice(0, index) + replacement + body.slice(index + 1),
    );

    await assertRejects(
      () => store.getTokens("github", "alice"),
      Error,
      "failed authentication",
    );
  });

  it("binds ciphertext to its storage slot", async () => {
    const backend = inspectableBackend();
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "alices-token" });

    const stored = [...backend.rows.values()][0];
    if (!stored) throw new Error("Expected a stored row");
    await backend.set('veryfront:oauth:v1:tokens:["github","mallory"]', stored);

    await assertRejects(
      () => store.getTokens("github", "mallory"),
      Error,
      "failed authentication",
    );
  });

  it("cannot read values written under a different key", async () => {
    const backend = createMemoryKvBackend();
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "secret" });

    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    const rotated = createEncryptedTokenStore(backend);

    await assertRejects(
      () => rotated.getTokens("github", "alice"),
      Error,
      "failed authentication",
    );
  });

  it("supports revisioned compare-and-set for token refresh", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    await store.setTokens("github", "alice", { accessToken: "access-1" });

    const snapshot = await store.getTokenSnapshot("github", "alice");
    if (!snapshot) throw new Error("Expected a revisioned token snapshot");

    assertEquals(
      await store.compareAndSetTokens("github", "alice", "stale-revision", {
        accessToken: "loser",
      }),
      false,
    );
    assertEquals(
      await store.compareAndSetTokens("github", "alice", snapshot.revision, {
        accessToken: "access-2",
      }),
      true,
    );
    assertEquals((await store.getTokens("github", "alice"))?.accessToken, "access-2");
    // The consumed revision can no longer win a second swap.
    assertEquals(
      await store.compareAndSetTokens("github", "alice", snapshot.revision, {
        accessToken: "replayed",
      }),
      false,
    );
  });

  it("serializes refresh operations through the backend lock", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const order: string[] = [];

    await Promise.all([
      store.withTokenRefreshLock("github", "alice", async () => {
        order.push("first-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("first-end");
      }),
      store.withTokenRefreshLock("github", "alice", async () => {
        order.push("second-start");
      }),
    ]);

    assertEquals(order, ["first-start", "first-end", "second-start"]);
  });

  it("stores OAuth state one-shot and rejects duplicates", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const state = oauthState("alice");

    await store.setState("state-1", state);
    await assertRejects(() => store.setState("state-1", state), Error, "already exists");

    assertEquals(await store.consumeState("state-1"), state);
    assertEquals(await store.consumeState("state-1"), null);
    assertEquals(await store.consumeState("never-set"), null);
  });

  it("rejects state rows outside the acceptance window", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const expired = { ...oauthState("alice"), createdAt: Date.now() - 12 * 60_000 };

    // Insertion refuses rows that are already outside the window.
    await assertRejects(() => store.setState("late", expired), RangeError, "acceptance window");
  });

  it("drops expired state rows even when the backend ignores TTL hints", async () => {
    // A backend that never expires rows, so only the store's own freshness
    // check stands between an old state and a replayed callback.
    const rows = new Map<string, string>();
    const backend: EncryptedKvBackend = {
      get: (key) => Promise.resolve(rows.get(key) ?? null),
      set: (key, value) => {
        rows.set(key, value);
        return Promise.resolve();
      },
      delete: (key) => {
        rows.delete(key);
        return Promise.resolve();
      },
      compareAndSwap: (key, expected, next) => {
        if ((rows.get(key) ?? null) !== expected) return Promise.resolve(false);
        if (next === null) rows.delete(key);
        else rows.set(key, next);
        return Promise.resolve(true);
      },
      withLock: (_key, operation) => operation(),
    };

    using time = new FakeTime();
    const store = createEncryptedTokenStore(backend);
    await store.setState("old", oauthState("alice"));

    // Past the 10-minute window (plus skew) the CSRF token is no longer
    // redeemable, and the atomic consume means a retry cannot resurrect it.
    time.tick(12 * 60_000);
    assertEquals(await store.consumeState("old"), null);
    assertEquals(await store.consumeState("old"), null);
  });

  it("clears tokens on revocation", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    await store.setTokens("github", "alice", { accessToken: "secret" });
    await store.clearTokens("github", "alice");
    assertEquals(await store.getTokens("github", "alice"), null);
  });

  it("plugs into the generated token-store adapter", async () => {
    const adapter = createTokenStore(createEncryptedTokenStore(createMemoryKvBackend()));
    const tokens = { accessToken: "adapted", expiresAt: Date.now() + 60_000 };

    await adapter.setToken("alice", "github", tokens);
    assertEquals(await adapter.getToken("alice", "github"), tokens);
    assertEquals(await adapter.isConnected("alice", "github"), true);
    await adapter.revokeToken("alice", "github");
    assertEquals(await adapter.getToken("alice", "github"), null);
  });

  it("refuses the in-memory example backend in production", () => {
    Deno.env.set("NODE_ENV", "production");

    assertThrows(
      () => createMemoryKvBackend(),
      Error,
      "not allowed in production",
    );
  });
});
