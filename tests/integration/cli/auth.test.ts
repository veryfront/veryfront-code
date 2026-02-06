/**
 * CLI Auth Integration Tests
 *
 * Tests the complete authentication flow including token storage,
 * callback server, and login commands.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { makeTempDir, remove } from "#veryfront/compat/fs.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { deleteToken, readToken, saveToken } from "../../../cli/auth/token-store.ts";
import {
  type CallbackServer,
  getCallbackUrl,
  startCallbackServer,
} from "../../../cli/auth/callback-server.ts";
import { scaleMs } from "#veryfront/testing";

describe("CLI Auth Integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  let server: CallbackServer | null = null;
  let tempDir: string;
  let originalXdgConfig: string | undefined;

  async function cleanupToken(): Promise<void> {
    try {
      await deleteToken();
    } catch {
      // Ignore
    }
  }

  beforeAll(async () => {
    tempDir = await makeTempDir({ prefix: "cli-auth-integration-" });
    originalXdgConfig = getEnv("XDG_CONFIG_HOME");
  });

  beforeEach(async () => {
    setEnv("XDG_CONFIG_HOME", tempDir);
    await cleanupToken();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }

    await cleanupToken();

    if (originalXdgConfig !== undefined) {
      setEnv("XDG_CONFIG_HOME", originalXdgConfig);
      return;
    }

    deleteEnv("XDG_CONFIG_HOME");
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

      await saveToken(result.token);

      const storedToken = await readToken();
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

      await saveToken(testToken);

      const token = await readToken();
      assertEquals(token, testToken);
    });

    it("should overwrite old token on re-login", async () => {
      await saveToken("old-token");
      await saveToken("new-token");

      const token = await readToken();
      assertEquals(token, "new-token");
    });

    it("should clear token on logout", async () => {
      await saveToken("session-token");
      assertEquals(await readToken(), "session-token");

      await deleteToken();
      assertEquals(await readToken(), null);
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
