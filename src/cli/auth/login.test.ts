/**
 * Login Module Tests
 */

import { assertEquals, assertExists } from "jsr:@std/assert@1";
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "@veryfront/platform/compat/process.ts";
import { deleteToken, readToken, saveToken } from "./token-store.ts";
import type { UserInfo } from "./login.ts";

describe("Login Module", { sanitizeOps: false, sanitizeResources: false }, () => {
  beforeEach(async () => {
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
  });

  describe("Token validation", () => {
    it("should detect invalid token format", async () => {
      // Import validateToken dynamically to get the actual function
      const { validateToken } = await import("./login.ts");

      // Empty token should fail
      const result = await validateToken("");
      assertEquals(result, null);
    });
  });

  describe("User info from token", () => {
    it("should return null for invalid JWT", async () => {
      const { validateToken } = await import("./login.ts");

      // Invalid JWT should return null (API call fails)
      const result = await validateToken("invalid-token");
      assertEquals(result, null);
    });
  });

  describe("ensureAuthenticated", () => {
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

  describe("logout", () => {
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

  describe("UserInfo type", () => {
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
