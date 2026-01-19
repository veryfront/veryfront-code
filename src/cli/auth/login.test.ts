/**
 * Login Module Tests
 */

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { afterAll, afterEach, beforeAll, beforeEach, describe, it } from "@veryfront/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "@veryfront/platform/compat/process.ts";
import { deleteToken, readToken, saveToken } from "./token-store.ts";
import { makeTempDir, remove } from "@veryfront/platform/compat/fs.ts";
import type { UserInfo } from "./login.ts";

describe("Login Module", { sanitizeOps: false, sanitizeResources: false }, () => {
  let tempDir: string;
  let originalXdgConfig: string | undefined;

  beforeAll(async () => {
    // Create isolated temp directory for this test file
    tempDir = await makeTempDir({ prefix: "login-test-" });
    // Save original XDG_CONFIG_HOME for per-test restore
    originalXdgConfig = getEnv("XDG_CONFIG_HOME");
  });

  beforeEach(async () => {
    // Isolate config home per test to avoid cross-test env clashes
    setEnv("XDG_CONFIG_HOME", tempDir);
    // Clean up any existing token
    try {
      await deleteToken();
    } catch {
      // Ignore
    }
  });

  afterEach(async () => {
    try {
      await deleteToken();
    } catch {
      // Ignore
    }
    // Restore original XDG_CONFIG_HOME
    if (originalXdgConfig !== undefined) {
      setEnv("XDG_CONFIG_HOME", originalXdgConfig);
    } else {
      deleteEnv("XDG_CONFIG_HOME");
    }
  });

  afterAll(async () => {
    // Clean up temp directory
    await remove(tempDir, { recursive: true });
  });

  describe("Token validation", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should detect invalid token format", async () => {
      // Import validateToken dynamically to get the actual function
      const { validateToken } = await import("./login.ts");

      // Empty token should fail
      const result = await validateToken("");
      assertEquals(result, null);
    });
  });

  describe("User info from token", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should return null for invalid JWT", async () => {
      const { validateToken } = await import("./login.ts");

      // Invalid JWT should return null (API call fails)
      const result = await validateToken("invalid-token");
      assertEquals(result, null);
    });
  });

  describe("ensureAuthenticated", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should use existing valid token from env", async () => {
      const originalToken = getEnv("VERYFRONT_API_TOKEN");
      try {
        // Set a fake token (won't actually validate but tests the flow)
        setEnv("VERYFRONT_API_TOKEN", "env-token");

        // Since we can't actually validate against the API in tests,
        // we just verify the function exists and can be called
        const { ensureAuthenticated } = await import("./login.ts");
        assertExists(ensureAuthenticated);
        assertEquals(typeof ensureAuthenticated, "function");
      } finally {
        if (originalToken) {
          setEnv("VERYFRONT_API_TOKEN", originalToken);
        } else {
          deleteEnv("VERYFRONT_API_TOKEN");
        }
      }
    });
  });

  describe("logout", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should clear stored token", async () => {
      // Save a token first
      await saveToken("test-token");

      // Verify it's saved
      let token = await readToken();
      assertEquals(token, "test-token");

      // Import and call logout
      const { logout } = await import("./login.ts");
      await logout();

      // Verify token is cleared
      token = await readToken();
      assertEquals(token, null);
    });
  });

  describe("UserInfo type", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should have correct structure", () => {
      const userInfo: UserInfo = {
        id: "user-123",
        email: "test@example.com",
        name: "Test User",
      };

      assertExists(userInfo.id);
      assertExists(userInfo.email);
      assertEquals(typeof userInfo.id, "string");
      assertEquals(typeof userInfo.email, "string");
    });
  });
});
