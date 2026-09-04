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
import { deleteEnv, getEnv, setEnv } from "#cli/process-env";
import { deleteToken, readToken, saveToken } from "./token-store.ts";
import { makeTempDir, remove } from "#veryfront/platform/compat/fs.ts";
import {
  createTestEnvironmentConfig,
  type EnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import type { UserInfo } from "./login.ts";
import { resetInteractiveMode, setNonInteractive } from "../shared/interactive.ts";

const STORED_CREDENTIAL_OUTAGES: ReadonlyArray<{
  name: string;
  expectedLoginSlug: string;
  respond: () => Promise<Response>;
}> = [
  {
    name: "a network failure",
    expectedLoginSlug: "network-error",
    respond: () => Promise.reject(new TypeError("network unavailable")),
  },
  {
    name: "a timeout",
    expectedLoginSlug: "timeout-error",
    respond: () => Promise.reject(new DOMException("timed out", "TimeoutError")),
  },
  {
    name: "a 503 response",
    expectedLoginSlug: "api-client-error",
    respond: () => Promise.resolve(new Response(null, { status: 503 })),
  },
];

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

    it("rethrows unexpected token validation failures in strict mode", async () => {
      const originalFetch = globalThis.fetch;

      try {
        globalThis.fetch = (() =>
          Promise.reject(new Error("unexpected token failure"))) as typeof fetch;
        const { validateCredential } = await import("./login.ts");

        await assertRejects(
          () =>
            validateCredential("session-token", testEnv, {
              throwOnCredentialValidationUnavailable: true,
            }),
          Error,
          "unexpected token failure",
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    it("rethrows unexpected API key validation failures in strict mode", async () => {
      const originalFetch = globalThis.fetch;

      try {
        globalThis.fetch = (() =>
          Promise.reject(new Error("unexpected API key failure"))) as typeof fetch;
        const { validateCredential } = await import("./login.ts");

        await assertRejects(
          () =>
            validateCredential("vf_test_secret", testEnv, {
              throwOnCredentialValidationUnavailable: true,
            }),
          Error,
          "unexpected API key failure",
        );
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

    for (
      const { name, rejectValidation } of [
        {
          name: "a network failure",
          rejectValidation: () => new TypeError("network unavailable"),
        },
        {
          name: "a timeout",
          rejectValidation: () => new DOMException("timed out", "TimeoutError"),
        },
        {
          name: "a 503 response",
          rejectValidation: null,
        },
      ]
    ) {
      it(`retains a stored session after ${name}`, async () => {
        const originalFetch = globalThis.fetch;
        await saveToken("stored-unavailable-token", testEnv);

        try {
          setNonInteractive(true);
          globalThis.fetch = (rejectValidation
            ? (() =>
              Promise.reject(rejectValidation()))
            : (() => Promise.resolve(new Response(null, { status: 503 })))) as typeof fetch;

          const { ensureAuthenticated } = await import("./login.ts");
          assertEquals(await ensureAuthenticated(testEnv), null);
          assertEquals(await readToken(testEnv), "stored-unavailable-token");
        } finally {
          globalThis.fetch = originalFetch;
          resetInteractiveMode();
          await safeDeleteToken();
        }
      });
    }

    it("retains a stored session and propagates unexpected validation failures", async () => {
      const originalFetch = globalThis.fetch;
      await saveToken("stored-unexpected-token", testEnv);

      try {
        setNonInteractive(true);
        globalThis.fetch = (() =>
          Promise.reject(new Error("unexpected validation failure"))) as typeof fetch;

        const { ensureAuthenticated } = await import("./login.ts");
        await assertRejects(
          () => ensureAuthenticated(testEnv),
          Error,
          "unexpected validation failure",
        );
        assertEquals(await readToken(testEnv), "stored-unexpected-token");
      } finally {
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("deletes stored sessions rejected with 401 or 403", async () => {
      const originalFetch = globalThis.fetch;

      try {
        setNonInteractive(true);
        const { ensureAuthenticated } = await import("./login.ts");
        for (const status of [401, 403]) {
          await saveToken(`stored-rejected-${status}`, testEnv);
          globalThis.fetch = (() =>
            Promise.resolve(new Response(null, { status }))) as typeof fetch;

          assertEquals(await ensureAuthenticated(testEnv), null);
          assertEquals(await readToken(testEnv), null);
        }
      } finally {
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("falls back to a valid project dotenv credential after a rejected stored session", async () => {
      const originalFetch = globalThis.fetch;
      const originalToken = getEnv("VERYFRONT_API_TOKEN");
      const envDir = await makeTempDir({ prefix: "ensure-dotenv-fallback-" });
      const requestedAuth: string[] = [];
      await saveToken("stored-invalid-token", testEnv);

      try {
        deleteEnv("VERYFRONT_API_TOKEN");
        await Deno.writeTextFile(
          `${envDir}/.env`,
          "VERYFRONT_API_TOKEN=env-file-valid-token\n",
        );
        const { __resetEnvLoaderForTests, loadEnv } = await import(
          "veryfront/utils/env-loader"
        );
        __resetEnvLoaderForTests();
        await loadEnv({ cwd: envDir });
        setNonInteractive(true);

        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer stored-invalid-token") {
            return Promise.resolve(new Response(null, { status: 401 }));
          }
          return Promise.resolve(
            Response.json({ id: "env-user", email: "env@example.com" }),
          );
        }) as typeof fetch;

        const { ensureAuthenticated } = await import("./login.ts");
        const credential = await ensureAuthenticated({
          ...testEnv,
          apiToken: "env-file-valid-token",
        });

        assertEquals(credential, { id: "env-user", email: "env@example.com" });
        assertEquals(requestedAuth, [
          "Bearer stored-invalid-token",
          "Bearer env-file-valid-token",
        ]);
        assertEquals(await readToken(testEnv), null);
      } finally {
        const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
        __resetEnvLoaderForTests();
        if (originalToken) setEnv("VERYFRONT_API_TOKEN", originalToken);
        else deleteEnv("VERYFRONT_API_TOKEN");
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
        await remove(envDir, { recursive: true });
      }
    });

    it("uses a valid veryfront.json API key without executing module config", async () => {
      const originalFetch = globalThis.fetch;
      const projectDir = await makeTempDir({ prefix: "ensure-config-token-" });
      const markerPath = `${projectDir}/executed-module-config`;
      let requestedUrl = "";
      let requestedAuth = "";

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.config.ts`,
          `await Deno.writeTextFile(${
            JSON.stringify(markerPath)
          }, "executed");\nexport default { projectSlug: "module-project" };\n`,
        );
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({
            apiToken: "vf_config_secret",
            apiUrl: "https://config-auth.example.test",
            projectSlug: "json-project",
          }) + "\n",
        );
        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
          requestedUrl = String(input);
          requestedAuth = String(new Headers(init?.headers).get("Authorization"));
          return Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }) as typeof fetch;

        const { ensureAuthenticated } = await import("./login.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const credential = await withCwd(projectDir, () => ensureAuthenticated(testEnv));

        assertEquals(credential, { authenticated: true, type: "apiKey" });
        assertEquals(requestedUrl, "https://config-auth.example.test/projects?limit=1");
        assertEquals(requestedAuth, "Bearer vf_config_secret");
        assertEquals(await Deno.stat(markerPath).then(() => true).catch(() => false), false);
      } finally {
        globalThis.fetch = originalFetch;
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("keeps an existing-session login scoped to the requested project directory", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const cwdDir = await makeTempDir({ prefix: "ensure-login-cwd-config-" });
      const targetDir = await makeTempDir({ prefix: "ensure-login-target-" });
      const output: string[] = [];
      let requests = 0;

      try {
        await Deno.writeTextFile(
          `${cwdDir}/veryfront.json`,
          JSON.stringify({
            apiToken: "vf_cwd_config",
            apiUrl: "https://cwd-config.example.test",
            projectSlug: "cwd-project",
          }) + "\n",
        );
        globalThis.fetch = (() => {
          requests++;
          return Promise.resolve(
            Response.json({ data: [], page_info: {} }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        setJsonMode(true);

        const result = await withCwd(
          cwdDir,
          () => login(undefined, testEnv, targetDir),
        );
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(requests, 0);
        assertEquals(envelope.error.slug, "authentication-required");
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await remove(cwdDir, { recursive: true });
        await remove(targetDir, { recursive: true });
      }
    });

    it("keeps shared config fallback scoped to the requested project directory", async () => {
      const originalFetch = globalThis.fetch;
      const cwdDir = await makeTempDir({ prefix: "config-auth-cwd-" });
      const targetDir = await makeTempDir({ prefix: "config-auth-target-" });
      let requests = 0;

      try {
        await Deno.writeTextFile(
          `${cwdDir}/veryfront.json`,
          JSON.stringify({
            apiToken: "vf_cwd_config",
            apiUrl: "https://cwd-config.example.test",
            projectSlug: "cwd-project",
          }) + "\n",
        );
        globalThis.fetch = (() => {
          requests++;
          return Promise.resolve(Response.json({ data: [], page_info: {} }));
        }) as typeof fetch;

        const { resolveConfigWithAuth } = await import("../shared/config.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");

        await assertRejects(
          () => withCwd(cwdDir, () => resolveConfigWithAuth(targetDir, testEnv)),
          Error,
          "Authentication required",
        );
        assertEquals(requests, 0);
      } finally {
        globalThis.fetch = originalFetch;
        await remove(cwdDir, { recursive: true });
        await remove(targetDir, { recursive: true });
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

    it("explains account switching for an existing config-file login in human mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const projectDir = await makeTempDir({ prefix: "login-config-human-" });

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({ apiToken: "config-valid-token", projectSlug: "test-project" }) + "\n",
        );

        globalThis.fetch = (() =>
          Promise.resolve(
            Response.json({ id: "config-user", email: "config@example.com" }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const { login } = await import("./login.ts");

        const result = await withCwd(projectDir, () => login(undefined, testEnv));
        const printed = output.join("\n");

        assertEquals(result, { id: "config-user", email: "config@example.com" });
        assertStringIncludes(printed, "Already logged in as config@example.com");
        assertStringIncludes(printed, "Using apiToken from veryfront.json");
        assertStringIncludes(
          printed,
          "Remove or replace apiToken in veryfront.json before signing in with another method.",
        );
        assertEquals(printed.includes("config-valid-token"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
        await remove(projectDir, { recursive: true });
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
              reject(init.signal?.reason);
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

    it("reports non-auth token validation statuses as login JSON service failures", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        globalThis.fetch = (() =>
          Promise.resolve(new Response(null, { status: 429 }))) as typeof fetch;
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
          context: { status: 429 },
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

    it("reports non-auth API key validation statuses as login JSON service failures", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];

      try {
        globalThis.fetch = (() =>
          Promise.resolve(new Response(null, { status: 408 }))) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, { ...testEnv, apiToken: "vf_env_only" });
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.error, {
          code: "API_CLIENT_ERROR",
          slug: "api-client-error",
          registrySlug: "api-client-error",
          message: "Veryfront API could not validate existing login credentials.",
          context: { status: 408 },
        });
        assertEquals(output.join("\n").includes("VERYFRONT_API_TOKEN"), false);
        assertEquals(output.join("\n").includes("vf_env_only"), false);
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

    it("preserves an environment service failure over a valid stored login in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const requestedAuth: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer env-token") {
            return Promise.resolve(new Response(null, { status: 429 }));
          }
          return Promise.resolve(
            Response.json({ id: "user-123", email: "stored@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, { ...testEnv, apiToken: "env-token" });
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.error, {
          code: "API_CLIENT_ERROR",
          slug: "api-client-error",
          registrySlug: "api-client-error",
          message: "Veryfront API could not validate existing login credentials.",
          context: { status: 429 },
        });
        assertEquals(requestedAuth, ["Bearer env-token"]);
        assertEquals(output.join("\n").includes("stored@example.com"), false);
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

    it("preserves an environment rejection over a valid stored login in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const requestedAuth: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
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
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, { ...testEnv, apiToken: "env-invalid-token" });
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.error, {
          code: "AUTHENTICATION_ERROR",
          slug: "authentication-required",
          registrySlug: "authentication-required",
          message: "Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.",
        });
        assertEquals(requestedAuth, ["Bearer env-invalid-token"]);
        assertEquals(output.join("\n").includes("stored@example.com"), false);
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

    it("uses a valid stored login before a rejected project dotenv token in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const originalToken = getEnv("VERYFRONT_API_TOKEN");
      const output: string[] = [];
      const errors: string[] = [];
      const requestedAuth: string[] = [];
      const envDir = await makeTempDir({ prefix: "login-dotenv-token-" });
      await saveToken("stored-valid-token", testEnv);

      try {
        deleteEnv("VERYFRONT_API_TOKEN");
        await Deno.writeTextFile(
          `${envDir}/.env`,
          "VERYFRONT_API_TOKEN=env-file-invalid-token\n",
        );
        const { __resetEnvLoaderForTests, loadEnv } = await import(
          "veryfront/utils/env-loader"
        );
        __resetEnvLoaderForTests();
        await loadEnv({ cwd: envDir });

        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer env-file-invalid-token") {
            return Promise.resolve(new Response(null, { status: 401 }));
          }
          return Promise.resolve(
            Response.json({ id: "user-123", email: "stored@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, {
          ...testEnv,
          apiToken: "env-file-invalid-token",
        });
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, { id: "user-123", email: "stored@example.com" });
        assertEquals(envelope.data, {
          id: "user-123",
          email: "stored@example.com",
          source: "token-store",
        });
        assertEquals(requestedAuth, ["Bearer stored-valid-token"]);
        assertEquals(output.join("\n").includes("env-file-invalid-token"), false);
        assertEquals(output.join("\n").includes("stored-valid-token"), false);
        assertEquals(errors, []);
      } finally {
        const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
        const { setJsonMode } = await import("../shared/json-output.ts");
        __resetEnvLoaderForTests();
        setJsonMode(false);
        if (originalToken) setEnv("VERYFRONT_API_TOKEN", originalToken);
        else deleteEnv("VERYFRONT_API_TOKEN");
        console.log = originalLog;
        console.error = originalError;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
        await remove(envDir, { recursive: true });
      }
    });

    for (const outage of STORED_CREDENTIAL_OUTAGES) {
      it(`does not accept a project dotenv token after stored validation hits ${outage.name}`, async () => {
        const originalFetch = globalThis.fetch;
        const originalLog = console.log;
        const originalError = console.error;
        const originalToken = getEnv("VERYFRONT_API_TOKEN");
        const output: string[] = [];
        const errors: string[] = [];
        const requestedAuth: string[] = [];
        const envDir = await makeTempDir({ prefix: "login-dotenv-outage-" });
        await saveToken("stored-unavailable-token", testEnv);

        try {
          deleteEnv("VERYFRONT_API_TOKEN");
          await Deno.writeTextFile(
            `${envDir}/.env`,
            "VERYFRONT_API_TOKEN=env-file-valid-token\n",
          );
          const { __resetEnvLoaderForTests, loadEnv } = await import(
            "veryfront/utils/env-loader"
          );
          __resetEnvLoaderForTests();
          await loadEnv({ cwd: envDir });

          globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
            const auth = String(new Headers(init?.headers).get("authorization") ?? "");
            requestedAuth.push(auth);
            if (auth === "Bearer stored-unavailable-token") return outage.respond();
            return Promise.resolve(
              Response.json({ id: "env-user", email: "env@example.com" }),
            );
          }) as typeof fetch;
          console.log = (message?: unknown) => output.push(String(message));
          console.error = (message?: unknown) => errors.push(String(message));

          const { setJsonMode } = await import("../shared/json-output.ts");
          const { login } = await import("./login.ts");
          setJsonMode(true);

          const result = await login(
            undefined,
            { ...testEnv, apiToken: "env-file-valid-token" },
            envDir,
          );
          const envelope = JSON.parse(output.join("\n"));

          assertEquals(result, null);
          assertEquals(envelope.success, false);
          assertEquals(envelope.error.slug, outage.expectedLoginSlug);
          assertEquals(requestedAuth, ["Bearer stored-unavailable-token"]);
          assertEquals(await readToken(testEnv), "stored-unavailable-token");
          assertEquals(output.join("\n").includes("env@example.com"), false);
          assertEquals(errors, []);
        } finally {
          const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
          const { setJsonMode } = await import("../shared/json-output.ts");
          __resetEnvLoaderForTests();
          setJsonMode(false);
          if (originalToken) setEnv("VERYFRONT_API_TOKEN", originalToken);
          else deleteEnv("VERYFRONT_API_TOKEN");
          console.log = originalLog;
          console.error = originalError;
          globalThis.fetch = originalFetch;
          resetInteractiveMode();
          await safeDeleteToken();
          await remove(envDir, { recursive: true });
        }
      });
    }

    it("accepts a project dotenv token after a rejected stored login in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const originalToken = getEnv("VERYFRONT_API_TOKEN");
      const output: string[] = [];
      const errors: string[] = [];
      const requestedAuth: string[] = [];
      const envDir = await makeTempDir({ prefix: "login-dotenv-token-" });
      await saveToken("stored-invalid-token", testEnv);

      try {
        deleteEnv("VERYFRONT_API_TOKEN");
        await Deno.writeTextFile(
          `${envDir}/.env`,
          "VERYFRONT_API_TOKEN=env-file-valid-token\n",
        );
        const { __resetEnvLoaderForTests, loadEnv } = await import(
          "veryfront/utils/env-loader"
        );
        __resetEnvLoaderForTests();
        await loadEnv({ cwd: envDir });

        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer stored-invalid-token") {
            return Promise.resolve(new Response(null, { status: 401 }));
          }
          return Promise.resolve(
            Response.json({ id: "env-user", email: "env@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, {
          ...testEnv,
          apiToken: "env-file-valid-token",
        });
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, { id: "env-user", email: "env@example.com" });
        assertEquals(envelope.data, {
          id: "env-user",
          email: "env@example.com",
          source: "env",
        });
        assertEquals(requestedAuth, [
          "Bearer stored-invalid-token",
          "Bearer env-file-valid-token",
        ]);
        assertEquals(output.join("\n").includes("env-file-valid-token"), false);
        assertEquals(output.join("\n").includes("stored-invalid-token"), false);
        assertEquals(errors, []);
        const { resolveConfigWithAuth } = await import("../shared/config.ts");
        const config = await resolveConfigWithAuth(envDir, {
          ...testEnv,
          apiToken: "env-file-valid-token",
          projectSlug: "fallback-project",
        });
        assertEquals(config.apiToken, "env-file-valid-token");
        assertEquals(await readToken(testEnv), null);
      } finally {
        const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
        const { setJsonMode } = await import("../shared/json-output.ts");
        __resetEnvLoaderForTests();
        setJsonMode(false);
        if (originalToken) setEnv("VERYFRONT_API_TOKEN", originalToken);
        else deleteEnv("VERYFRONT_API_TOKEN");
        console.log = originalLog;
        console.error = originalError;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
        await remove(envDir, { recursive: true });
      }
    });

    it("does not accept a stored login after a rejected veryfront.json token in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const requestedAuth: string[] = [];
      const projectDir = await makeTempDir({ prefix: "login-config-token-" });
      await saveToken("stored-valid-token", testEnv);

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({ apiToken: "config-invalid-token", projectSlug: "test-project" }) +
            "\n",
        );

        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer config-invalid-token") {
            return Promise.resolve(new Response(null, { status: 401 }));
          }
          return Promise.resolve(
            Response.json({ id: "stored-user", email: "stored@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await withCwd(projectDir, () => login(undefined, testEnv));
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.error, {
          code: "AUTHENTICATION_ERROR",
          slug: "authentication-required",
          registrySlug: "authentication-required",
          message: "Not logged in. Set VERYFRONT_API_TOKEN or run in interactive mode.",
        });
        assertEquals(requestedAuth, ["Bearer config-invalid-token"]);
        assertEquals(output.join("\n").includes("stored@example.com"), false);
        assertEquals(output.join("\n").includes("config-invalid-token"), false);
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
        await remove(projectDir, { recursive: true });
      }
    });

    it("validates a veryfront.json token against the configured API URL in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const requestedUrls: string[] = [];
      const requestedAuth: string[] = [];
      const projectDir = await makeTempDir({ prefix: "login-config-api-url-" });

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({
            apiToken: "config-valid-token",
            apiUrl: "https://control.example.test/api",
            projectSlug: "test-project",
          }) + "\n",
        );

        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
          requestedUrls.push(String(input));
          requestedAuth.push(String(new Headers(init?.headers).get("authorization") ?? ""));
          if (String(input) === "https://control.example.test/api/me") {
            return Promise.resolve(
              Response.json({ id: "config-user", email: "config@example.com" }),
            );
          }
          return Promise.resolve(new Response(null, { status: 401 }));
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await withCwd(projectDir, () => login(undefined, testEnv));
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, { id: "config-user", email: "config@example.com" });
        assertEquals(envelope.data, {
          id: "config-user",
          email: "config@example.com",
          source: "config-file",
        });
        assertEquals(requestedUrls, ["https://control.example.test/api/me"]);
        assertEquals(requestedAuth, ["Bearer config-valid-token"]);
        assertEquals(output.join("\n").includes("config-valid-token"), false);
        assertEquals(errors, []);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        console.error = originalError;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
        await remove(projectDir, { recursive: true });
      }
    });

    it("does not execute module config while reading veryfront.json preflight settings", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const projectDir = await makeTempDir({ prefix: "login-json-only-config-" });
      const sideEffectPath = `${projectDir}/module-executed.txt`;

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.config.ts`,
          [
            'await Deno.writeTextFile(new URL("./module-executed.txt", import.meta.url), "yes");',
            'export default { projectSlug: "module-project" };',
          ].join("\n"),
        );
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({
            apiToken: "config-valid-token",
            apiUrl: "https://control.example.test/api",
            projectSlug: "json-project",
          }) + "\n",
        );

        globalThis.fetch = (() =>
          Promise.resolve(
            Response.json({ id: "config-user", email: "config@example.com" }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await withCwd(projectDir, () => login(undefined, testEnv));
        const envelope = JSON.parse(output.join("\n"));
        const moduleWasExecuted = await Deno.stat(sideEffectPath).then(() => true, () => false);

        assertEquals(result, { id: "config-user", email: "config@example.com" });
        assertEquals(envelope.data, {
          id: "config-user",
          email: "config@example.com",
          source: "config-file",
        });
        assertEquals(moduleWasExecuted, false);
        assertEquals(output.join("\n").includes("config-valid-token"), false);
        assertEquals(errors, []);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        console.error = originalError;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
        await remove(projectDir, { recursive: true });
      }
    });

    it("validates an environment token against the default API URL, not a veryfront.json apiUrl, in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const requestedUrls: string[] = [];
      const requestedAuth: string[] = [];
      const projectDir = await makeTempDir({ prefix: "login-env-config-api-url-" });

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({
            apiUrl: "https://control.example.test/api",
            projectSlug: "test-project",
          }) + "\n",
        );

        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
          requestedUrls.push(String(input));
          requestedAuth.push(String(new Headers(init?.headers).get("authorization") ?? ""));
          if (String(input) === "https://api.veryfront.com/me") {
            return Promise.resolve(
              Response.json({ id: "env-user", email: "env@example.com" }),
            );
          }
          return Promise.resolve(new Response(null, { status: 401 }));
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await withCwd(
          projectDir,
          () => login(undefined, { ...testEnv, apiToken: "env-valid-token" }),
        );
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, { id: "env-user", email: "env@example.com" });
        assertEquals(envelope.data, {
          id: "env-user",
          email: "env@example.com",
          source: "env",
        });
        assertEquals(requestedUrls, ["https://api.veryfront.com/me"]);
        assertEquals(requestedAuth, ["Bearer env-valid-token"]);
        assertEquals(output.join("\n").includes("env-valid-token"), false);
        assertEquals(errors, []);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        console.error = originalError;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
        await remove(projectDir, { recursive: true });
      }
    });

    it("validates a stored token against the default API URL, not a veryfront.json apiUrl, in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const requestedUrls: string[] = [];
      const requestedAuth: string[] = [];
      const projectDir = await makeTempDir({ prefix: "login-stored-config-api-url-" });
      await saveToken("stored-valid-token", testEnv);

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({
            apiUrl: "https://control.example.test/api",
            projectSlug: "test-project",
          }) + "\n",
        );

        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
          requestedUrls.push(String(input));
          requestedAuth.push(String(new Headers(init?.headers).get("authorization") ?? ""));
          if (String(input) === "https://api.veryfront.com/me") {
            return Promise.resolve(
              Response.json({ id: "stored-user", email: "stored@example.com" }),
            );
          }
          return Promise.resolve(new Response(null, { status: 401 }));
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await withCwd(projectDir, () => login(undefined, testEnv));
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, { id: "stored-user", email: "stored@example.com" });
        assertEquals(envelope.data, {
          id: "stored-user",
          email: "stored@example.com",
          source: "token-store",
        });
        assertEquals(requestedUrls, ["https://api.veryfront.com/me"]);
        assertEquals(requestedAuth, ["Bearer stored-valid-token"]);
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
        await remove(projectDir, { recursive: true });
      }
    });

    it("ignores a schema-invalid veryfront.json token before reporting a stored login in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const requestedAuth: string[] = [];
      const projectDir = await makeTempDir({ prefix: "login-invalid-config-schema-" });
      await saveToken("stored-valid-token", testEnv);

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({ apiToken: "config-invalid-token", projectSlug: 123 }) + "\n",
        );

        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer stored-valid-token") {
            return Promise.resolve(
              Response.json({ id: "stored-user", email: "stored@example.com" }),
            );
          }
          return Promise.resolve(new Response(null, { status: 401 }));
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await withCwd(projectDir, () => login(undefined, testEnv));
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, { id: "stored-user", email: "stored@example.com" });
        assertEquals(envelope.data, {
          id: "stored-user",
          email: "stored@example.com",
          source: "token-store",
        });
        assertEquals(requestedAuth, ["Bearer stored-valid-token"]);
        assertEquals(output.join("\n").includes("config-invalid-token"), false);
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
        await remove(projectDir, { recursive: true });
      }
    });

    it("preserves a malformed environment validation response over a valid stored login in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const requestedAuth: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer env-token") {
            return Promise.resolve(
              new Response("{", {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }
          return Promise.resolve(
            Response.json({ id: "user-123", email: "stored@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, { ...testEnv, apiToken: "env-token" });
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.error, {
          code: "API_CLIENT_ERROR",
          slug: "api-client-error",
          registrySlug: "api-client-error",
          message: "Veryfront API could not validate existing login credentials.",
          context: { status: 200 },
        });
        assertEquals(requestedAuth, ["Bearer env-token"]);
        assertEquals(output.join("\n").includes("stored@example.com"), false);
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

    it("preserves a structurally invalid environment validation response over a valid stored login in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      const requestedAuth: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer env-token") {
            return Promise.resolve(
              Response.json({ error: "upstream unavailable" }),
            );
          }
          return Promise.resolve(
            Response.json({ id: "user-123", email: "stored@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, { ...testEnv, apiToken: "env-token" });
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.error, {
          code: "API_CLIENT_ERROR",
          slug: "api-client-error",
          registrySlug: "api-client-error",
          message: "Veryfront API could not validate existing login credentials.",
          context: { status: 200 },
        });
        assertEquals(requestedAuth, ["Bearer env-token"]);
        assertEquals(output.join("\n").includes("stored@example.com"), false);
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

    it("preserves network failures while decoding an existing login response in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new TypeError("body reset"));
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          )) as typeof fetch;
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
        assertEquals(errors, []);
        assertEquals(await readToken(testEnv), "stored-valid-token");
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

    it("preserves timeout failures while decoding an existing login response in JSON mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalError = console.error;
      const output: string[] = [];
      const errors: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.error(new DOMException("deadline exceeded", "TimeoutError"));
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        console.error = (message?: unknown) => errors.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { login } = await import("./login.ts");
        setJsonMode(true);

        const result = await login(undefined, testEnv);
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope.error, {
          code: "TIMEOUT_ERROR",
          slug: "timeout-error",
          registrySlug: "timeout-error",
          message: "Timed out while checking existing login credentials. Try again.",
        });
        assertEquals(output.join("\n").includes("Enter your API token"), false);
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

    it("does not mask a rejected environment token with a valid stored session", async () => {
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

        assertEquals(result, null);
        assertEquals(requestedAuth, ["Bearer env-invalid-token"]);
        const printed = output.join("\n");
        assertEquals(printed.includes("stored@example.com"), false);
        assertEquals(printed.includes("Enter your API token"), false);
        assertEquals(printed.includes("stored-valid-token"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("does not sign in again under a rejected environment token in human mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalPrompt = globalThis.prompt;
      const output: string[] = [];
      const requestedAuth: string[] = [];

      try {
        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer env-invalid-token") {
            return Promise.resolve(new Response(null, { status: 401 }));
          }
          return Promise.resolve(
            Response.json({ id: "replacement-user", email: "replacement@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        globalThis.prompt = (() => "replacement-token") as typeof prompt;

        const { login } = await import("./login.ts");
        const result = await login(undefined, { ...testEnv, apiToken: "env-invalid-token" });

        assertEquals(result, null);
        assertEquals(requestedAuth, ["Bearer env-invalid-token"]);
        const printed = output.join("\n");
        assertStringIncludes(printed, "VERYFRONT_API_TOKEN was rejected by the Veryfront API.");
        assertStringIncludes(
          printed,
          "Unset VERYFRONT_API_TOKEN or replace the variable before signing in with another method.",
        );
        assertEquals(printed.includes("Enter your API token"), false);
        assertEquals(printed.includes("replacement@example.com"), false);
        assertEquals(await readToken(testEnv), null);
      } finally {
        globalThis.prompt = originalPrompt;
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("does not sign in again under a rejected config-file token in human mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalPrompt = globalThis.prompt;
      const output: string[] = [];
      const requestedAuth: string[] = [];
      const projectDir = await makeTempDir({ prefix: "login-rejected-config-human-" });

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({ apiToken: "config-invalid-token", projectSlug: "test-project" }) +
            "\n",
        );

        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer config-invalid-token") {
            return Promise.resolve(new Response(null, { status: 401 }));
          }
          return Promise.resolve(
            Response.json({ id: "replacement-user", email: "replacement@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        globalThis.prompt = (() => "replacement-token") as typeof prompt;

        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const { login } = await import("./login.ts");
        const result = await withCwd(projectDir, () => login(undefined, testEnv));

        assertEquals(result, null);
        assertEquals(requestedAuth, ["Bearer config-invalid-token"]);
        const printed = output.join("\n");
        assertStringIncludes(
          printed,
          "apiToken from veryfront.json was rejected by the Veryfront API.",
        );
        assertStringIncludes(
          printed,
          "Remove or replace apiToken in veryfront.json before signing in with another method.",
        );
        assertEquals(printed.includes("Enter your API token"), false);
        assertEquals(printed.includes("replacement@example.com"), false);
        assertEquals(await readToken(testEnv), null);
      } finally {
        globalThis.prompt = originalPrompt;
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
        await remove(projectDir, { recursive: true });
      }
    });

    it("stops under an unavailable shell environment token in human mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalPrompt = globalThis.prompt;
      const originalEnvToken = getEnv("VERYFRONT_API_TOKEN");
      const output: string[] = [];
      const requestedAuth: string[] = [];

      try {
        const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
        __resetEnvLoaderForTests();
        setEnv("VERYFRONT_API_TOKEN", "env-timeout-token");
        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          requestedAuth.push(String(new Headers(init?.headers).get("authorization") ?? ""));
          return Promise.reject(new DOMException("deadline exceeded", "TimeoutError"));
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        globalThis.prompt = (() => "replacement-token") as typeof prompt;

        const { login } = await import("./login.ts");
        const result = await login(undefined, { ...testEnv, apiToken: "env-timeout-token" });

        assertEquals(result, null);
        assertEquals(requestedAuth, ["Bearer env-timeout-token"]);
        const printed = output.join("\n");
        assertStringIncludes(
          printed,
          "Timed out while checking VERYFRONT_API_TOKEN with the Veryfront API.",
        );
        assertStringIncludes(
          printed,
          "Try again before signing in with another method.",
        );
        assertStringIncludes(
          printed,
          "Unset VERYFRONT_API_TOKEN before signing in with another method.",
        );
        assertEquals(printed.includes("Enter your API token"), false);
        assertEquals(printed.includes("replacement-token"), false);
        assertEquals(await readToken(testEnv), null);
      } finally {
        const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
        __resetEnvLoaderForTests();
        if (originalEnvToken) setEnv("VERYFRONT_API_TOKEN", originalEnvToken);
        else deleteEnv("VERYFRONT_API_TOKEN");
        globalThis.prompt = originalPrompt;
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("stops under an unreachable shell environment token in human mode", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalPrompt = globalThis.prompt;
      const originalEnvToken = getEnv("VERYFRONT_API_TOKEN");
      const output: string[] = [];
      const requestedAuth: string[] = [];

      try {
        const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
        __resetEnvLoaderForTests();
        setEnv("VERYFRONT_API_TOKEN", "env-network-token");
        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          requestedAuth.push(String(new Headers(init?.headers).get("authorization") ?? ""));
          return Promise.reject(new TypeError("network unavailable"));
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));
        globalThis.prompt = (() => "replacement-token") as typeof prompt;

        const { login } = await import("./login.ts");
        const result = await login(undefined, { ...testEnv, apiToken: "env-network-token" });

        assertEquals(result, null);
        assertEquals(requestedAuth, ["Bearer env-network-token"]);
        const printed = output.join("\n");
        assertStringIncludes(
          printed,
          "Could not reach the Veryfront API while checking VERYFRONT_API_TOKEN.",
        );
        assertStringIncludes(
          printed,
          "Try again before signing in with another method.",
        );
        assertStringIncludes(
          printed,
          "Unset VERYFRONT_API_TOKEN before signing in with another method.",
        );
        assertEquals(printed.includes("Enter your API token"), false);
        assertEquals(printed.includes("replacement-token"), false);
        assertEquals(await readToken(testEnv), null);
      } finally {
        const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
        __resetEnvLoaderForTests();
        if (originalEnvToken) setEnv("VERYFRONT_API_TOKEN", originalEnvToken);
        else deleteEnv("VERYFRONT_API_TOKEN");
        globalThis.prompt = originalPrompt;
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    for (const status of [429, 503]) {
      it(`stops under a ${status} config-file token validation response in human mode`, async () => {
        const originalFetch = globalThis.fetch;
        const originalLog = console.log;
        const originalPrompt = globalThis.prompt;
        const output: string[] = [];
        const requestedAuth: string[] = [];
        const projectDir = await makeTempDir({ prefix: "login-unavailable-config-human-" });

        try {
          await Deno.writeTextFile(
            `${projectDir}/veryfront.json`,
            JSON.stringify({ apiToken: "config-unavailable-token", projectSlug: "test-project" }) +
              "\n",
          );

          globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
            requestedAuth.push(String(new Headers(init?.headers).get("authorization") ?? ""));
            return Promise.resolve(new Response(null, { status }));
          }) as typeof fetch;
          console.log = (message?: unknown) => output.push(String(message));
          globalThis.prompt = (() => "replacement-token") as typeof prompt;

          const { withCwd } = await import("#veryfront/testing/cwd.ts");
          const { login } = await import("./login.ts");
          const result = await withCwd(projectDir, () => login(undefined, testEnv));

          assertEquals(result, null);
          assertEquals(requestedAuth, ["Bearer config-unavailable-token"]);
          const printed = output.join("\n");
          assertStringIncludes(
            printed,
            `Veryfront API could not validate apiToken from veryfront.json (${status}).`,
          );
          assertStringIncludes(
            printed,
            "Try again before signing in with another method.",
          );
          assertStringIncludes(
            printed,
            "Remove or replace apiToken in veryfront.json before signing in with another method.",
          );
          assertEquals(printed.includes("Enter your API token"), false);
          assertEquals(printed.includes("replacement-token"), false);
          assertEquals(await readToken(testEnv), null);
        } finally {
          globalThis.prompt = originalPrompt;
          console.log = originalLog;
          globalThis.fetch = originalFetch;
          resetInteractiveMode();
          await safeDeleteToken();
          await remove(projectDir, { recursive: true });
        }
      });
    }

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

    it("mentions config-file credentials when explaining environment account switching", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const requestedAuth: string[] = [];
      const projectDir = await makeTempDir({ prefix: "login-env-config-guidance-" });

      try {
        setNonInteractive(true);
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({ apiToken: "config-valid-token", projectSlug: "test-project" }) +
            "\n",
        );
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

        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const { login } = await import("./login.ts");
        const result = await withCwd(
          projectDir,
          () => login(undefined, { ...testEnv, apiToken: "vf_env_only" }),
        );

        assertEquals(result, { authenticated: true, type: "apiKey" });
        assertEquals(requestedAuth, ["Bearer vf_env_only"]);
        const printed = output.join("\n");
        assertStringIncludes(
          printed,
          "Unset VERYFRONT_API_TOKEN before using another login method",
        );
        assertStringIncludes(
          printed,
          "Remove or replace apiToken in veryfront.json after unsetting VERYFRONT_API_TOKEN.",
        );
        assertEquals(printed.includes("vf_env_only"), false);
        assertEquals(printed.includes("config-valid-token"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
        await remove(projectDir, { recursive: true });
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

    it("rethrows unexpected existing-session validation failures", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        globalThis.fetch = (() =>
          Promise.reject(new Error("unexpected existing-session failure"))) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { login } = await import("./login.ts");

        await assertRejects(
          () => login(undefined, testEnv),
          Error,
          "unexpected existing-session failure",
        );
        assertEquals(output.join("\n").includes("Not logged in"), false);
        assertEquals(output.join("\n").includes("Enter your API token"), false);
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
        let timer: number | undefined;
        try {
          const outcome = await Promise.race([
            login(undefined, testEnv),
            new Promise((resolve) => {
              timer = setTimeout(() =>
                resolve("TIMED_OUT"), 3000);
            }),
          ]);

          assertEquals(outcome, null);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
        }
      } finally {
        const { __setExistingSessionTimeoutForTests } = await import("./login.ts");
        __setExistingSessionTimeoutForTests();
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("does not start stored validation after a rejected environment credential", async () => {
      const originalFetch = globalThis.fetch;
      const signals: AbortSignal[] = [];
      await saveToken("stored-valid-token", testEnv);

      try {
        setNonInteractive(true);
        const { __setExistingSessionTimeoutForTests } = await import("./login.ts");
        __setExistingSessionTimeoutForTests(50);

        globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          if (init?.signal) signals.push(init.signal);
          if (auth === "Bearer env-token") {
            return Promise.resolve(new Response(null, { status: 401 }));
          }
          return new Promise((_resolve, reject) => {
            const signal = init?.signal;
            if (!signal) {
              return;
            }
            const rejectAbort = () =>
              reject(new DOMException("The signal has been aborted", "AbortError"));
            if (signal.aborted) {
              rejectAbort();
            } else signal.addEventListener("abort", rejectAbort, { once: true });
          });
        }) as typeof fetch;

        const { login } = await import("./login.ts");
        const result = await login(undefined, { ...testEnv, apiToken: "env-token" });

        assertEquals(result, null);
        assertEquals(signals.length, 1);
      } finally {
        const { __setExistingSessionTimeoutForTests } = await import("./login.ts");
        __setExistingSessionTimeoutForTests();
        globalThis.fetch = originalFetch;
        resetInteractiveMode();
        await safeDeleteToken();
      }
    });

    it("rejects explicit login methods as login JSON without prompting", async () => {
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

        const result = await login("token", testEnv);
        const envelope = JSON.parse(output.join("\n"));

        assertEquals(result, null);
        assertEquals(envelope, {
          success: false,
          command: "login",
          error: {
            code: "USAGE_ERROR",
            slug: "invalid-arguments",
            registrySlug: "invalid-argument",
            message: "Explicit login methods are not supported with --json.",
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

    it("falls back to a valid project dotenv credential after a rejected stored session", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const originalToken = getEnv("VERYFRONT_API_TOKEN");
      const output: string[] = [];
      const envDir = await makeTempDir({ prefix: "whoami-dotenv-fallback-" });
      const requestedAuth: string[] = [];
      await saveToken("stored-invalid-token", testEnv);

      try {
        deleteEnv("VERYFRONT_API_TOKEN");
        await Deno.writeTextFile(
          `${envDir}/.env`,
          "VERYFRONT_API_TOKEN=env-file-valid-token\n",
        );
        const { __resetEnvLoaderForTests, loadEnv } = await import(
          "veryfront/utils/env-loader"
        );
        __resetEnvLoaderForTests();
        await loadEnv({ cwd: envDir });

        globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("authorization") ?? "");
          requestedAuth.push(auth);
          if (auth === "Bearer stored-invalid-token") {
            return Promise.resolve(new Response(null, { status: 401 }));
          }
          return Promise.resolve(
            Response.json({ id: "env-user", email: "env@example.com" }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { whoami } = await import("./login.ts");
        const user = await whoami({
          ...testEnv,
          apiToken: "env-file-valid-token",
        });

        assertEquals(user, { id: "env-user", email: "env@example.com" });
        assertEquals(requestedAuth, [
          "Bearer stored-invalid-token",
          "Bearer env-file-valid-token",
        ]);
        const printed = output.join("\n");
        assertStringIncludes(printed, "env@example.com");
        assertStringIncludes(printed, ".env");
        assertEquals(printed.includes("env-file-valid-token"), false);
        assertEquals(printed.includes("stored-invalid-token"), false);
        const { resolveConfigWithAuth } = await import("../shared/config.ts");
        const config = await resolveConfigWithAuth(envDir, {
          ...testEnv,
          apiToken: "env-file-valid-token",
          projectSlug: "fallback-project",
        });
        assertEquals(config.apiToken, "env-file-valid-token");
        assertEquals(await readToken(testEnv), null);
      } finally {
        const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
        __resetEnvLoaderForTests();
        if (originalToken) setEnv("VERYFRONT_API_TOKEN", originalToken);
        else deleteEnv("VERYFRONT_API_TOKEN");
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        await safeDeleteToken();
        await remove(envDir, { recursive: true });
      }
    });

    it("retains a stored session when credential validation is unavailable", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      await saveToken("stored-unavailable-token", testEnv);

      try {
        globalThis.fetch = (() =>
          Promise.reject(new TypeError("network unavailable"))) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { whoami } = await import("./login.ts");
        assertEquals(await whoami(testEnv), null);
        assertEquals(await readToken(testEnv), "stored-unavailable-token");
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        await safeDeleteToken();
      }
    });

    for (const outage of STORED_CREDENTIAL_OUTAGES) {
      it(`does not report a project dotenv identity after stored validation hits ${outage.name}`, async () => {
        const originalFetch = globalThis.fetch;
        const originalLog = console.log;
        const originalToken = getEnv("VERYFRONT_API_TOKEN");
        const output: string[] = [];
        const requestedAuth: string[] = [];
        const envDir = await makeTempDir({ prefix: "whoami-dotenv-outage-" });
        await saveToken("stored-unavailable-token", testEnv);

        try {
          deleteEnv("VERYFRONT_API_TOKEN");
          await Deno.writeTextFile(
            `${envDir}/.env`,
            "VERYFRONT_API_TOKEN=env-file-valid-token\n",
          );
          const { __resetEnvLoaderForTests, loadEnv } = await import(
            "veryfront/utils/env-loader"
          );
          __resetEnvLoaderForTests();
          await loadEnv({ cwd: envDir });

          globalThis.fetch = ((_: string | URL | Request, init?: RequestInit) => {
            const auth = String(new Headers(init?.headers).get("authorization") ?? "");
            requestedAuth.push(auth);
            if (auth === "Bearer stored-unavailable-token") return outage.respond();
            return Promise.resolve(
              Response.json({ id: "env-user", email: "env@example.com" }),
            );
          }) as typeof fetch;
          console.log = (message?: unknown) => output.push(String(message));

          const { setJsonMode } = await import("../shared/json-output.ts");
          const { whoami } = await import("./login.ts");
          setJsonMode(true);

          const result = await whoami({
            ...testEnv,
            apiToken: "env-file-valid-token",
          });
          const envelope = JSON.parse(output.join("\n"));

          assertEquals(result, null);
          assertEquals(envelope.data, { authenticated: false });
          assertEquals(requestedAuth, ["Bearer stored-unavailable-token"]);
          assertEquals(await readToken(testEnv), "stored-unavailable-token");
          assertEquals(output.join("\n").includes("env@example.com"), false);
        } finally {
          const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");
          const { setJsonMode } = await import("../shared/json-output.ts");
          __resetEnvLoaderForTests();
          setJsonMode(false);
          if (originalToken) setEnv("VERYFRONT_API_TOKEN", originalToken);
          else deleteEnv("VERYFRONT_API_TOKEN");
          console.log = originalLog;
          globalThis.fetch = originalFetch;
          await safeDeleteToken();
          await remove(envDir, { recursive: true });
        }
      });
    }

    it("reports a veryfront.json API key in human mode without exposing it", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const projectDir = await makeTempDir({ prefix: "whoami-config-human-" });
      const markerPath = `${projectDir}/executed-module-config`;
      let requestedUrl = "";
      let requestedAuth = "";

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.config.ts`,
          `await Deno.writeTextFile(${
            JSON.stringify(markerPath)
          }, "executed");\nexport default { projectSlug: "module-project" };\n`,
        );
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({
            apiToken: "vf_config_human_secret",
            apiUrl: "https://config-whoami.example.test",
            projectSlug: "json-project",
          }) + "\n",
        );
        globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
          requestedUrl = String(input);
          requestedAuth = String(new Headers(init?.headers).get("Authorization"));
          return Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { whoami } = await import("./login.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        const result = await withCwd(projectDir, () => whoami(testEnv));

        assertEquals(result, { authenticated: true, type: "apiKey" });
        assertEquals(requestedUrl, "https://config-whoami.example.test/projects?limit=1");
        assertEquals(requestedAuth, "Bearer vf_config_human_secret");
        const printed = output.join("\n");
        assertStringIncludes(printed, "Authenticated with an API key");
        assertStringIncludes(printed, "apiToken from veryfront.json");
        assertEquals(printed.includes("vf_config_human_secret"), false);
        assertEquals(await Deno.stat(markerPath).then(() => true).catch(() => false), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("reports a veryfront.json API key in JSON mode with config-file source", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const projectDir = await makeTempDir({ prefix: "whoami-config-json-" });
      let requestedAuth = "";

      try {
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({
            apiToken: "vf_config_json_secret",
            apiUrl: "https://config-whoami-json.example.test",
            projectSlug: "json-project",
          }) + "\n",
        );
        globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
          requestedAuth = String(new Headers(init?.headers).get("Authorization"));
          return Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { whoami } = await import("./login.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        setJsonMode(true);
        const result = await withCwd(projectDir, () => whoami(testEnv));

        assertEquals(result, { authenticated: true, type: "apiKey" });
        assertEquals(requestedAuth, "Bearer vf_config_json_secret");
        const envelope = JSON.parse(output.join("\n"));
        assertEquals(envelope.command, "whoami");
        assertEquals(envelope.data, {
          authenticated: true,
          credential_type: "api_key",
          source: "config-file",
        });
        assertEquals(output.join("\n").includes("vf_config_json_secret"), false);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        await Deno.remove(projectDir, { recursive: true });
      }
    });

    it("uses veryfront.json before a stored credential and does not fall through when rejected", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const projectDir = await makeTempDir({ prefix: "whoami-config-precedence-" });
      const requestedAuth: string[] = [];

      try {
        await saveToken("stored-valid-token", testEnv);
        await Deno.writeTextFile(
          `${projectDir}/veryfront.json`,
          JSON.stringify({ apiToken: "config-invalid-token", projectSlug: "json-project" }) +
            "\n",
        );
        globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
          const auth = String(new Headers(init?.headers).get("Authorization"));
          requestedAuth.push(auth);
          if (auth === "Bearer stored-valid-token") {
            return Promise.resolve(Response.json({ id: "stored-user", email: "stored@test" }));
          }
          return Promise.resolve(new Response(null, { status: 401 }));
        }) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { setJsonMode } = await import("../shared/json-output.ts");
        const { whoami } = await import("./login.ts");
        const { withCwd } = await import("#veryfront/testing/cwd.ts");
        setJsonMode(true);
        const result = await withCwd(projectDir, () => whoami(testEnv));

        assertEquals(result, null);
        assertEquals(requestedAuth, ["Bearer config-invalid-token"]);
        assertEquals(JSON.parse(output.join("\n")).data, { authenticated: false });
        assertEquals(output.join("\n").includes("config-invalid-token"), false);
      } finally {
        const { setJsonMode } = await import("../shared/json-output.ts");
        setJsonMode(false);
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        await Deno.remove(projectDir, { recursive: true });
        await safeDeleteToken();
      }
    });

    it("names the .env file when the token came from one, not just the variable", async () => {
      // A token loaded from a `.env` in the working directory silently overrides
      // the stored login. Reporting only "via VERYFRONT_API_TOKEN" sends the
      // developer to check an environment variable that is genuinely unset.
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const { __resetEnvLoaderForTests, loadEnv } = await import("veryfront/utils/env-loader");
      const envDir = await Deno.makeTempDir({ prefix: "whoami-env-source-" });

      try {
        deleteEnv("VERYFRONT_API_TOKEN");
        __resetEnvLoaderForTests();
        await Deno.writeTextFile(`${envDir}/.env`, "VERYFRONT_API_TOKEN=vf_from_dotenv\n");
        await loadEnv({ cwd: envDir });

        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { whoami } = await import("./login.ts");
        await whoami({
          ...testEnv,
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
          apiToken: "vf_from_dotenv",
        });

        const printed = output.join("\n");
        assertStringIncludes(printed, "VERYFRONT_API_TOKEN");
        assertStringIncludes(printed, ".env");
        // Never leak the token itself, and never print an absolute machine path.
        assertEquals(printed.includes("vf_from_dotenv"), false);
        assertEquals(printed.includes(envDir), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        __resetEnvLoaderForTests();
        deleteEnv("VERYFRONT_API_TOKEN");
        await Deno.remove(envDir, { recursive: true });
      }
    });

    // The case above loads its `.env` from a temp directory outside the working
    // directory, so it exercises the degradation branch, the bare name, and
    // renders ".env" either way. That cannot distinguish a cwd-relative path
    // from a leaked absolute one, so the headline behaviour needs its own case:
    // a file *under* the working directory must render relative to it.
    it("renders a .env under the working directory as a relative path", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const { __resetEnvLoaderForTests, loadEnv } = await import("veryfront/utils/env-loader");
      const { withCwd } = await import("#veryfront/testing/cwd.ts");
      // The working directory moves to a temp tree rather than the repository,
      // and `withCwd` serializes that against every other test in the process.
      // `realPath` first: a macOS temp dir is reached through /var, a symlink to
      // /private/var, and `cwd()` reports the resolved form. Comparing the
      // unresolved path would make the fixture look like it sits outside cwd.
      const root = await Deno.realPath(
        await Deno.makeTempDir({ prefix: "whoami-env-relative-" }),
      );
      const nested = `${root}/config`;

      try {
        deleteEnv("VERYFRONT_API_TOKEN");
        __resetEnvLoaderForTests();
        await Deno.mkdir(nested, { recursive: true });
        await Deno.writeTextFile(`${nested}/.env`, "VERYFRONT_API_TOKEN=vf_nested\n");
        await loadEnv({ cwd: nested });

        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { whoami } = await import("./login.ts");
        await withCwd(root, () =>
          whoami({
            ...testEnv,
            apiBaseUrl: "https://auth.example.test",
            apiUrl: undefined,
            apiToken: "vf_nested",
          }));

        const printed = output.join("\n");
        // Relative to the working directory, and therefore never the absolute
        // path, which is what the bare-name fallback cannot prove.
        assertStringIncludes(printed, "./config/.env");
        assertEquals(printed.includes(root), false);
        assertEquals(printed.includes("vf_nested"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        __resetEnvLoaderForTests();
        deleteEnv("VERYFRONT_API_TOKEN");
        await Deno.remove(root, { recursive: true });
      }
    });

    it("falls back to the .env filename for Windows cross-drive paths", async () => {
      const { formatEnvSourcePathForDisplay } = await import("./login.ts");

      assertEquals(
        formatEnvSourcePathForDisplay(
          "D:/whoami-env-cross-drive/.env",
          "C:/veryfront-project",
        ),
        ".env",
      );
    });

    it("does not attribute an injected API token to a different loaded .env token", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const { __resetEnvLoaderForTests, loadEnv } = await import("veryfront/utils/env-loader");
      const envDir = await Deno.makeTempDir({ prefix: "whoami-env-mismatch-" });

      try {
        deleteEnv("VERYFRONT_API_TOKEN");
        __resetEnvLoaderForTests();
        await Deno.writeTextFile(`${envDir}/.env`, "VERYFRONT_API_TOKEN=vf_from_dotenv\n");
        await loadEnv({ cwd: envDir });

        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { whoami } = await import("./login.ts");
        await whoami({
          ...testEnv,
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
          apiToken: "vf_injected",
        });

        const printed = output.join("\n");
        assertStringIncludes(printed, "(via VERYFRONT_API_TOKEN)");
        assertEquals(printed.includes(".env"), false);
        assertEquals(printed.includes(envDir), false);
        assertEquals(printed.includes("vf_from_dotenv"), false);
        assertEquals(printed.includes("vf_injected"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        __resetEnvLoaderForTests();
        deleteEnv("VERYFRONT_API_TOKEN");
        await Deno.remove(envDir, { recursive: true });
      }
    });

    it("still reports a real environment variable without inventing a file", async () => {
      const originalFetch = globalThis.fetch;
      const originalLog = console.log;
      const output: string[] = [];
      const { __resetEnvLoaderForTests } = await import("veryfront/utils/env-loader");

      try {
        __resetEnvLoaderForTests();
        setEnv("VERYFRONT_API_TOKEN", "vf_from_process");

        globalThis.fetch = (() =>
          Promise.resolve(
            new Response(JSON.stringify({ data: [], page_info: {} }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          )) as typeof fetch;
        console.log = (message?: unknown) => output.push(String(message));

        const { whoami } = await import("./login.ts");
        await whoami({
          ...testEnv,
          apiBaseUrl: "https://auth.example.test",
          apiUrl: undefined,
          apiToken: "vf_from_process",
        });

        const printed = output.join("\n");
        assertStringIncludes(printed, "VERYFRONT_API_TOKEN");
        assertEquals(printed.includes(".env"), false);
      } finally {
        console.log = originalLog;
        globalThis.fetch = originalFetch;
        __resetEnvLoaderForTests();
        deleteEnv("VERYFRONT_API_TOKEN");
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
