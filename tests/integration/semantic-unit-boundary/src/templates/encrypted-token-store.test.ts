import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat.ts";

import {
  createEncryptedTokenStore,
  generateEncryptionKey,
} from "../../../../../templates/integrations/_base/files/lib/encrypted-token-store.ts";

/**
 * The generated encrypted store intentionally reads TOKEN_ENCRYPTION_KEY from
 * the host environment at its construction boundary. That process effect keeps
 * this regression in the semantic boundary suite instead of templates/index.
 */

const ENCRYPTION_KEY_ENV = "TOKEN_ENCRYPTION_KEY";

describe("generated encrypted OAuth token store", () => {
  it("preserves OAuth scope provenance through state and token rows", async () => {
    const originalKey = getEnv(ENCRYPTION_KEY_ENV);
    const entries = new Map<string, string>();
    const backend = {
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
        if ((entries.get(key) ?? null) !== expected) return Promise.resolve(false);
        if (next === null) entries.delete(key);
        else entries.set(key, next);
        return Promise.resolve(true);
      },
      withLock: <T>(_key: string, operation: () => Promise<T>) => operation(),
    };

    try {
      setEnv(ENCRYPTION_KEY_ENV, generateEncryptionKey());
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
    } finally {
      if (originalKey === undefined) deleteEnv(ENCRYPTION_KEY_ENV);
      else setEnv(ENCRYPTION_KEY_ENV, originalKey);
    }
  });
});
