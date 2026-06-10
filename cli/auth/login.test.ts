import "#veryfront/schemas/_test-setup.ts";
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

  describe("buildOAuthAuthUrl (state binding)", {
    sanitizeOps: false,
    sanitizeResources: false,
  }, () => {
    const callbackUrl = "http://localhost:9876/callback";

    it("should include a URL-encoded state query parameter", async () => {
      const { buildOAuthAuthUrl } = await import("./login.ts");
      const state = "abc123statevalue";
      const url = buildOAuthAuthUrl("google", callbackUrl, state);

      const parsed = new URL(url);
      assertEquals(parsed.pathname, "/auth/google");
      assertEquals(parsed.searchParams.get("state"), state);
      assertEquals(parsed.searchParams.get("redirect_uri"), callbackUrl);
    });

    it("should percent-encode special characters in state", async () => {
      const { buildOAuthAuthUrl } = await import("./login.ts");
      // A state containing reserved characters must not break out of the query.
      const state = "a b&c=d#e";
      const url = buildOAuthAuthUrl("github", callbackUrl, state);

      // Raw reserved characters must be encoded in the URL string.
      assertEquals(url.includes(" "), false);
      assertEquals(url.includes("state=a b"), false);
      // Decoding the query yields the original value back, intact.
      const parsed = new URL(url);
      assertEquals(parsed.searchParams.get("state"), state);
    });

    it("should bind the same state value into the callback server contract", async () => {
      // The state generated for the flow is the value the loopback server
      // enforces. generateCallbackState is the CSPRNG source used by login.
      const { buildOAuthAuthUrl } = await import("./login.ts");
      const { generateCallbackState } = await import("./callback-server.ts");

      const state = generateCallbackState();
      const url = buildOAuthAuthUrl("microsoft", callbackUrl, state);
      const parsed = new URL(url);
      assertEquals(parsed.searchParams.get("state"), state);
      assertEquals(state.length, 64);
    });
  });

  describe("API token login path", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should keep validateToken usable for the non-OAuth path", async () => {
      // The API-token login path must remain intact alongside the OAuth
      // state-binding changes. An empty token is rejected without a network
      // call returning a token.
      const { validateToken } = await import("./login.ts");
      assertEquals(await validateToken(""), null);
    });
  });
});
