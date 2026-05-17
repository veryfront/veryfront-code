import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDefaultTokenStore,
  decryptToken,
  encryptToken,
  generateEncryptionKey,
  type OAuthToken,
} from "./templates/integrations/_base/files/lib/token-store.ts";

const AUTO_KEY_STORAGE = "__veryfront_auto_encryption_key__";
const globalStore = globalThis as Record<string, unknown>;

/**
 * Tests that the token store does not leak sensitive data via console output.
 *
 * Verifies:
 * - Auto-generated encryption keys are not logged
 * - Decryption failures do not include raw error objects or token data
 * - Encrypt/decrypt roundtrip still works correctly
 */
describe("token store console output", () => {
  const originalLog = console.log;
  const originalError = console.error;
  const originalNodeEnv = Deno.env.get("NODE_ENV");
  const originalDatabaseUrl = Deno.env.get("DATABASE_URL");
  let logCalls: unknown[][] = [];
  let errorCalls: unknown[][] = [];

  beforeEach(() => {
    logCalls = [];
    errorCalls = [];
    console.log = (...args: unknown[]) => logCalls.push(args);
    console.error = (...args: unknown[]) => errorCalls.push(args);
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    if (originalNodeEnv === undefined) Deno.env.delete("NODE_ENV");
    else Deno.env.set("NODE_ENV", originalNodeEnv);
    if (originalDatabaseUrl === undefined) Deno.env.delete("DATABASE_URL");
    else Deno.env.set("DATABASE_URL", originalDatabaseUrl);
  });

  it("does not log auto-generated encryption key to console", async () => {
    // Clear cached key to force regeneration code path
    delete globalStore[AUTO_KEY_STORAGE];

    // Trigger encryption which causes auto-key generation
    const token: OAuthToken = { accessToken: "test-access-token" };
    await encryptToken(token);

    // No console.log calls should mention key generation
    const logMessages = logCalls.map((args) => args.join(" "));
    for (const msg of logMessages) {
      assertEquals(
        msg.includes("encryption key"),
        false,
        `console.log should not mention encryption key, got: "${msg}"`,
      );
    }
  });

  it("does not include error object in decryption failure log", async () => {
    // Pass corrupted encrypted data to trigger decryption failure
    const result = await decryptToken("encrypted:aW52YWxpZC1kYXRh");

    assertEquals(result, null);

    // Find the "Decryption failed" error call
    const failureCalls = errorCalls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("Decryption failed"),
    );

    // Should have logged the failure
    assertNotEquals(failureCalls.length, 0, "Should log decryption failure");

    // Should only contain the message string, no error object
    for (const call of failureCalls) {
      assertEquals(
        call.length,
        1,
        `Decryption failure log should only contain message string, got ${call.length} args`,
      );
    }
  });

  it("does not use the default memory-backed store in production when durable env vars are present", () => {
    Deno.env.set("NODE_ENV", "production");
    Deno.env.set("DATABASE_URL", "postgres://example");

    let message = "";
    try {
      createDefaultTokenStore();
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    assertEquals(
      message.includes("In-memory token storage is not allowed in production"),
      true,
    );
  });
});

describe("token store encrypt/decrypt roundtrip", () => {
  it("encrypts and decrypts a token correctly", async () => {
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

  it("returns null for invalid JSON in unencrypted data", async () => {
    const result = await decryptToken("not-valid-json{{{");
    assertEquals(result, null);
  });

  it("generates 64-character hex encryption keys", () => {
    const key = generateEncryptionKey();
    assertEquals(key.length, 64);
    assertEquals(/^[0-9a-f]{64}$/.test(key), true);
  });
});
