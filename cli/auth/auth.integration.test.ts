import "#veryfront/schemas/_test-setup.ts";
/**
 * CLI Auth Integration Tests
 *
 * Tests the complete authentication flow including token storage,
 * callback server, and login commands.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { makeTempDir, remove } from "#veryfront/compat/fs.ts";
import {
  createTestEnvironmentConfig,
  type EnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { deleteToken, readToken, saveToken } from "./token-store.ts";
import { type CallbackServer, getCallbackUrl, startCallbackServer } from "./callback-server.ts";
import { scaleMs } from "#veryfront/testing";

describe("CLI Auth Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  let server: CallbackServer | null = null;
  let tempDir: string;
  let testEnv: EnvironmentConfig;

  async function cleanupToken(): Promise<void> {
    try {
      await deleteToken(testEnv);
    } catch {
      // Ignore
    }
  }

  beforeAll(async () => {
    tempDir = await makeTempDir({ prefix: "cli-auth-integration-" });
    testEnv = createTestEnvironmentConfig({
      homeDir: tempDir,
      xdgConfigHome: tempDir,
    });
  });

  beforeEach(async () => {
    await cleanupToken();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }

    await cleanupToken();
  });

  afterAll(async () => {
    await remove(tempDir, { recursive: true });
  });

  describe("Complete OAuth flow simulation", () => {
    it("should receive and store token from callback", async () => {
      server = await startCallbackServer(9876);
      const callbackUrl = getCallbackUrl(server.port);

      const callbackPromise = server.waitForCallback(scaleMs(5000));

      const testToken = "oauth-test-token-xyz";
      setTimeout(async () => {
        const response = await fetch(`${callbackUrl}?token=${testToken}`);
        assertEquals(response.status, 200);

        const html = await response.text();
        assertEquals(html.includes("Logged in"), true);
      }, scaleMs(100));

      const result = await callbackPromise;
      assertEquals(result.token, testToken);

      await saveToken(result.token, testEnv);

      const storedToken = await readToken(testEnv);
      assertEquals(storedToken, testToken);
    });

    it("should handle OAuth error gracefully", async () => {
      server = await startCallbackServer(9876);
      const callbackUrl = getCallbackUrl(server.port);

      const callbackPromise = server.waitForCallback(scaleMs(5000));

      setTimeout(async () => {
        const response = await fetch(`${callbackUrl}?error=access_denied`);
        assertEquals(response.status, 200);

        const html = await response.text();
        assertEquals(html.includes("Login failed"), true);
        assertEquals(html.includes("access_denied"), true);
      }, scaleMs(100));

      const result = await callbackPromise;
      assertEquals(result.token, "");
      assertEquals(result.error, "access_denied");
    });
  });

  describe("Token persistence", () => {
    it("should persist token across sessions", async () => {
      const testToken = "persistent-token";

      await saveToken(testToken, testEnv);

      const token = await readToken(testEnv);
      assertEquals(token, testToken);
    });

    it("should overwrite old token on re-login", async () => {
      await saveToken("old-token", testEnv);
      await saveToken("new-token", testEnv);

      const token = await readToken(testEnv);
      assertEquals(token, "new-token");
    });

    it("should clear token on logout", async () => {
      await saveToken("session-token", testEnv);
      assertEquals(await readToken(testEnv), "session-token");

      await deleteToken(testEnv);
      assertEquals(await readToken(testEnv), null);
    });
  });

  describe("Multiple concurrent servers", () => {
    it("should handle port conflicts gracefully", async () => {
      const server1 = await startCallbackServer(9876);
      server = server1;

      const server2 = await startCallbackServer(9876);

      assertExists(server1.port);
      assertExists(server2.port);

      const portsAreDifferent = server1.port !== server2.port;
      const firstGotPreferred = server1.port === 9876;
      assertEquals(portsAreDifferent || firstGotPreferred, true);

      await server2.stop();
    });
  });

  describe("Callback URL generation", () => {
    it("should generate correct localhost URL", () => {
      const url = getCallbackUrl(9876);
      assertEquals(url, "http://localhost:9876/callback");
    });

    it("should use dynamic port", async () => {
      server = await startCallbackServer(0);
      const url = getCallbackUrl(server.port);

      assertEquals(url.includes(String(server.port)), true);
      assertEquals(url.startsWith("http://localhost:"), true);
      assertEquals(url.endsWith("/callback"), true);
    });
  });
});
