/**
 * CLI Auth Integration Tests
 *
 * Tests the complete authentication flow including token storage,
 * callback server, and login commands.
 */

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "@veryfront/testing/bdd";
import { makeTempDir, remove } from "@veryfront/compat/fs.ts";
import { deleteEnv, getEnv, setEnv } from "@veryfront/compat/process.ts";
import { deleteToken, readToken, saveToken } from "../../../src/cli/auth/token-store.ts";
import {
  getCallbackUrl,
  startCallbackServer,
  type CallbackServer,
} from "../../../src/cli/auth/callback-server.ts";
import { scaleMs } from "@veryfront/testing";

describe("CLI Auth Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  let server: CallbackServer | null = null;
  let tempDir: string;
  let originalXdgConfig: string | undefined;

  beforeAll(async () => {
    tempDir = await makeTempDir({ prefix: "cli-auth-integration-" });
    originalXdgConfig = getEnv("XDG_CONFIG_HOME");
  });

  beforeEach(async () => {
    setEnv("XDG_CONFIG_HOME", tempDir);
    // Clean up any existing token
    try {
      await deleteToken();
    } catch {
      // Ignore
    }
  });

  afterEach(async () => {
    // Stop server if running
    if (server) {
      await server.stop();
      server = null;
    }
    // Clean up token
    try {
      await deleteToken();
    } catch {
      // Ignore
    }
    if (originalXdgConfig !== undefined) {
      setEnv("XDG_CONFIG_HOME", originalXdgConfig);
    } else {
      deleteEnv("XDG_CONFIG_HOME");
    }
  });

  afterAll(async () => {
    await remove(tempDir, { recursive: true });
  });

  describe("Complete OAuth flow simulation", () => {
    it("should receive and store token from callback", async () => {
      // 1. Start callback server (like CLI does)
      server = await startCallbackServer(9876);
      const callbackUrl = getCallbackUrl(server.port);

      // 2. Set up promise to wait for callback
      const callbackPromise = server.waitForCallback(scaleMs(5000));

      // 3. Simulate OAuth redirect with token (like browser would do)
      const testToken = "oauth-test-token-xyz";
      setTimeout(async () => {
        const response = await fetch(`${callbackUrl}?token=${testToken}`);
        assertEquals(response.status, 200);
        const html = await response.text();
        // Verify success page is returned
        assertEquals(html.includes("Logged in"), true);
      }, scaleMs(100));

      // 4. Wait for callback to complete
      const result = await callbackPromise;
      assertEquals(result.token, testToken);

      // 5. Save token (like CLI would)
      await saveToken(result.token);

      // 6. Verify token is stored
      const storedToken = await readToken();
      assertEquals(storedToken, testToken);
    });

    it("should handle OAuth error gracefully", async () => {
      server = await startCallbackServer(9876);
      const callbackUrl = getCallbackUrl(server.port);

      const callbackPromise = server.waitForCallback(scaleMs(5000));

      // Simulate error from OAuth provider
      setTimeout(async () => {
        const response = await fetch(`${callbackUrl}?error=access_denied`);
        assertEquals(response.status, 200);
        const html = await response.text();
        // Verify error page is returned
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

      // Save token
      await saveToken(testToken);

      // Read token (simulating new CLI invocation)
      const token = await readToken();
      assertEquals(token, testToken);
    });

    it("should overwrite old token on re-login", async () => {
      // First login
      await saveToken("old-token");

      // Second login (re-auth)
      await saveToken("new-token");

      // Should have new token
      const token = await readToken();
      assertEquals(token, "new-token");
    });

    it("should clear token on logout", async () => {
      // Login
      await saveToken("session-token");
      assertEquals(await readToken(), "session-token");

      // Logout
      await deleteToken();
      assertEquals(await readToken(), null);
    });
  });

  describe("Multiple concurrent servers", () => {
    it("should handle port conflicts gracefully", async () => {
      // Start first server on preferred port
      const server1 = await startCallbackServer(9876);
      server = server1;

      // Start second server - should get different port
      const server2 = await startCallbackServer(9876);

      // Both should be running
      assertExists(server1.port);
      assertExists(server2.port);

      // Ports should be different (or first got 9876)
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
      server = await startCallbackServer(0); // Let system assign port
      const url = getCallbackUrl(server.port);

      // URL should contain the assigned port
      assertEquals(url.includes(String(server.port)), true);
      assertEquals(url.startsWith("http://localhost:"), true);
      assertEquals(url.endsWith("/callback"), true);
    });
  });
});
