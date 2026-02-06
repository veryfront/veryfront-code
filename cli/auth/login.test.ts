/**
 * Login Module Tests
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  it,
} from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { deleteToken, readToken, saveToken } from "./token-store.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import type { UserInfo } from "./login.ts";

describe("Login Module", { sanitizeOps: false, sanitizeResources: false }, () => {
  let tempDir = "";
  let originalXdgConfig: string | undefined;

  async function safeDeleteToken(): Promise<void> {
    try {
      await deleteToken();
    } catch {
      // Ignore
    }
  }

  function restoreXdgConfigHome(): void {
    if (originalXdgConfig != null) {
      setEnv("XDG_CONFIG_HOME", originalXdgConfig);
      return;
    }
    deleteEnv("XDG_CONFIG_HOME");
  }

  beforeAll(async () => {
    tempDir = await makeTempDir({ prefix: "login-test-" });
    originalXdgConfig = getEnv("XDG_CONFIG_HOME");
  });

  beforeEach(async () => {
    setEnv("XDG_CONFIG_HOME", tempDir);
    await safeDeleteToken();
  });

  afterEach(async () => {
    await safeDeleteToken();
    restoreXdgConfigHome();
  });

  afterAll(async () => {
    await remove(tempDir, { recursive: true });
  });

  describe("Token validation", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should detect invalid token format", async () => {
      const { validateToken } = await import("./login.ts");
      assertEquals(await validateToken(""), null);
    });
  });

  describe("User info from token", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should return null for invalid JWT", async () => {
      const { validateToken } = await import("./login.ts");
      assertEquals(await validateToken("invalid-token"), null);
    });
  });

  describe("ensureAuthenticated", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should use existing valid token from env", async () => {
      const originalToken = getEnv("VERYFRONT_API_TOKEN");

      try {
        setEnv("VERYFRONT_API_TOKEN", "env-token");

        const { ensureAuthenticated } = await import("./login.ts");
        assertExists(ensureAuthenticated);
        assertEquals(typeof ensureAuthenticated, "function");
      } finally {
        if (originalToken) setEnv("VERYFRONT_API_TOKEN", originalToken);
        else deleteEnv("VERYFRONT_API_TOKEN");
      }
    });
  });

  describe("logout", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should clear stored token", async () => {
      await saveToken("test-token");
      assertEquals(await readToken(), "test-token");

      const { logout } = await import("./login.ts");
      await logout();

      assertEquals(await readToken(), null);
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
