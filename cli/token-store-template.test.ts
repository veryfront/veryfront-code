import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDefaultTokenStore,
  decryptToken,
  encryptToken,
  generateEncryptionKey,
  type OAuthToken,
} from "./templates/integrations/_base/files/lib/token-store.ts";

function restoreEnvironmentVariable(name: string, value: string | undefined): void {
  if (value === undefined) Deno.env.delete(name);
  else Deno.env.set(name, value);
}

/**
 * Tests that the token store does not leak sensitive data via console output.
 *
 * Verifies:
 * - Encryption is enabled only by an explicit key
 * - Decryption failures do not log raw error objects or token data
 * - Encrypt/decrypt roundtrip still works correctly
 */
describe("token store console output", () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalNodeEnv = Deno.env.get("NODE_ENV");
  const originalDatabaseUrl = Deno.env.get("DATABASE_URL");
  const originalEncryptionKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  let logCalls: unknown[][] = [];
  let errorCalls: unknown[][] = [];

  beforeEach(() => {
    logCalls = [];
    errorCalls = [];
    console.log = (...args: unknown[]) => logCalls.push(args);
    console.error = (...args: unknown[]) => errorCalls.push(args);
    Deno.env.delete("TOKEN_ENCRYPTION_KEY");
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    restoreEnvironmentVariable("NODE_ENV", originalNodeEnv);
    restoreEnvironmentVariable("DATABASE_URL", originalDatabaseUrl);
    restoreEnvironmentVariable("TOKEN_ENCRYPTION_KEY", originalEncryptionKey);
  });

  it("does not auto-generate or log an encryption key", async () => {
    const token: OAuthToken = { accessToken: "test-access-token" };
    const serialized = await encryptToken(token);

    assertEquals(serialized, JSON.stringify(token));
    const logMessages = logCalls.map((args) => args.join(" "));
    for (const msg of logMessages) {
      assertEquals(
        msg.includes("encryption key"),
        false,
        `console.log should not mention encryption key, got: "${msg}"`,
      );
    }
  });

  it("rejects corrupted encrypted data without logging the failure", async () => {
    Deno.env.set("TOKEN_ENCRYPTION_KEY", "ab".repeat(32));
    const encrypted = await encryptToken({ accessToken: "test-access-token" });
    const corrupted = encrypted.split("");
    const ciphertextIndex = "encrypted:".length + 20;
    corrupted[ciphertextIndex] = corrupted[ciphertextIndex] === "A" ? "B" : "A";

    await assertRejects(
      () => decryptToken(corrupted.join("")),
      Error,
      "failed authentication",
    );

    assertEquals(errorCalls, []);
  });

  it("rejects the default memory-backed store in production despite durable-looking env vars", () => {
    Deno.env.set("NODE_ENV", "production");
    Deno.env.set("DATABASE_URL", "postgres://example");

    assertThrows(
      () => createDefaultTokenStore(),
      Error,
      "In-memory credential storage is not allowed in production",
    );
  });
});

describe("token store encrypt/decrypt roundtrip", () => {
  const originalEncryptionKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");

  beforeEach(() => Deno.env.delete("TOKEN_ENCRYPTION_KEY"));
  afterEach(() => {
    restoreEnvironmentVariable("TOKEN_ENCRYPTION_KEY", originalEncryptionKey);
  });

  it("encrypts and decrypts a token correctly", async () => {
    Deno.env.set("TOKEN_ENCRYPTION_KEY", "cd".repeat(32));
    const token: OAuthToken = {
      accessToken: "access-123",
      refreshToken: "refresh-456",
      expiresAt: Date.now() + 3600_000,
      tokenType: "Bearer",
      scope: "read write",
    };

    const encrypted = await encryptToken(token);
    assertEquals(encrypted.startsWith("encrypted:"), true);

    const decrypted = await decryptToken(encrypted);
    assertEquals(decrypted?.accessToken, token.accessToken);
    assertEquals(decrypted?.refreshToken, token.refreshToken);
    assertEquals(decrypted?.tokenType, token.tokenType);
    assertEquals(decrypted?.scope, token.scope);
  });

  it("rejects invalid JSON in unencrypted data", async () => {
    await assertRejects(
      () => decryptToken("not-valid-json{{{"),
      TypeError,
      "Stored credential is not valid JSON",
    );
  });

  it("generates 64-character hex encryption keys", () => {
    const key = generateEncryptionKey();
    assertEquals(key.length, 64);
    assertEquals(/^[0-9a-f]{64}$/.test(key), true);
  });
});
