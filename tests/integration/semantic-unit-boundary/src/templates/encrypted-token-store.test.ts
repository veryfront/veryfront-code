import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat.ts";

import {
  createEncryptedTokenStore,
  type EncryptedKvBackend,
  generateEncryptionKey,
} from "../../../../../templates/integrations/_base/files/lib/encrypted-token-store.ts";
import {
  createTokenStore,
  getRefreshableAccessToken,
} from "../../../../../templates/integrations/_base/files/lib/token-store.ts";

/**
 * The generated encrypted store intentionally reads TOKEN_ENCRYPTION_KEY from
 * the host environment at its construction boundary. That process effect keeps
 * this regression in the semantic boundary suite instead of templates/index.
 */

const ENCRYPTION_KEY_ENV = "TOKEN_ENCRYPTION_KEY";

interface RecordedCompareAndSwap {
  key: string;
  expected: string | null;
  next: string | null;
}

function createRecordingBackend(): EncryptedKvBackend & {
  readonly swaps: RecordedCompareAndSwap[];
} {
  const entries = new Map<string, string>();
  const swaps: RecordedCompareAndSwap[] = [];
  return {
    swaps,
    get: (key: string) => Promise.resolve(entries.get(key) ?? null),
    set: (key: string, value: string) => {
      entries.set(key, value);
      return Promise.resolve();
    },
    delete: (key: string) => {
      entries.delete(key);
      return Promise.resolve();
    },
    compareAndSwap: (key: string, expected: string | null, next: string | null) => {
      swaps.push({ key, expected, next });
      if ((entries.get(key) ?? null) !== expected) return Promise.resolve(false);
      if (next === null) entries.delete(key);
      else entries.set(key, next);
      return Promise.resolve(true);
    },
    withLock: <T>(_key: string, operation: () => Promise<T>) => operation(),
  };
}

async function withEncryptionKey(operation: () => Promise<void>): Promise<void> {
  const originalKey = getEnv(ENCRYPTION_KEY_ENV);
  try {
    setEnv(ENCRYPTION_KEY_ENV, generateEncryptionKey());
    await operation();
  } finally {
    if (originalKey === undefined) deleteEnv(ENCRYPTION_KEY_ENV);
    else setEnv(ENCRYPTION_KEY_ENV, originalKey);
  }
}

describe("generated encrypted OAuth token store", () => {
  it("preserves OAuth scope provenance through state and token rows", async () => {
    await withEncryptionKey(async () => {
      const backend = createRecordingBackend();
      const store = createEncryptedTokenStore(backend);
      await store.setState("oauth-state", {
        userId: "alice",
        serviceId: "drive",
        redirectUri: "https://app.example/callback",
        scopes: ["https://www.googleapis.com/auth/drive"],
        scopeSource: "explicit",
        createdAt: Date.now(),
      });
      await store.setTokens("drive", "alice", {
        accessToken: "explicit-full-drive-token",
        scope: "https://www.googleapis.com/auth/drive",
        scopeSource: "explicit",
        expiresAt: Date.now() + 60_000,
      });

      assertEquals((await store.consumeState("oauth-state"))?.scopeSource, "explicit");
      assertEquals((await store.getTokens("drive", "alice"))?.scopeSource, "explicit");
    });
  });

  it("can configure the generated token store with encrypted storage", async () => {
    await withEncryptionKey(async () => {
      const backend = createRecordingBackend();
      const tokenStoreModule = await import(
        "../../../../../templates/integrations/_base/files/lib/token-store.ts?encrypted-config-boundary"
      );

      tokenStoreModule.configureTokenStore(createEncryptedTokenStore(backend));
    });
  });

  it("clears encrypted token rows only when the expected revision matches", async () => {
    await withEncryptionKey(async () => {
      const backend = createRecordingBackend();
      const store = createEncryptedTokenStore(backend);
      await store.setTokens("drive", "alice", {
        accessToken: "legacy-drive-token",
        scope: "https://www.googleapis.com/auth/drive",
        expiresAt: Date.now() + 60_000,
      });
      const snapshot = await store.getTokenSnapshot("drive", "alice");
      assertExists(snapshot);

      assertEquals(await store.compareAndClearTokens("drive", "alice", "wrong-revision"), false);
      assertEquals(backend.swaps.length, 0);
      assertExists(await store.getTokens("drive", "alice"));
      assertEquals(await store.compareAndClearTokens("drive", "alice", snapshot.revision), true);
      assertEquals(await store.getTokens("drive", "alice"), null);
      assertEquals(backend.swaps.length, 1);
      const clearSwap = backend.swaps.at(-1);
      assertExists(clearSwap);
      assertEquals(clearSwap.key, 'veryfront:oauth:v1:tokens:["drive","alice"]');
      assertEquals(clearSwap.next, null);
      assertEquals(clearSwap.expected === null, false);
    });
  });

  it("revision-clears superseded broad grants through encrypted generated storage", async () => {
    await withEncryptionKey(async () => {
      const backend = createRecordingBackend();
      const encryptedStore = createEncryptedTokenStore(backend);
      const store = createTokenStore(encryptedStore);
      await encryptedStore.setTokens("drive", "alice", {
        accessToken: "legacy-drive-token",
        refreshToken: "legacy-drive-refresh",
        scope: "https://www.googleapis.com/auth/drive",
        expiresAt: Date.now() + 60_000,
      });
      await encryptedStore.setTokens("outlook", "alice", {
        accessToken: "legacy-outlook-token",
        refreshToken: "legacy-outlook-refresh",
        scope: "Mail.Read Group.Read.All Group-Conversation.Read.All offline_access",
        expiresAt: Date.now() - 1,
      });
      let refreshCalls = 0;

      assertEquals(await store.isConnected("alice", "drive"), false);
      assertEquals(await encryptedStore.getTokens("drive", "alice"), null);
      assertEquals(
        await getRefreshableAccessToken(store, "outlook", "alice", () => {
          refreshCalls++;
          return Promise.resolve({ accessToken: "unexpected" });
        }),
        null,
      );
      assertEquals(refreshCalls, 0);
      assertEquals(await encryptedStore.getTokens("outlook", "alice"), null);
      assertEquals(backend.swaps.filter((swap) => swap.next === null).length, 2);
    });
  });
});
