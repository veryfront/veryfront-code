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
  checkEncryptedTokenStoreRotation,
  createEncryptedTokenStore,
  type EncryptedKvBackend,
  generateEncryptionKey,
} from "../templates/integrations/_base/files/lib/encrypted-token-store.ts";
import { createMemoryKvBackend } from "../templates/integrations/_base/files/lib/token-store-examples.ts";
import { createTokenStore } from "../templates/integrations/_base/files/lib/token-store.ts";

const ENVELOPE_PREFIX = "vf-aes-gcm.v2:";
const LEGACY_ENVELOPE_PREFIX = "vf-aes-gcm.v1:";

function oauthState(userId: string): StoredOAuthState {
  return {
    userId,
    serviceId: "github",
    redirectUri: "https://app.example.com/api/auth/github/callback",
    scopes: ["read:user"],
    createdAt: Date.now(),
  };
}

/** Split an envelope into its header (prefix + key id) and base64 body. */
function splitEnvelope(stored: string): { header: string; body: string } {
  const separator = stored.lastIndexOf(":");
  return { header: stored.slice(0, separator + 1), body: stored.slice(separator + 1) };
}

function envelopeIv(stored: string): number[] {
  const bytes = Uint8Array.from(
    atob(splitEnvelope(stored).body),
    (character) => character.charCodeAt(0),
  );
  return [...bytes.subarray(0, 12)];
}

function captureWarnings(): { warnings: string[]; [Symbol.dispose](): void } {
  const original = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  return {
    warnings,
    [Symbol.dispose]() {
      console.warn = original;
    },
  };
}

/** Seal plaintext in the legacy v1 envelope (no key id) for compatibility tests. */
async function sealLegacyV1Plaintext(
  keyHex: string,
  storageKey: string,
  plaintext: string,
): Promise<string> {
  const keyBytes = new Uint8Array(32);
  for (let index = 0; index < keyBytes.length; index++) {
    keyBytes[index] = Number.parseInt(keyHex.slice(index * 2, index * 2 + 2), 16);
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(storageKey) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv);
  combined.set(ciphertext, iv.byteLength);
  let binary = "";
  for (const byte of combined) binary += String.fromCharCode(byte);
  return LEGACY_ENVELOPE_PREFIX + btoa(binary);
}

/** Seal a JSON value in the legacy v1 envelope for compatibility tests. */
async function sealLegacyV1(
  keyHex: string,
  storageKey: string,
  value: unknown,
): Promise<string> {
  const plaintext = JSON.stringify(value);
  if (plaintext === undefined) throw new TypeError("Legacy test value must be JSON serializable");
  return await sealLegacyV1Plaintext(keyHex, storageKey, plaintext);
}

/** Seal a JSON value in the current v2 envelope for boundary tests. */
async function sealV2(keyHex: string, storageKey: string, value: unknown): Promise<string> {
  const keyBytes = new Uint8Array(32);
  for (let index = 0; index < keyBytes.length; index++) {
    keyBytes[index] = Number.parseInt(keyHex.slice(index * 2, index * 2 + 2), 16);
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", keyBytes));
  const keyId = Array.from(digest.subarray(0, 8))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["encrypt"]);
  keyBytes.fill(0);
  const plaintext = JSON.stringify(value);
  if (plaintext === undefined) throw new TypeError("V2 test value must be JSON serializable");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(storageKey) },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv);
  combined.set(ciphertext, iv.byteLength);
  let binary = "";
  for (const byte of combined) binary += String.fromCharCode(byte);
  return ENVELOPE_PREFIX + keyId + ":" + btoa(binary);
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

/** Model a durable backend that transports keys as UTF-8 bytes. */
function utf8KeyBackend(): EncryptedKvBackend & { rows: Map<string, string> } {
  const rows = new Map<string, string>();
  const wireKey = (key: string) => new TextDecoder().decode(new TextEncoder().encode(key));
  return {
    rows,
    get(key) {
      return Promise.resolve(rows.get(wireKey(key)) ?? null);
    },
    set(key, value) {
      rows.set(wireKey(key), value);
      return Promise.resolve();
    },
    delete(key) {
      rows.delete(wireKey(key));
      return Promise.resolve();
    },
    compareAndSwap(key, expected, next) {
      const normalized = wireKey(key);
      if ((rows.get(normalized) ?? null) !== expected) return Promise.resolve(false);
      if (next === null) rows.delete(normalized);
      else rows.set(normalized, next);
      return Promise.resolve(true);
    },
    withLock(_key, operation) {
      return operation();
    },
  };
}

function scanCapableBackend(): ReturnType<typeof inspectableBackend> & {
  scan(prefix: string): AsyncIterable<{ key: string; value: string }>;
} {
  const backend = inspectableBackend();
  return {
    ...backend,
    async *scan(prefix: string) {
      for (const [key, value] of backend.rows) {
        if (key.startsWith(prefix)) yield { key, value };
      }
    },
  };
}

describe("generated encrypted OAuth token store", () => {
  const originalKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  const originalPreviousKey = Deno.env.get("TOKEN_ENCRYPTION_KEY_PREVIOUS");
  const originalNodeEnv = Deno.env.get("NODE_ENV");

  beforeEach(() => {
    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    Deno.env.delete("TOKEN_ENCRYPTION_KEY_PREVIOUS");
    Deno.env.set("NODE_ENV", "development");
  });

  afterEach(() => {
    if (originalKey === undefined) Deno.env.delete("TOKEN_ENCRYPTION_KEY");
    else Deno.env.set("TOKEN_ENCRYPTION_KEY", originalKey);
    if (originalPreviousKey === undefined) Deno.env.delete("TOKEN_ENCRYPTION_KEY_PREVIOUS");
    else Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", originalPreviousKey);
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

  it("treats denied Deno key access as an unset encryption key", () => {
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

    const backend: EncryptedKvBackend = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      compareAndSwap: () => Promise.resolve(false),
      withLock: (_key, operation) => operation(),
    };

    try {
      assertThrows(
        () => createEncryptedTokenStore(backend),
        Error,
        "TOKEN_ENCRYPTION_KEY is not set",
      );
    } finally {
      if (processDescriptor) Object.defineProperty(globalThis, "process", processDescriptor);
      else Reflect.deleteProperty(globalThis, "process");
      if (denoDescriptor) Object.defineProperty(globalThis, "Deno", denoDescriptor);
      else Reflect.deleteProperty(globalThis, "Deno");
    }
  });

  it("treats denied process key access as an unset encryption key", () => {
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

    const backend: EncryptedKvBackend = {
      get: () => Promise.resolve(null),
      set: () => Promise.resolve(),
      delete: () => Promise.resolve(),
      compareAndSwap: () => Promise.resolve(false),
      withLock: (_key, operation) => operation(),
    };

    try {
      assertThrows(
        () => createEncryptedTokenStore(backend),
        Error,
        "TOKEN_ENCRYPTION_KEY is not set",
      );
    } finally {
      if (processDescriptor) Object.defineProperty(globalThis, "process", processDescriptor);
      else Reflect.deleteProperty(globalThis, "process");
    }
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

  it("rejects a malformed TOKEN_ENCRYPTION_KEY_PREVIOUS instead of ignoring it", () => {
    Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", "not-hex");

    assertThrows(
      () => createEncryptedTokenStore(createMemoryKvBackend()),
      TypeError,
      "TOKEN_ENCRYPTION_KEY_PREVIOUS",
    );
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
      // The v2 envelope records which key sealed the row.
      assertEquals(
        /^[0-9a-f]{16}:/.test(stored.slice(ENVELOPE_PREFIX.length)),
        true,
      );
      assertEquals(stored.includes("super-secret-access"), false);
      assertEquals(stored.includes("super-secret-refresh"), false);
    }
    assertEquals(await store.getTokens("github", "alice"), tokens);
  });

  it("rejects token rows that require invoking getters", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const tokens = {};
    Object.defineProperty(tokens, "accessToken", {
      enumerable: true,
      get() {
        throw new Error("getter must not run");
      },
    });

    await assertRejects(
      () => store.setTokens("github", "alice", tokens as never),
      TypeError,
      "accessToken",
    );
  });

  it("rejects malformed optional token string fields", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());

    await assertRejects(
      () =>
        store.setTokens("github", "alice", {
          accessToken: "access-token",
          refreshToken: 42,
        } as never),
      TypeError,
      "refreshToken",
    );
    await assertRejects(
      () =>
        store.setTokens("github", "alice", {
          accessToken: "access-token",
          scope: "read\nwrite",
        }),
      TypeError,
      "scope",
    );
  });

  it("normalizes surrounding whitespace in provider scope strings", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());

    await store.setTokens("github", "alice", {
      accessToken: "access-token",
      scope: "  read:user user:email  ",
    });

    assertEquals((await store.getTokens("github", "alice"))?.scope, "read:user user:email");
  });

  it("rejects control characters in token storage keys", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());

    await assertRejects(
      () => store.setTokens("git\nhub", "alice", { accessToken: "access-token" }),
      TypeError,
      "serviceId",
    );
    await assertRejects(
      () => store.setTokens("github", "ali\u0000ce", { accessToken: "access-token" }),
      TypeError,
      "userId",
    );
  });

  it("keeps ill-formed Unicode key components distinct across UTF-8 storage", async () => {
    const backend = utf8KeyBackend();
    const store = createEncryptedTokenStore(backend);

    await store.setTokens("github", "\ud800", { accessToken: "lone-surrogate-token" });
    await store.setTokens("github", "\ufffd", { accessToken: "replacement-token" });

    assertEquals(backend.rows.size, 2);
    assertEquals((await store.getTokens("github", "\ud800"))?.accessToken, "lone-surrogate-token");
    assertEquals((await store.getTokens("github", "\ufffd"))?.accessToken, "replacement-token");
  });

  it("stores tokens without invoking inherited JSON serializers", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    let inheritedSerializerCalls = 0;
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value() {
        inheritedSerializerCalls++;
        throw new Error("Object.prototype.toJSON must not run");
      },
    });
    Object.defineProperty(Array.prototype, "toJSON", {
      configurable: true,
      value() {
        inheritedSerializerCalls++;
        throw new Error("Array.prototype.toJSON must not run");
      },
    });

    try {
      await store.setTokens("github", "alice", { accessToken: "access-token" });
    } finally {
      delete (Object.prototype as { toJSON?: unknown }).toJSON;
      delete (Array.prototype as { toJSON?: unknown }).toJSON;
    }

    assertEquals(inheritedSerializerCalls, 0);
    assertEquals((await store.getTokens("github", "alice"))?.accessToken, "access-token");
  });

  it("stores detached token snapshots", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const tokens = { accessToken: "original", refreshToken: "refresh" };

    await store.setTokens("github", "alice", tokens);
    tokens.accessToken = "mutated";

    const stored = await store.getTokens("github", "alice");
    assertEquals(stored, { accessToken: "original", refreshToken: "refresh" });
    if (!stored) throw new Error("Expected stored tokens");
    stored.accessToken = "caller-mutated";
    assertEquals(await store.getTokens("github", "alice"), {
      accessToken: "original",
      refreshToken: "refresh",
    });
  });

  it("uses a fresh IV for every encryption", async () => {
    const backend = inspectableBackend();
    const store = createEncryptedTokenStore(backend);
    const tokens = { accessToken: "same-token" };

    await store.setTokens("github", "alice", tokens);
    const first = [...backend.rows.values()][0];
    await store.setTokens("github", "alice", tokens);
    const second = [...backend.rows.values()][0];
    if (!first || !second) throw new Error("Expected encrypted token rows");

    assertNotEquals(envelopeIv(first), envelopeIv(second));
  });

  it("treats plaintext rows found in the backend as absent without reading them", async () => {
    const backend = createMemoryKvBackend();
    const store = createEncryptedTokenStore(backend);
    await backend.set(
      'veryfront:oauth:v1:tokens:["github","alice"]',
      JSON.stringify({ revision: "r1", tokens: { accessToken: "legacy-raw-secret" } }),
    );

    using captured = captureWarnings();
    assertEquals(await store.getTokens("github", "alice"), null);
    assertEquals(captured.warnings.length, 1);
    assertEquals(captured.warnings[0]?.includes("unreadable OAuth token row"), true);
    // The warning must never surface token material.
    assertEquals(captured.warnings[0]?.includes("legacy-raw-secret"), false);
    assertEquals(captured.warnings[0]?.includes("alice"), false);
  });

  it("does not log decrypted plaintext when authenticated payload JSON is malformed", async () => {
    const backend = createMemoryKvBackend();
    const keyHex = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!keyHex) throw new Error("Expected a configured encryption key");
    const storageKey = 'veryfront:oauth:v1:tokens:["github","alice"]';
    const secret = "SENSITIVE_OAUTH_TOKEN_MUST_NOT_BE_LOGGED";
    await backend.set(
      storageKey,
      await sealLegacyV1Plaintext(keyHex, storageKey, secret),
    );
    const store = createEncryptedTokenStore(backend);

    using captured = captureWarnings();
    assertEquals(await store.getTokens("github", "alice"), null);
    assertEquals(captured.warnings.length, 1);
    assertEquals(captured.warnings[0]?.includes("malformed encrypted row"), true);
    assertEquals(captured.warnings[0]?.includes(secret), false);
    assertEquals(captured.warnings[0]?.includes(secret.slice(0, 10)), false);
    assertEquals(captured.warnings[0]?.includes("alice"), false);
  });

  it("treats tampered ciphertext as absent instead of failing the read", async () => {
    const backend = inspectableBackend();
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "secret" });

    const entry = [...backend.rows.entries()][0];
    if (!entry) throw new Error("Expected a stored row");
    const [key, stored] = entry;
    const { header, body } = splitEnvelope(stored);
    const index = 20;
    const replacement = body[index] === "A" ? "B" : "A";
    await backend.set(
      key,
      header + body.slice(0, index) + replacement + body.slice(index + 1),
    );

    using captured = captureWarnings();
    assertEquals(await store.getTokens("github", "alice"), null);
    assertEquals(captured.warnings.length, 1);
    assertEquals(captured.warnings[0]?.includes("failed authentication"), true);
  });

  it("binds ciphertext to its storage slot", async () => {
    const backend = inspectableBackend();
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "alices-token" });

    const stored = [...backend.rows.values()][0];
    if (!stored) throw new Error("Expected a stored row");
    await backend.set('veryfront:oauth:v1:tokens:["github","mallory"]', stored);

    using captured = captureWarnings();
    assertEquals(await store.getTokens("github", "mallory"), null);
    assertEquals(captured.warnings.length, 1);
    assertEquals(await store.getTokens("github", "alice"), { accessToken: "alices-token" });
  });

  it("treats values written under an unknown key as absent and recovers on reconnect", async () => {
    const backend = createMemoryKvBackend();
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "secret" });
    const snapshot = await store.getTokenSnapshot("github", "alice");
    if (!snapshot) throw new Error("Expected a revisioned token snapshot");

    // Rotation without TOKEN_ENCRYPTION_KEY_PREVIOUS: rows sealed with the
    // retired key are unreadable, so they degrade to "disconnected" rather
    // than failing every read.
    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    const rotated = createEncryptedTokenStore(backend);

    using captured = captureWarnings();
    assertEquals(await rotated.getTokens("github", "alice"), null);
    assertEquals(captured.warnings.length, 1);
    assertEquals(captured.warnings[0]?.includes("unknown encryption key"), true);
    assertEquals(
      await rotated.compareAndSetTokens("github", "alice", snapshot.revision, {
        accessToken: "stale-refresh",
      }),
      false,
    );

    // The documented recovery: reconnecting overwrites the unreadable row.
    await rotated.setTokens("github", "alice", { accessToken: "reconnected" });
    assertEquals(await rotated.getTokens("github", "alice"), { accessToken: "reconnected" });
  });

  it("decrypts rows sealed with the previous key during rotation", async () => {
    const backend = createMemoryKvBackend();
    const retiringKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!retiringKey) throw new Error("Expected a configured encryption key");
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "sealed-with-old-key" });

    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", retiringKey);
    const rotated = createEncryptedTokenStore(backend);

    assertEquals(await rotated.getTokens("github", "alice"), {
      accessToken: "sealed-with-old-key",
    });

    // Writing re-seals the row with the current key, so the previous key can
    // be dropped afterwards.
    await rotated.setTokens("github", "alice", { accessToken: "resealed" });
    Deno.env.delete("TOKEN_ENCRYPTION_KEY_PREVIOUS");
    const afterRotation = createEncryptedTokenStore(backend);
    assertEquals(await afterRotation.getTokens("github", "alice"), {
      accessToken: "resealed",
    });
  });

  it("reports idle rows that still require the previous key during rotation", async () => {
    const backend = scanCapableBackend();
    const retiringKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!retiringKey) throw new Error("Expected a configured encryption key");
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "sealed-with-old-key" });

    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", retiringKey);
    const rotated = createEncryptedTokenStore(backend);

    // The row has not been read or written under the new keyring yet, which
    // is exactly what the scan is for.
    assertEquals(await checkEncryptedTokenStoreRotation(backend), {
      scannedRows: 1,
      currentKeyRows: 0,
      previousKeyRows: 1,
      unreadableRows: 0,
      complete: false,
    });

    // A single read re-seals the row with the current key, so the report
    // converges without an explicit write.
    assertEquals(await rotated.getTokens("github", "alice"), {
      accessToken: "sealed-with-old-key",
    });
    assertEquals(await checkEncryptedTokenStoreRotation(backend), {
      scannedRows: 1,
      currentKeyRows: 1,
      previousKeyRows: 0,
      unreadableRows: 0,
      complete: true,
    });
  });

  it("reports authenticated rows with invalid payload schemas as unreadable", async () => {
    const backend = scanCapableBackend();
    const keyHex = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!keyHex) throw new Error("Expected a configured encryption key");
    const tokenKey = 'veryfront:oauth:v1:tokens:["github","malformed-token-user"]';
    const stateKey = 'veryfront:oauth:v1:state:["malformed-state"]';
    await backend.set(tokenKey, await sealV2(keyHex, tokenKey, {}));
    await backend.set(stateKey, await sealV2(keyHex, stateKey, {}));

    assertEquals(await checkEncryptedTokenStoreRotation(backend), {
      scannedRows: 2,
      currentKeyRows: 0,
      previousKeyRows: 0,
      unreadableRows: 2,
      complete: false,
    });
  });

  it("ignores expired OAuth state rows during rotation scans", async () => {
    const backend = scanCapableBackend();
    const retiringKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!retiringKey) throw new Error("Expected a configured encryption key");
    const stateKey = 'veryfront:oauth:v1:state:["expired-state"]';
    await backend.set(
      stateKey,
      await sealV2(retiringKey, stateKey, {
        ...oauthState("alice"),
        createdAt: Date.now() - 12 * 60_000,
      }),
    );

    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", retiringKey);

    assertEquals(await checkEncryptedTokenStoreRotation(backend), {
      scannedRows: 1,
      currentKeyRows: 0,
      previousKeyRows: 0,
      unreadableRows: 0,
      complete: true,
    });
  });

  it("keeps reading legacy v1 envelopes with any configured key", async () => {
    const backend = createMemoryKvBackend();
    const legacyKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!legacyKey) throw new Error("Expected a configured encryption key");
    const storageKey = 'veryfront:oauth:v1:tokens:["github","alice"]';
    await backend.set(
      storageKey,
      await sealLegacyV1(legacyKey, storageKey, {
        revision: "legacy-revision",
        tokens: { accessToken: "legacy-token" },
      }),
    );

    // Read with the sealing key as the current key.
    const store = createEncryptedTokenStore(backend);
    assertEquals(await store.getTokens("github", "alice"), { accessToken: "legacy-token" });

    // Read with the sealing key demoted to the previous key.
    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", legacyKey);
    await backend.set(
      storageKey,
      await sealLegacyV1(legacyKey, storageKey, {
        revision: "legacy-revision",
        tokens: { accessToken: "legacy-token" },
      }),
    );
    const rotated = createEncryptedTokenStore(backend);
    assertEquals(await rotated.getTokens("github", "alice"), { accessToken: "legacy-token" });
  });

  it("re-seals rows decrypted with the previous key on read", async () => {
    const backend = inspectableBackend();
    const retiringKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!retiringKey) throw new Error("Expected a configured encryption key");
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "sealed-with-old-key" });
    const snapshot = await store.getTokenSnapshot("github", "alice");
    if (!snapshot) throw new Error("Expected a revisioned token snapshot");
    const sealedWithRetiringKey = [...backend.rows.values()][0];

    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", retiringKey);
    const rotated = createEncryptedTokenStore(backend);
    assertEquals(await rotated.getTokens("github", "alice"), {
      accessToken: "sealed-with-old-key",
    });

    // The read itself re-sealed the row with the current key...
    const resealed = [...backend.rows.values()][0];
    assertNotEquals(resealed, sealedWithRetiringKey);
    assertEquals(resealed?.startsWith(ENVELOPE_PREFIX), true);
    // ...preserving the logical revision: a re-seal is not a token update.
    assertEquals(
      (await rotated.getTokenSnapshot("github", "alice"))?.revision,
      snapshot.revision,
    );

    // The previous key can now be dropped without any explicit write.
    Deno.env.delete("TOKEN_ENCRYPTION_KEY_PREVIOUS");
    const afterRotation = createEncryptedTokenStore(backend);
    assertEquals(await afterRotation.getTokens("github", "alice"), {
      accessToken: "sealed-with-old-key",
    });
  });

  it("upgrades legacy v1 envelopes to v2 on read", async () => {
    const backend = inspectableBackend();
    const keyHex = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!keyHex) throw new Error("Expected a configured encryption key");
    const storageKey = 'veryfront:oauth:v1:tokens:["github","alice"]';
    await backend.set(
      storageKey,
      await sealLegacyV1(keyHex, storageKey, {
        revision: "legacy-revision",
        tokens: { accessToken: "legacy-token" },
      }),
    );
    const store = createEncryptedTokenStore(backend);

    assertEquals(await store.getTokens("github", "alice"), { accessToken: "legacy-token" });

    const upgraded = backend.rows.get(storageKey);
    assertEquals(upgraded?.startsWith(ENVELOPE_PREFIX), true);
    assertEquals(
      (await store.getTokenSnapshot("github", "alice"))?.revision,
      "legacy-revision",
    );
  });

  it("keeps reads working when the best-effort re-seal cannot be persisted", async () => {
    const inner = createMemoryKvBackend();
    const retiringKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!retiringKey) throw new Error("Expected a configured encryption key");
    const backend: EncryptedKvBackend = {
      get: (key) => inner.get(key),
      set: (key, value, options) => inner.set(key, value, options),
      delete: (key) => inner.delete(key),
      compareAndSwap: () => Promise.reject(new Error("backend rejects swaps")),
      withLock: (key, operation) => inner.withLock(key, operation),
    };
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "still-readable" });

    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", retiringKey);
    const rotated = createEncryptedTokenStore(backend);

    using captured = captureWarnings();
    assertEquals(await rotated.getTokens("github", "alice"), { accessToken: "still-readable" });
    assertEquals(captured.warnings.length, 0);
    // The row is unchanged; the next read simply tries the re-seal again.
    assertEquals(await rotated.getTokens("github", "alice"), { accessToken: "still-readable" });
  });

  it("supports compare-and-set through a row re-sealed during its own pre-read", async () => {
    const backend = createMemoryKvBackend();
    const retiringKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!retiringKey) throw new Error("Expected a configured encryption key");
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "access-1" });
    const snapshot = await store.getTokenSnapshot("github", "alice");
    if (!snapshot) throw new Error("Expected a revisioned token snapshot");

    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", retiringKey);
    const rotated = createEncryptedTokenStore(backend);

    // The pre-read re-seals the row, so the swap must target the re-sealed
    // ciphertext rather than the one fetched at the start of the call.
    assertEquals(
      await rotated.compareAndSetTokens("github", "alice", snapshot.revision, {
        accessToken: "access-2",
      }),
      true,
    );
    assertEquals((await rotated.getTokens("github", "alice"))?.accessToken, "access-2");
  });

  it("treats rows with a malformed v2 key id segment as absent", async () => {
    const backend = inspectableBackend();
    const store = createEncryptedTokenStore(backend);
    await store.setTokens("github", "alice", { accessToken: "secret-token" });
    const entry = [...backend.rows.entries()][0];
    if (!entry) throw new Error("Expected a stored row");
    const [key, stored] = entry;
    const body = stored.slice(ENVELOPE_PREFIX.length);

    const malformedRows = [
      // Key ids are lowercase hex by construction, so uppercase is rejected.
      ENVELOPE_PREFIX + "A" + body.slice(1),
      // Missing ":" separator after the key id.
      ENVELOPE_PREFIX + body.slice(0, 16) + "." + body.slice(17),
    ];
    for (const malformed of malformedRows) {
      await backend.set(key, malformed);
      using captured = captureWarnings();
      assertEquals(await store.getTokens("github", "alice"), null);
      assertEquals(captured.warnings.length, 1);
      assertEquals(captured.warnings[0]?.includes("malformed encrypted row"), true);
      assertEquals(captured.warnings[0]?.includes("secret-token"), false);
    }
  });

  it("degrades legacy v1 envelopes that no configured key can decrypt", async () => {
    const backend = createMemoryKvBackend();
    Deno.env.set("TOKEN_ENCRYPTION_KEY_PREVIOUS", generateEncryptionKey());
    const storageKey = 'veryfront:oauth:v1:tokens:["github","alice"]';
    await backend.set(
      storageKey,
      // Sealed with a key that is in neither ring slot.
      await sealLegacyV1(generateEncryptionKey(), storageKey, {
        revision: "r1",
        tokens: { accessToken: "unreachable-secret" },
      }),
    );
    const store = createEncryptedTokenStore(backend);

    using captured = captureWarnings();
    assertEquals(await store.getTokens("github", "alice"), null);
    assertEquals(captured.warnings.length, 1);
    assertEquals(captured.warnings[0]?.includes("failed authentication"), true);
    assertEquals(captured.warnings[0]?.includes("unreachable-secret"), false);
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

  it("rejects unsafe state storage keys", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());

    await assertRejects(
      () => store.setState("state\nheader", oauthState("alice")),
      TypeError,
      "state",
    );
  });

  it("rejects incomplete or malformed OAuth state rows", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());

    await assertRejects(
      () => store.setState("missing-redirect", { ...oauthState("alice"), redirectUri: undefined }),
      TypeError,
      "redirectUri",
    );
    await assertRejects(
      () =>
        store.setState("unsafe-redirect", {
          ...oauthState("alice"),
          redirectUri: "javascript:alert(1)",
        }),
      TypeError,
      "redirectUri",
    );
    await assertRejects(
      () => store.setState("invalid-scopes", { ...oauthState("alice"), scopes: ["read user"] }),
      TypeError,
      "scopes",
    );
    await assertRejects(
      () => store.setState("unsafe-user", oauthState("ali\u0000ce")),
      TypeError,
      "userId",
    );
  });

  it("rejects OAuth state metadata that requires invoking getters", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const metadata = {};
    Object.defineProperty(metadata, "tenantId", {
      enumerable: true,
      get() {
        throw new Error("getter must not run");
      },
    });

    await assertRejects(
      () => store.setState("state-with-metadata", { ...oauthState("alice"), metadata }),
      TypeError,
      "metadata",
    );
  });

  it("rejects sparse OAuth state metadata arrays before allocating a snapshot", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const sparseValues: unknown[] = [];
    sparseValues.length = 0xffff_ffff;

    await assertRejects(
      () =>
        store.setState("state-with-sparse-metadata", {
          ...oauthState("alice"),
          metadata: { values: sparseValues },
        }),
      RangeError,
      "too many JSON values",
    );
  });

  it("rejects oversized metadata strings before JSON serialization", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());

    await assertRejects(
      () =>
        store.setState("state-with-oversized-metadata", {
          ...oauthState("alice"),
          metadata: { value: "x".repeat(65_537) },
        }),
      RangeError,
      "too much JSON string data",
    );
  });

  it("rejects cyclic OAuth state metadata deterministically", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const metadata: Record<string, unknown> = {};
    metadata.self = metadata;

    await assertRejects(
      () =>
        store.setState("state-with-cyclic-metadata", {
          ...oauthState("alice"),
          metadata,
        }),
      TypeError,
      "cyclic JSON data",
    );
  });

  it("rejects excessively nested OAuth state metadata", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const metadata: Record<string, unknown> = {};
    let cursor = metadata;
    for (let depth = 0; depth < 64; depth++) {
      const child: Record<string, unknown> = {};
      cursor.child = child;
      cursor = child;
    }

    await assertRejects(
      () =>
        store.setState("state-with-deep-metadata", {
          ...oauthState("alice"),
          metadata,
        }),
      RangeError,
      "maximum JSON nesting depth",
    );
  });

  it("preserves own metadata keys named __proto__ across runtimes", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const metadata = JSON.parse('{"__proto__":{"tenant":"north"},"ok":true}');
    const legacyDescriptor = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__");
    let legacySetterCalls = 0;
    Object.defineProperty(Object.prototype, "__proto__", {
      configurable: true,
      get() {
        return null;
      },
      set() {
        legacySetterCalls++;
      },
    });

    try {
      await store.setState("state-with-proto-metadata", {
        ...oauthState("alice"),
        metadata,
      });
    } finally {
      if (legacyDescriptor) {
        Object.defineProperty(Object.prototype, "__proto__", legacyDescriptor);
      } else {
        Reflect.deleteProperty(Object.prototype, "__proto__");
      }
    }

    assertEquals(legacySetterCalls, 0);
    const consumed = await store.consumeState("state-with-proto-metadata");
    const storedMetadata = consumed?.metadata;
    if (!storedMetadata) throw new Error("Expected stored OAuth state metadata");
    assertEquals(Object.keys(storedMetadata), ["__proto__", "ok"]);
    assertEquals(Object.getOwnPropertyDescriptor(storedMetadata, "__proto__")?.value, {
      tenant: "north",
    });
    assertEquals(storedMetadata.ok, true);
  });

  it("stores OAuth state without invoking inherited JSON serializers", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const state = oauthState("alice");
    let inheritedSerializerCalls = 0;
    Object.defineProperty(Object.prototype, "toJSON", {
      configurable: true,
      value() {
        inheritedSerializerCalls++;
        throw new Error("Object.prototype.toJSON must not run");
      },
    });
    Object.defineProperty(Array.prototype, "toJSON", {
      configurable: true,
      value() {
        inheritedSerializerCalls++;
        throw new Error("Array.prototype.toJSON must not run");
      },
    });

    try {
      await store.setState("state-without-hooks", state);
    } finally {
      delete (Object.prototype as { toJSON?: unknown }).toJSON;
      delete (Array.prototype as { toJSON?: unknown }).toJSON;
    }

    assertEquals(inheritedSerializerCalls, 0);
    assertEquals(await store.consumeState("state-without-hooks"), state);
  });

  it("warns with a sanitized category for malformed consumed OAuth state rows", async () => {
    const backend = inspectableBackend();
    const keyHex = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!keyHex) throw new Error("Expected a configured encryption key");
    const storageKey = 'veryfront:oauth:v1:state:["malformed-state"]';
    const secret = "SENSITIVE_STATE_PAYLOAD_MUST_NOT_BE_LOGGED";
    await backend.set(
      storageKey,
      await sealLegacyV1Plaintext(keyHex, storageKey, secret),
    );
    const store = createEncryptedTokenStore(backend);

    using captured = captureWarnings();
    assertEquals(await store.consumeState("malformed-state"), null);
    assertEquals(captured.warnings.length, 1);
    assertEquals(captured.warnings[0]?.includes("malformed encrypted state row"), true);
    assertEquals(captured.warnings[0]?.includes(secret), false);
    assertEquals(captured.warnings[0]?.includes("malformed-state"), false);
  });

  it("warns with sanitized categories for tampered or wrong-key consumed OAuth state rows", async () => {
    const backend = inspectableBackend();
    const store = createEncryptedTokenStore(backend);
    await store.setState("corrupted-state", {
      ...oauthState("alice"),
      metadata: { tenantId: "sensitive-tenant" },
    });
    await store.setState("wrong-key-state", oauthState("bob"));

    const corruptedKey = 'veryfront:oauth:v1:state:["corrupted-state"]';
    const stored = backend.rows.get(corruptedKey);
    if (!stored) throw new Error("Expected a stored state row");
    const { header, body } = splitEnvelope(stored);
    const index = 20;
    const replacement = body[index] === "A" ? "B" : "A";
    await backend.set(
      corruptedKey,
      header + body.slice(0, index) + replacement + body.slice(index + 1),
    );

    const wrongKeyStore = createEncryptedTokenStore(backend);
    Deno.env.set("TOKEN_ENCRYPTION_KEY", generateEncryptionKey());
    const rotatedWithoutPrevious = createEncryptedTokenStore(backend);

    using captured = captureWarnings();
    assertEquals(await wrongKeyStore.consumeState("corrupted-state"), null);
    assertEquals(await rotatedWithoutPrevious.consumeState("wrong-key-state"), null);
    assertEquals(await store.consumeState("corrupted-state"), null);
    assertEquals(captured.warnings, [
      "[Encrypted Token Store] Ignoring unreadable OAuth state row " +
      "(failed authentication). The OAuth callback state is rejected.",
      "[Encrypted Token Store] Ignoring unreadable OAuth state row " +
      "(unknown encryption key). The OAuth callback state is rejected.",
    ]);
  });

  it("rejects state rows outside the acceptance window", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const expired = { ...oauthState("alice"), createdAt: Date.now() - 12 * 60_000 };

    // Insertion refuses rows that are already outside the window.
    await assertRejects(() => store.setState("late", expired), RangeError, "acceptance window");
  });

  it("rejects OAuth state older than the TTL without adding clock skew", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const expired = { ...oauthState("alice"), createdAt: Date.now() - 10.5 * 60_000 };

    await assertRejects(
      () => store.setState("past-skew", expired),
      RangeError,
      "acceptance window",
    );
  });

  it("accepts OAuth state created within the allowed future clock skew", async () => {
    const store = createEncryptedTokenStore(createMemoryKvBackend());
    const future = { ...oauthState("alice"), createdAt: Date.now() + 30_000 };

    await store.setState("future-skew", future);

    assertEquals(await store.consumeState("future-skew"), future);
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

  it("refuses the in-memory example backend when runtime mode is unset", () => {
    Deno.env.delete("NODE_ENV");

    assertThrows(
      () => createMemoryKvBackend(),
      Error,
      "explicit development or test",
    );
  });

  it("treats denied Deno runtime mode access as unset for the example backend", () => {
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
        () => createMemoryKvBackend(),
        Error,
        "explicit development or test",
      );
    } finally {
      if (processDescriptor) Object.defineProperty(globalThis, "process", processDescriptor);
      else Reflect.deleteProperty(globalThis, "process");
      if (denoDescriptor) Object.defineProperty(globalThis, "Deno", denoDescriptor);
      else Reflect.deleteProperty(globalThis, "Deno");
    }
  });

  it("treats denied process runtime mode access as unset for the example backend", () => {
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
        () => createMemoryKvBackend(),
        Error,
        "explicit development or test",
      );
    } finally {
      if (processDescriptor) Object.defineProperty(globalThis, "process", processDescriptor);
      else Reflect.deleteProperty(globalThis, "process");
    }
  });

  it("uses Deno runtime mode when process exists without env", () => {
    Deno.env.set("NODE_ENV", "development");
    const processDescriptor = Object.getOwnPropertyDescriptor(globalThis, "process");
    Object.defineProperty(globalThis, "process", {
      configurable: true,
      value: {},
    });

    try {
      assertEquals(typeof createMemoryKvBackend(), "object");
    } finally {
      if (processDescriptor) Object.defineProperty(globalThis, "process", processDescriptor);
      else Reflect.deleteProperty(globalThis, "process");
    }
  });
});
