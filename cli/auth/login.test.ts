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

  describe("Credential validation", () => {
    it("validates user sessions through the profile endpoint", async () => {
      const originalFetch = globalThis.fetch;
      const requestedUrls: string[] = [];

      try {
        globalThis.fetch = ((input: string | URL | Request) => {
          requestedUrls.push(String(input));
          return Promise.resolve(
            new Response(
              JSON.stringify({ id: "user-123", email: "test@example.com" }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }) as typeof fetch;

        const { validateCredential } = await import("./login.ts");
        const credential = await validateCredential("session-token");

        assertEquals(credential, { id: "user-123", email: "test@example.com" });
        assertEquals(requestedUrls.length, 1);
        assertEquals(new URL(requestedUrls[0]!).pathname, "/me");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("validates API keys through an API-key-compatible project endpoint", async () => {
      const originalFetch = globalThis.fetch;
      const requestedUrls: string[] = [];

      try {
        globalThis.fetch = ((input: string | URL | Request) => {
          requestedUrls.push(String(input));
          return Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }) as typeof fetch;

        const { validateCredential } = await import("./login.ts");
        const credential = await validateCredential("vf_test_secret");

        assertEquals(credential, { authenticated: true, type: "apiKey" });
        assertEquals(requestedUrls.length, 1);
        const requestUrl = new URL(requestedUrls[0]!);
        assertEquals(requestUrl.pathname, "/projects");
        assertEquals(requestUrl.searchParams.get("limit"), "1");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("rejects API keys that cannot access the project endpoint", async () => {
      const originalFetch = globalThis.fetch;

      try {
        globalThis.fetch = (() =>
          Promise.resolve(new Response(null, { status: 401 }))) as typeof fetch;

        const { validateCredential } = await import("./login.ts");
        assertEquals(await validateCredential("vf_test_invalid"), null);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("reports an API key as authenticated in whoami JSON without exposing the key", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];

      try {
        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { whoami } = await import("./login.ts");
        setJsonMode(true);

        const result = await whoami({ apiToken: "vf_test_secret" } as never);
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, { authenticated: true, type: "apiKey" });
        assertEquals(envelope.success, true);
        assertEquals(envelope.command, "whoami");
        assertEquals(envelope.data, {
          authenticated: true,
          credential_type: "api_key",
          source: "env",
        });
        assertEquals(output.join("\n").includes("vf_test_secret"), false);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        globalThis.fetch = originalFetch;
        console.log = originalLog;
      }
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

    it("should accept a valid API key from the environment", async () => {
      const originalFetch = globalThis.fetch;

      try {
        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )) as typeof fetch;

        const { ensureAuthenticated } = await import("./login.ts");
        const credential = await ensureAuthenticated({ apiToken: "vf_test_secret" } as never);

        assertEquals(credential, { authenticated: true, type: "apiKey" });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe("OAuth state", () => {
    it("should generate distinct OAuth state values", async () => {
      const loginModule = await import("./login.ts") as typeof import("./login.ts") & {
        createOAuthState?: () => string;
      };

      assertEquals(typeof loginModule.createOAuthState, "function");

      const first = loginModule.createOAuthState!();
      const second = loginModule.createOAuthState!();

      assertEquals(first.length >= 32, true);
      assertEquals(second.length >= 32, true);
      assertEquals(first !== second, true);
    });

    it("should include state in the OAuth authorization URL", async () => {
      const loginModule = await import("./login.ts") as typeof import("./login.ts") & {
        createOAuthAuthorizationUrl?: (
          provider: "google" | "github" | "microsoft",
          callbackUrl: string,
          state: string,
        ) => string;
      };

      assertEquals(typeof loginModule.createOAuthAuthorizationUrl, "function");

      const authUrl = loginModule.createOAuthAuthorizationUrl!(
        "github",
        "http://localhost:3456/callback",
        "expected-state",
      );
      const parsed = new URL(authUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri");

      assertEquals(parsed.pathname, "/auth/github");
      assertEquals(redirectUri, "http://localhost:3456/callback?state=expected-state");
      assertEquals(parsed.searchParams.get("state"), "expected-state");
      assertEquals(new URL(redirectUri!).searchParams.get("state"), "expected-state");
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
