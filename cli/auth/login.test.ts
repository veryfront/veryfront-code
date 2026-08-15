import "#veryfront/schemas/_test-setup.ts";
/**
 * Login Module Tests
 */

import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
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
import {
  createTestEnvironmentConfig,
  type EnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import type { UserInfo } from "./login.ts";
import { resetInteractiveMode, setNonInteractive } from "../shared/interactive.ts";

describe("Login Module", { sanitizeOps: false, sanitizeResources: false }, () => {
  let tempDir = "";
  let testEnv: EnvironmentConfig;

  async function safeDeleteToken(): Promise<void> {
    try {
      await deleteToken(testEnv);
    } catch {
      // Ignore
    }
  }

  beforeAll(async () => {
    tempDir = await makeTempDir({ prefix: "login-test-" });
    testEnv = createTestEnvironmentConfig({
      homeDir: tempDir,
      xdgConfigHome: tempDir,
    });
  });

  beforeEach(async () => {
    await safeDeleteToken();
  });

  afterEach(async () => {
    await safeDeleteToken();
  });

  afterAll(async () => {
    await remove(tempDir, { recursive: true });
  });

  describe("Token validation", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should reject empty tokens without a network request", async () => {
      const originalFetch = globalThis.fetch;
      let fetchCalls = 0;
      try {
        globalThis.fetch = (() => {
          fetchCalls++;
          return Promise.resolve(new Response(null, { status: 401 }));
        }) as typeof fetch;
        const { validateToken } = await import("./login.ts");
        assertEquals(await validateToken(""), null);
        assertEquals(await validateToken(" \t "), null);
        assertEquals(fetchCalls, 0);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("should use the provided API URL", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";

      try {
        globalThis.fetch = ((input: string | URL | Request) => {
          requestedUrl = String(input);
          return Promise.resolve(
            Response.json({ id: "user-123", email: "test@example.com" }),
          );
        }) as typeof fetch;

        const { validateToken } = await import("./login.ts");
        const env = createTestEnvironmentConfig({
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
        });

        assertExists(await validateToken("test-token", env));
        assertEquals(requestedUrl, "https://auth.example.test/me");
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns null for network failures unless throwing is requested", async () => {
      const originalFetch = globalThis.fetch;

      try {
        globalThis.fetch = (() =>
          Promise.reject(new TypeError("network unavailable"))) as typeof fetch;
        const { validateToken } = await import("./login.ts");

        assertEquals(await validateToken("test-token", testEnv), null);
        await assertRejects(
          () => validateToken("test-token", testEnv, { throwOnNetworkError: true }),
          Error,
          "Could not reach the Veryfront API",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
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
        const env = {
          ...testEnv,
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
        };
        const credential = await validateCredential("session-token", env);

        assertEquals(credential, { id: "user-123", email: "test@example.com" });
        assertEquals(requestedUrls.length, 1);
        assertEquals(requestedUrls[0], "https://auth.example.test/me");
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
        const env = {
          ...testEnv,
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
        };
        const credential = await validateCredential("vf_test_secret", env);

        assertEquals(credential, { authenticated: true, type: "apiKey" });
        assertEquals(requestedUrls.length, 1);
        const requestUrl = new URL(requestedUrls[0]!);
        assertEquals(requestUrl.origin, "https://auth.example.test");
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
        const env = {
          ...testEnv,
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
        };
        assertEquals(await validateCredential("vf_test_invalid", env), null);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("returns null when API key validation cannot reach the API", async () => {
      const originalFetch = globalThis.fetch;

      try {
        globalThis.fetch = (() =>
          Promise.reject(new TypeError("network unavailable"))) as typeof fetch;
        const { validateCredential } = await import("./login.ts");

        assertEquals(await validateCredential("vf_test_secret", testEnv), null);
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

        const env = {
          ...testEnv,
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
          apiToken: "vf_test_secret",
        };
        const result = await whoami(env);
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
      const originalFetch = globalThis.fetch;
      try {
        globalThis.fetch = (() =>
          Promise.resolve(new Response(null, { status: 401 }))) as typeof fetch;
        const { validateToken } = await import("./login.ts");
        assertEquals(await validateToken("invalid-token"), null);
      } finally {
        globalThis.fetch = originalFetch;
      }
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
        const env = {
          ...testEnv,
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
          apiToken: "vf_test_secret",
        };
        const credential = await ensureAuthenticated(env);

        assertEquals(credential, { authenticated: true, type: "apiKey" });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("does not prompt for an auth method or token in non-interactive mode", async () => {
      const { login } = await import("./login.ts");

      try {
        setNonInteractive(true);
        assertEquals(await login(undefined, testEnv), null);
        assertEquals(await login("token", testEnv), null);
      } finally {
        resetInteractiveMode();
      }
    });

    it("reports an existing valid session instead of asking for a token again", async () => {
      // `veryfront login` is step 1 of the documented deploy journey. Run by an
      // already-authenticated developer it prompted for a token and exited 1,
      // which makes the first documented step fail for the common case.
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        globalThis.fetch = (() =>
          Promise.resolve(
            Response.json({ id: "user-123", email: "test@example.com" }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { login } = await import("./login.ts");
        const result = await login(undefined, testEnv);

        assertEquals(result, { id: "user-123", email: "test@example.com" });
        const printed = output.join("\n");
        assertStringIncludes(printed, "test@example.com");
        // Must not have fallen through to the token prompt.
        assertEquals(printed.includes("Enter your API token"), false);
        // Never echo the stored credential.
        assertEquals(printed.includes("stored-valid-token"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("reports an existing stored session as login JSON when JSON mode is enabled", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        globalThis.fetch = (() =>
          Promise.resolve(
            Response.json({ id: "user-123", email: "test@example.com" }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, testEnv);
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, { id: "user-123", email: "test@example.com" });
        assertEquals(envelope.success, true);
        assertEquals(envelope.command, "login");
        assertEquals(envelope.data, {
          id: "user-123",
          email: "test@example.com",
          source: "token-store",
        });
        assertEquals(output.join("\n").includes("Already logged in as test@example.com"), false);
        assertEquals(output.join("\n").includes("stored-valid-token"), false);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("reports missing credentials as login JSON without prompting", async () => {
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];

      try {
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, testEnv);
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope, {
          success: false,
          command: "login",
          error: {
            code: "AUTHENTICATION_ERROR",
            slug: "authentication-required",
            registrySlug: "authentication-required",
            message: "Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.",
          },
        });
        assertEquals(output.join("\n").includes("Enter your API token"), false);
        assertEquals(errors, []);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        console.error = originalError;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("reports rejected stored credentials as login JSON without prompting", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      await saveToken("stored-invalid-token", testEnv);

      try {
        globalThis.fetch = (() =>
          Promise.resolve(new Response(null, { status: 401 }))) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, testEnv);
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.success, false);
        assertEquals(envelope.command, "login");
        assertEquals(envelope.error.slug, "authentication-required");
        assertEquals(envelope.error.registrySlug, "authentication-required");
        assertEquals(output.join("\n").includes("Enter your API token"), false);
        assertEquals(output.join("\n").includes("stored-invalid-token"), false);
        assertEquals(errors, []);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        console.error = originalError;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("reports timed-out credential validation as login JSON without prompting", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        const { __setExistingSessionTimeoutForTests } = await import("./login.ts");
        __setExistingSessionTimeoutForTests(50);
        globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The signal has been aborted", "AbortError"));
            });
          })) as typeof fetch;
        console.log = (message?: unknown) =>
          output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, testEnv);
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.success, false);
        assertEquals(envelope.command, "login");
        assertEquals(envelope.error, {
          code: "TIMEOUT_ERROR",
          slug: "timeout-error",
          registrySlug: "timeout-error",
          message: "Timed out while checking existing login credentials. Try again.",
        });
        assertEquals(output.join("\n").includes("Enter your API token"), false);
        assertEquals(output.join("\n").includes("stored-valid-token"), false);
        assertEquals(errors, []);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        const { __setExistingSessionTimeoutForTests } = await import("./login.ts");
        setJsonMode(false);
        __setExistingSessionTimeoutForTests();
        console.log = originalLog;
        console.error = originalError;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("reports unreachable credential validation as login JSON without prompting", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        globalThis.fetch = (() =>
          Promise.reject(new TypeError("network unavailable"))) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, testEnv);
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.error, {
          code: "NETWORK_ERROR",
          slug: "network-error",
          registrySlug: "network-error",
          message: "Could not reach the Veryfront API while checking existing login credentials.",
        });
        assertEquals(output.join("\n").includes("Enter your API token"), false);
        assertEquals(output.join("\n").includes("stored-valid-token"), false);
        assertEquals(errors, []);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        console.error = originalError;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("reports service validation failures as login JSON without prompting", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        globalThis.fetch = (() =>
          Promise.resolve(new Response(null, { status: 503 }))) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, testEnv);
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.error, {
          code: "API_CLIENT_ERROR",
          slug: "api-client-error",
          registrySlug: "api-client-error",
          message: "Veryfront API could not validate existing login credentials.",
          context: { status: 503 },
        });
        assertEquals(output.join("\n").includes("Enter your API token"), false);
        assertEquals(output.join("\n").includes("stored-valid-token"), false);
        assertEquals(errors, []);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        console.error = originalError;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("falls back to a valid stored session when the env token is invalid", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const requestedAuth: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer env-invalid-token") {
            return Promise.resolve(new Response(null, { status: 401 }));
          }
          return Promise.resolve(
            Response.json({ id: "user-123", email: "stored@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { login } = await import("./login.ts");
        const env = { ...testEnv, apiToken: "env-invalid-token" };
        const result = await login(undefined, env);

        assertEquals(result, { id: "user-123", email: "stored@example.com" });
        assertEquals(requestedAuth, [
          "Bearer env-invalid-token",
          "Bearer stored-valid-token",
        ]);
        const printed = output.join("\n");
        assertStringIncludes(printed, "stored@example.com");
        assertEquals(printed.includes("Enter your API token"), false);
        assertEquals(printed.includes("stored-valid-token"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("says an environment session came from the environment, since nothing is stored", async () => {
      // The variable is commonly set by a `.env` in the working directory the
      // developer has forgotten about — the case `whoami` now names. Reporting a
      // bare "already authenticated" implies `login` stored something, when the
      // session actually ends at the directory boundary.
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];

      try {
        setNonInteractive(true);
        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { login } = await import("./login.ts");
        const result = await login(undefined, { ...testEnv, apiToken: "vf_env_only" });

        assertEquals(result, { authenticated: true, type: "apiKey" });
        const printed = output.join("\n");
        assertStringIncludes(printed, "VERYFRONT_API_TOKEN");
        assertStringIncludes(printed, "no stored login");
        assertStringIncludes(
          printed,
          "Unset VERYFRONT_API_TOKEN before using another login method",
        );
        // Nothing was persisted, and the credential is never echoed.
        assertEquals(await readToken(testEnv), null);
        assertEquals(printed.includes("vf_env_only"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("reports an existing environment API key as login JSON when JSON mode is enabled", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];

      try {
        setNonInteractive(true);
        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, { ...testEnv, apiToken: "vf_env_only" });
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, { authenticated: true, type: "apiKey" });
        assertEquals(envelope.success, true);
        assertEquals(envelope.command, "login");
        assertEquals(envelope.data, {
          authenticated: true,
          credential_type: "api_key",
          source: "env",
        });
        assertEquals(output.join("\n").includes("VERYFRONT_API_TOKEN"), false);
        assertEquals(output.join("\n").includes("vf_env_only"), false);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("does not present an unverified stored credential as a login", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const requestedAuth: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          requestedAuth.push(String(new Headers(init?.headers).get("authorization") ?? ""));
          return Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { login } = await import("./login.ts");
        const result = await login(undefined, { ...testEnv, apiToken: "vf_env_existing" });

        assertEquals(result, { authenticated: true, type: "apiKey" });
        assertEquals(requestedAuth, ["Bearer vf_env_existing"]);
        const printed = output.join("\n");
        assertStringIncludes(printed, "VERYFRONT_API_TOKEN");
        assertStringIncludes(printed, "takes precedence over a stored credential");
        assertStringIncludes(
          printed,
          "Unset VERYFRONT_API_TOKEN before attempting to use the stored credential",
        );
        assertEquals(printed.includes("stored login"), false);
        assertEquals(printed.includes("vf_env_existing"), false);
        assertEquals(printed.includes("stored-valid-token"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("does not claim the environment when the session is a stored login", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        globalThis.fetch = (() =>
          Promise.resolve(
            Response.json({ id: "user-123", email: "test@example.com" }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { login } = await import("./login.ts");
        await login(undefined, testEnv);

        const printed = output.join("\n");
        assertEquals(printed.includes("no stored login"), false);
        assertEquals(printed.includes("VERYFRONT_API_TOKEN"), false);
        assertEquals(printed.includes("Unset VERYFRONT_API_TOKEN"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("does not hang when the API accepts the connection but never answers", async () => {
      // The existing-session preflight is best-effort. Without a deadline a
      // stalled API blocks bare `login` forever, so it never reaches the normal
      // sign-in flow this change promises as the fallback.
      const originalFetch = globalThis.fetch;
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        const { __setExistingSessionTimeoutForTests } = await import("./login.ts");
        __setExistingSessionTimeoutForTests(50);

        // Models a genuinely stalled request: the connection is accepted and the
        // promise settles only once the abort signal fires. If the signal is not
        // threaded through, this never resolves and the race below reports it.
        globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("The signal has been aborted", "AbortError"));
            });
          })) as typeof fetch;

        const { login } = await import("./login.ts");
        const outcome = await Promise.race([
          login(undefined, testEnv),
          new Promise((resolve) =>
            setTimeout(() => resolve("TIMED_OUT"), 3000)
          ),
        ]);

        assertEquals(outcome, null);
      } finally {
        const { __setExistingSessionTimeoutForTests } = await import("./login.ts");
        __setExistingSessionTimeoutForTests();
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("shares one preflight deadline across environment and stored credentials", async () => {
      const originalFetch = globalThis.fetch;
      const signals: AbortSignal[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        const { __setExistingSessionTimeoutForTests } = await import("./login.ts");
        __setExistingSessionTimeoutForTests(50);

        globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) =>
          new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) {
              return;
            }
            signals.push(signal);
            const rejectAbort = () =>
              reject(new DOMException("The signal has been aborted", "AbortError"));
            if (signal.aborted) {
              rejectAbort();
            } else signal.addEventListener("abort", rejectAbort, { once: true });
          })) as typeof fetch;

        const { login } = await import("./login.ts");
        const result = await login(undefined, { ...testEnv, apiToken: "env-token" });

        assertEquals(result, null);
        assertEquals(signals.length, 2);
        assertEquals(signals[0], signals[1]);
      } finally {
        const { __setExistingSessionTimeoutForTests } = await import("./login.ts");
        __setExistingSessionTimeoutForTests();
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("still re-authenticates when a method is explicitly requested", async () => {
      // Switching accounts must stay possible: an explicit method is intent to
      // sign in again, so the existing session must not short-circuit it.
      const originalFetch = globalThis.fetch;
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        globalThis.fetch = (() =>
          Promise.resolve(
            Response.json({ id: "user-123", email: "test@example.com" }),
          )) as typeof fetch;

        const { login } = await import("./login.ts");
        assertEquals(await login("token", testEnv), null);
      } finally {
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
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
          env?: EnvironmentConfig,
        ) => string;
      };

      assertEquals(typeof loginModule.createOAuthAuthorizationUrl, "function");

      const authUrl = loginModule.createOAuthAuthorizationUrl!(
        "github",
        "http://localhost:3456/callback",
        "expected-state",
        createTestEnvironmentConfig({
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
        }),
      );
      const parsed = new URL(authUrl);
      const redirectUri = parsed.searchParams.get("redirect_uri");

      assertEquals(parsed.origin, "https://auth.example.test");
      assertEquals(parsed.pathname, "/auth/github");
      assertEquals(redirectUri, "http://localhost:3456/callback?state=expected-state");
      assertEquals(parsed.searchParams.get("state"), "expected-state");
      assertEquals(new URL(redirectUri!).searchParams.get("state"), "expected-state");
    });

    it("prints a manual login URL when the browser cannot be opened", async () => {
      const originalLog = console.log;
      const output: string[] = [];
      const spinnerEvents: string[] = [];

      try {
        console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
        const { openOAuthLogin } = await import("./login.ts");
        const opened = await openOAuthLogin(
          "https://auth.example.test/login?state=expected-state",
          {
            update: (text) => spinnerEvents.push(`update:${text}`),
            success: (text) => spinnerEvents.push(`success:${text ?? ""}`),
            error: (text) => spinnerEvents.push(`error:${text ?? ""}`),
            stop: () => spinnerEvents.push("stop"),
          },
          () => Promise.reject(new Error("browser unavailable")),
        );

        assertEquals(opened, false);
        assertEquals(spinnerEvents, ["stop"]);
        assertStringIncludes(output.join("\n"), "Could not open the browser");
        assertStringIncludes(
          output.join("\n"),
          "https://auth.example.test/login?state=expected-state",
        );
      } finally {
        console.log = originalLog;
      }
    });
  });

  describe("logout", { sanitizeOps: false, sanitizeResources: false }, () => {
    it("should clear stored token", async () => {
      await saveToken("test-token", testEnv);
      assertEquals(await readToken(testEnv), "test-token");

      const { logout } = await import("./login.ts");
      await logout(testEnv);

      assertEquals(await readToken(testEnv), null);
    });
  });

  describe("whoami", () => {
    it("should use the provided token store and API URL", async () => {
      const originalFetch = globalThis.fetch;
      let requestedUrl = "";
      await saveToken("test-token", testEnv);

      try {
        globalThis.fetch = ((input: string | URL | Request) => {
          requestedUrl = String(input);
          return Promise.resolve(
            Response.json({ id: "user-123", email: "test@example.com" }),
          );
        }) as typeof fetch;

        const { whoami } = await import("./login.ts");
        const env = { ...testEnv, apiBaseUrl: "https://auth.example.test", apiUrl: undefined };
        const user = await whoami(env);

        assertEquals(user, { id: "user-123", email: "test@example.com" });
        assertEquals(requestedUrl, "https://auth.example.test/me");
      } finally {
        globalThis.fetch = originalFetch;
      }
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
