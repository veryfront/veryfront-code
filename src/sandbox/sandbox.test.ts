import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  deleteHostSecret,
  markEnvFileValue,
  setHostSecret,
} from "#veryfront/platform/compat/process/env.ts";
import {
  type FetchCall,
  headerValue,
  installMockFetch as createSandboxFetchMock,
  jsonBody,
  jsonResponse,
  type MockResponseEntry,
  mockTimers,
  ndjsonResponse,
  restoreTimers,
  SANDBOX_ENV_KEYS,
  textResponse,
} from "./sandbox.test-helpers.ts";
import {
  installMockFetch as installHostMockFetch,
  restoreMockFetch as restoreHostMockFetch,
} from "#veryfront/testing/mock-fetch.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { runWithProjectEnv } from "../server/project-env/storage.ts";
import { VeryfrontError } from "#veryfront/errors";
import type { ExecStreamEvent } from "./sandbox.ts";
import { Sandbox, waitForSandboxReady } from "./sandbox.ts";
import { resolveDefaultSandboxRuntimeEndpoint } from "./lazy-sandbox.ts";
import { logger } from "#veryfront/utils/logger/logger.ts";
import { __resetEnvLoaderForTests } from "#veryfront/utils/env-loader.ts";
import { __runWithOutboundFetchTransportForTests } from "#veryfront/security/http/outbound-fetch.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";

// Mock fetch for testing
let fetchCalls: FetchCall[] = [];
let fetchResponses: MockResponseEntry[] = [];

function clearSandboxEnvironment(): void {
  for (const key of SANDBOX_ENV_KEYS) deleteEnv(key);
}

function mockFetch(responses: MockResponseEntry[]) {
  fetchResponses = [...responses];
  fetchCalls = [];
  installHostMockFetch(createSandboxFetchMock({ calls: fetchCalls, responses: fetchResponses }));
}

async function countTextDecoderFlushes(action: () => Promise<void>): Promise<number> {
  const originalDecode = TextDecoder.prototype.decode;
  let flushCount = 0;

  TextDecoder.prototype.decode = function (
    ...args: Parameters<TextDecoder["decode"]>
  ): string {
    if (args.length === 0 || args[0] === undefined) {
      flushCount += 1;
    }
    return Reflect.apply(originalDecode, this, args);
  };

  try {
    await action();
    return flushCount;
  } finally {
    TextDecoder.prototype.decode = originalDecode;
  }
}

describe("Sandbox", () => {
  beforeEach(() => {
    __resetEnvLoaderForTests();
    clearSandboxEnvironment();
    fetchCalls = [];
    fetchResponses = [];
  });

  afterEach(() => {
    restoreTimers();
    restoreHostMockFetch();
    clearSandboxEnvironment();
    deleteHostSecret("VERYFRONT_API_TOKEN");
    __resetEnvLoaderForTests();
  });

  it("does not expose ambient authentication through a static class method", () => {
    setEnv("VERYFRONT_API_URL", "https://api.test.com");
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

    assertEquals(
      (Sandbox as unknown as Record<string, unknown>).resolveAuthToken,
      undefined,
    );
    assertEquals((Sandbox as unknown as Record<string, unknown>).waitForReady, undefined);
  });

  it("does not expose lazy credential-bearing dispatch", () => {
    const sandbox = Sandbox.createLazy({
      authToken: "explicit-token",
      apiUrl: "https://api.test.com",
    });
    assertEquals((sandbox as unknown as Record<string, unknown>).fetchControl, undefined);
    assertEquals((sandbox as unknown as Record<string, unknown>).fetchExecStart, undefined);
    assertEquals((sandbox as unknown as Record<string, unknown>).resolveDataPlaneRoute, undefined);
    assertEquals(
      (sandbox as unknown as Record<string, unknown>).resolveRuntimeEndpointFor,
      undefined,
    );
  });

  it("keeps the validated API origin in private instance state", async () => {
    setEnv("VERYFRONT_API_URL", "https://api.test.com");
    setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
    mockFetch([
      jsonResponse({
        id: "session-1",
        endpoint: "https://sandbox.example.com",
        status: "running",
      }),
      jsonResponse({ ok: true }),
    ]);
    const sandbox = await Sandbox.create();

    (sandbox as unknown as { apiUrl: string }).apiUrl = "https://attacker.example";
    await sandbox.heartbeat();

    assertEquals(fetchCalls[1]?.url, "https://api.test.com/sandbox-sessions/session-1/heartbeat");
    assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer stored-login-token");
  });

  describe("create()", () => {
    it("should create a sandbox and return instance", async () => {
      mockFetch([
        jsonResponse({
          id: "session-1",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);

      const sandbox = await Sandbox.create({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
      });
      assertEquals(sandbox.id, "session-1");
      assertEquals(sandbox.url, "https://sandbox.example.com");

      assertStringIncludes(fetchCalls[0]!.url, "/sandbox-sessions");
      assertEquals(fetchCalls[0]!.init?.method, "POST");
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer test-token");
      assertEquals(headerValue(fetchCalls, 0, "Content-Type"), "application/json");
      assertEquals(fetchCalls[0]!.init?.body, "{}");
    });

    it("should pass project_id when creating a project-scoped sandbox", async () => {
      mockFetch([
        jsonResponse({
          id: "session-project",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);

      await Sandbox.create({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        projectId: "project-123",
      });

      assertEquals(fetchCalls[0]!.init?.body, JSON.stringify({ project_id: "project-123" }));
    });

    it("should use VERYFRONT_API_TOKEN when authToken is omitted", async () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_env_token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");

      mockFetch([
        jsonResponse({
          id: "session-env-token",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);

      const sandbox = await Sandbox.create();
      assertEquals(sandbox.id, "session-env-token");

      assertStringIncludes(fetchCalls[0]!.url, "https://api.test.com/sandbox-sessions");
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer vf_env_token");
    });

    it("prefers a scoped cloud credential over ambient host auth", async () => {
      setEnv("VERYFRONT_API_TOKEN", "ambient-host-token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      mockFetch([
        jsonResponse({
          id: "session-scoped-token",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);

      const sandbox = await runWithVeryfrontCloudContext(
        {
          apiBaseUrl: "https://api.test.com",
          apiToken: "scoped-cloud-token",
        },
        () => Sandbox.create(),
      );

      assertEquals(sandbox.id, "session-scoped-token");
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer scoped-cloud-token");
    });

    it("rejects a scoped cloud credential on a different explicit origin", async () => {
      await assertRejects(
        () =>
          runWithVeryfrontCloudContext(
            {
              apiBaseUrl: "https://scoped-api.example",
              apiToken: "scoped-cloud-token",
            },
            () => Sandbox.create({ apiUrl: "https://other-api.example" }),
          ),
        Error,
        "Sandbox auth must match the scoped Veryfront API URL",
      );
    });

    it("rejects unrelated ambient credentials for a scoped API URL", async () => {
      setEnv("VERYFRONT_API_TOKEN", "ambient-host-token");
      setEnv("VERYFRONT_API_URL", "https://host-api.example");
      const createWithScopedUrl = () =>
        runWithVeryfrontCloudContext(
          { apiBaseUrl: "https://scoped-api.example" },
          () => Sandbox.create(),
        );

      await assertRejects(
        createWithScopedUrl,
        Error,
        "Sandbox auth must be supplied with the scoped Veryfront API URL",
      );
      await assertRejects(
        () =>
          runWithRequestContext(
            {
              projectSlug: "sandbox-test",
              token: "request-token",
            },
            createWithScopedUrl,
          ),
        Error,
        "Sandbox auth must be supplied with the scoped Veryfront API URL",
      );
    });

    it("pairs project env-file sandbox credentials with their API URL", async () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_project_token");
      setEnv("VERYFRONT_API_URL", "https://project-api.example");
      markEnvFileValue("VERYFRONT_API_TOKEN");
      markEnvFileValue("VERYFRONT_API_URL");
      mockFetch([
        jsonResponse({
          id: "session-project-env",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);

      const sandbox = await Sandbox.create();

      assertEquals(sandbox.id, "session-project-env");
      assertEquals(fetchCalls[0]?.url, "https://project-api.example/sandbox-sessions");
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer vf_project_token");
    });

    it("rejects a stored login token paired with a project env-file sandbox URL", async () => {
      setEnv("VERYFRONT_API_URL", "https://project-api.example");
      markEnvFileValue("VERYFRONT_API_URL");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

      await assertRejects(
        () => Sandbox.create(),
        VeryfrontError,
        "Sandbox auth must be provided explicitly for a custom API URL",
      );
      assertEquals(fetchCalls, []);
    });

    it("rejects a stored login token when a blank env-file token marks the project URL", async () => {
      setEnv("VERYFRONT_API_TOKEN", "   ");
      setEnv("VERYFRONT_API_URL", "https://project-api.example");
      markEnvFileValue("VERYFRONT_API_TOKEN");
      markEnvFileValue("VERYFRONT_API_URL");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");

      await assertRejects(
        () => Sandbox.create(),
        VeryfrontError,
        "Sandbox auth must be provided explicitly for a custom API URL",
      );
      assertEquals(fetchCalls, []);
    });

    it("should prefer request-scoped credentials over VERYFRONT_API_TOKEN", async () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_env_token");

      mockFetch([
        jsonResponse({
          id: "session-request-token",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);

      await runWithRequestContext(
        {
          projectSlug: "sandbox-test",
          token: "vf_request_token",
        },
        async () => {
          const sandbox = await Sandbox.create({ apiUrl: "https://api.test.com" });
          assertEquals(sandbox.id, "session-request-token");
        },
      );

      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer vf_request_token");
    });

    it("should let explicit authToken override bootstrap auth", async () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_env_token");

      mockFetch([
        jsonResponse({
          id: "session-explicit-token",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);

      const sandbox = await Sandbox.create({
        authToken: "vf_explicit_token",
        apiUrl: "https://api.test.com",
      });
      assertEquals(sandbox.id, "session-explicit-token");

      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer vf_explicit_token");
    });

    it("does not send a stored login token to a caller-selected API origin", async () => {
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      try {
        await assertRejects(
          () => Sandbox.create({ apiUrl: "https://caller-selected.example" }),
          VeryfrontError,
          "Sandbox auth must be provided explicitly for a custom API URL",
        );
      } finally {
        deleteHostSecret("VERYFRONT_API_TOKEN");
      }
      assertEquals(fetchCalls, []);
    });

    it("uses the captured URL origin getter for stored-login trust", async () => {
      const originalOrigin = Object.getOwnPropertyDescriptor(URL.prototype, "origin");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      Object.defineProperty(URL.prototype, "origin", {
        get: () => "https://forged.example",
        configurable: true,
      });
      try {
        await assertRejects(
          () => Sandbox.create({ apiUrl: "https://caller-selected.example" }),
          VeryfrontError,
          "Sandbox auth must be provided explicitly for a custom API URL",
        );
      } finally {
        deleteHostSecret("VERYFRONT_API_TOKEN");
        if (originalOrigin) Object.defineProperty(URL.prototype, "origin", originalOrigin);
      }
      assertEquals(fetchCalls, []);
    });

    it("keeps stored-login sandbox auth on the host transport", async () => {
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      mockFetch([
        jsonResponse({
          id: "session-host-transport",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);
      let ambientFetchCalled = false;
      globalThis.fetch = () => {
        ambientFetchCalled = true;
        return Promise.reject(new Error("project fetch must not receive sandbox auth"));
      };
      try {
        const sandbox = await Sandbox.create();
        assertEquals(sandbox.id, "session-host-transport");
        assertEquals(Object.hasOwn(sandbox, "authToken"), false);
      } finally {
        deleteHostSecret("VERYFRONT_API_TOKEN");
      }

      assertEquals(ambientFetchCalled, false);
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer stored-login-token");
    });

    it("keeps a stored login token off the sandbox objects handed to project code", async () => {
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      mockFetch([
        textResponse("attached body"),
        ndjsonResponse([{ type: "exit", exitCode: 0 }]),
      ]);

      try {
        // Both entry points hand a live object back with no request made, and a
        // TypeScript `private` field is compile-time only: a served project can
        // read an own property straight off the instance.
        const lazy = Sandbox.createLazy();
        const attached = Sandbox.attach({
          id: "attached-host-secret",
          endpoint: "https://attached.example.com",
        });

        for (const instance of [lazy, attached] as unknown as Record<string, unknown>[]) {
          assertEquals(instance.authToken, undefined);
          const ownValues = Object.getOwnPropertyNames(instance).map((name) => instance[name]);
          assertEquals(ownValues.includes("stored-login-token"), false);
        }

        let replacementExecCalled = false;
        const exposed = attached as unknown as Record<string, unknown>;
        exposed.resolveDataPlaneRoute = () => ({
          baseUrl: "https://attacker.example",
          kind: "internal",
        });
        exposed.fetchExecStart = () => {
          replacementExecCalled = true;
          return Promise.resolve(ndjsonResponse([{ type: "exit", exitCode: 0 }]));
        };

        // The credential is still bound to the instance for framework use.
        assertEquals(await attached.readFile("/workspace/note.txt"), "attached body");
        assertEquals((await attached.executeCommand("true")).exitCode, 0);
        assertEquals(replacementExecCalled, false);
        assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer stored-login-token");
        assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer stored-login-token");
        assertEquals(fetchCalls.some((call) => call.url.includes("attacker.example")), false);
      } finally {
        deleteHostSecret("VERYFRONT_API_TOKEN");
      }
    });

    it("uses the captured URL constructor for stored-login sandbox transport", async () => {
      const NativeURL = globalThis.URL;
      const requests: string[] = [];
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      installHostMockFetch((input) => {
        requests.push(String(input));
        return Promise.resolve(Response.json({
          id: "session-native-url",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }));
      });
      class ProjectURL extends NativeURL {
        constructor(_url: string | URL, _base?: string | URL) {
          super("https://project-controlled.example");
        }
      }
      Object.defineProperty(globalThis, "URL", {
        value: ProjectURL,
        configurable: true,
        writable: true,
      });
      try {
        const sandbox = await Sandbox.create();
        assertEquals(sandbox.id, "session-native-url");
      } finally {
        Object.defineProperty(globalThis, "URL", {
          value: NativeURL,
          configurable: true,
          writable: true,
        });
        deleteHostSecret("VERYFRONT_API_TOKEN");
      }

      assertEquals(requests, ["https://api.test.com/sandbox-sessions"]);
    });

    it("should poll until ready when not running", async () => {
      mockTimers();
      mockFetch([
        jsonResponse({
          id: "session-2",
          endpoint: "https://sandbox.example.com",
          status: "starting",
        }),
        jsonResponse({
          id: "session-2",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);

      const sandbox = await Sandbox.create({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
      });
      assertEquals(sandbox.id, "session-2");
      assertEquals(fetchCalls.length, 2);
      assertStringIncludes(fetchCalls[1]!.url, "/sandbox-sessions/session-2");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer test-token");
    });

    it("should throw on creation failure", async () => {
      mockFetch([
        textResponse("Forbidden", 403),
      ]);

      const error = await assertRejects(
        () => Sandbox.create({ authToken: "bad-token", apiUrl: "https://api.test.com" }),
        VeryfrontError,
        "Failed to create sandbox",
      );
      assertEquals(
        (error as VeryfrontError).slug,
        "request-error",
        "sandbox creation failures use the request error contract",
      );
    });

    it("should throw before fetching when no auth is configured", async () => {
      await assertRejects(
        () => Sandbox.create({ apiUrl: "https://api.test.com" }),
        Error,
        "Sandbox auth must be provided explicitly for a custom API URL",
      );

      assertEquals(fetchCalls.length, 0);
    });

    it("should throw when sandbox fails to start", async () => {
      mockTimers();
      mockFetch([
        jsonResponse({
          id: "session-3",
          endpoint: "https://sandbox.example.com",
          status: "pending",
        }),
        jsonResponse({ id: "session-3", status: "error" }),
      ]);

      const error = await assertRejects(
        () => Sandbox.create({ authToken: "test-token", apiUrl: "https://api.test.com" }),
        VeryfrontError,
        "Sandbox failed to start",
      );
      assertEquals(
        (error as VeryfrontError).slug,
        "initialization-error",
        "sandbox startup failures use the initialization error contract",
      );
    });

    it("should throw when the sandbox never becomes ready within the maximum wait", async () => {
      mockTimers({ advanceTimeByMs: true });
      mockFetch([
        jsonResponse({ id: "session-timeout", status: "pending" }),
        jsonResponse({ id: "session-timeout", status: "pending" }),
      ]);

      const error = await assertRejects(
        () =>
          waitForSandboxReady({
            apiUrl: "https://api.test.com",
            id: "session-timeout",
            authToken: "test-token",
            maxWaitMs: 10,
            pollIntervalMs: 5,
          }),
        VeryfrontError,
        "Sandbox did not become ready within timeout",
      );
      assertEquals(
        (error as VeryfrontError).slug,
        "timeout-error",
        "readiness polling that runs out of time uses the timeout error contract",
      );
      assertEquals(
        fetchCalls.length,
        2,
        "readiness polling stops once the maximum wait has elapsed",
      );
    });

    it("should keep polling when a readiness check responds with a non-OK status", async () => {
      mockTimers();
      mockFetch([
        jsonResponse({
          id: "session-flaky",
          endpoint: "https://sandbox.example.com",
          status: "pending",
        }),
        textResponse("unavailable", 503),
        jsonResponse({
          id: "session-flaky",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      ]);

      const sandbox = await Sandbox.create({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
      });

      assertEquals(sandbox.id, "session-flaky");
      assertEquals(
        fetchCalls.length,
        3,
        "a non-OK readiness response is retried instead of failing the creation",
      );
    });

    it("should use host VERYFRONT_API_URL even when project env overlay is active", async () => {
      setEnv("VERYFRONT_API_URL", "https://internal.api.test");
      try {
        mockFetch([
          jsonResponse({
            id: "session-host-env",
            endpoint: "https://sandbox.example.com",
            status: "running",
          }),
        ]);

        await runWithProjectEnv({}, async () => {
          const sandbox = await Sandbox.create({ authToken: "test-token" });
          assertEquals(sandbox.id, "session-host-env");
        });

        assertStringIncludes(fetchCalls[0]!.url, "https://internal.api.test/sandbox-sessions");
      } finally {
        deleteEnv("VERYFRONT_API_URL");
      }
    });
  });

  describe("get()", () => {
    it("should reconnect to existing sandbox", async () => {
      mockFetch([
        jsonResponse({ endpoint: "https://sandbox.example.com" }),
      ]);

      const sandbox = await Sandbox.get("session-existing", {
        authToken: "test-token",
        apiUrl: "https://api.test.com",
      });
      assertEquals(sandbox.id, "session-existing");
      assertEquals(sandbox.url, "https://sandbox.example.com");
      assertStringIncludes(fetchCalls[0]!.url, "/sandbox-sessions/session-existing");
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer test-token");
    });

    it("should reconnect using VERYFRONT_API_TOKEN when authToken is omitted", async () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_env_token");
      setEnv("VERYFRONT_API_URL", "https://api.test.com");

      mockFetch([
        jsonResponse({ endpoint: "https://sandbox.example.com" }),
      ]);

      const sandbox = await Sandbox.get("session-existing", {
        apiUrl: "https://api.test.com",
      });
      assertEquals(sandbox.id, "session-existing");
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer vf_env_token");
    });

    it("should throw when sandbox not found", async () => {
      mockFetch([
        textResponse("Not found", 404),
      ]);

      await assertRejects(
        () =>
          Sandbox.get("nonexistent", { authToken: "test-token", apiUrl: "https://api.test.com" }),
        Error,
        "Failed to get sandbox",
      );
    });
  });

  describe("attach()", () => {
    it("should attach to an already-known sandbox session without a reconnect lookup", async () => {
      mockFetch([
        textResponse("attached body"),
        jsonResponse({ ok: true }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.attach({
        id: "attached-1",
        endpoint: "https://attached.example.com",
        authToken: "attach-token",
        apiUrl: "https://api.test.com",
      });

      assertEquals(sandbox.id, "attached-1");
      assertEquals(sandbox.url, "https://attached.example.com");
      assertEquals(await sandbox.readFile("/workspace/note.txt"), "attached body");
      await sandbox.heartbeat();
      await sandbox.close();

      assertEquals(fetchCalls.length, 3);
      assertEquals(
        fetchCalls[0]!.url,
        "https://api.test.com/sandbox-sessions/attached-1/file?path=%2Fworkspace%2Fnote.txt",
      );
      assertEquals(
        fetchCalls[1]!.url,
        "https://api.test.com/sandbox-sessions/attached-1/heartbeat",
      );
      assertEquals(fetchCalls[2]!.url, "https://api.test.com/sandbox-sessions/attached-1");
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer attach-token");
    });

    it("should resolve authToken and apiUrl from environment when omitted", async () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_attach_env");
      setEnv("VERYFRONT_API_URL", "https://attach.api.test");

      mockFetch([
        textResponse("env body"),
      ]);

      const sandbox = Sandbox.attach({
        id: "attached-env",
        endpoint: "https://attached-env.example.com",
      });

      assertEquals(await sandbox.readFile("/workspace/env.txt"), "env body");
      assertEquals(
        fetchCalls[0]!.url,
        "https://attach.api.test/sandbox-sessions/attached-env/file?path=%2Fworkspace%2Fenv.txt",
      );
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer vf_attach_env");
    });

    it("normalizes a trailing slash in the API URL for proxy routes", async () => {
      mockFetch([
        textResponse("attached body"),
      ]);

      const sandbox = Sandbox.attach({
        id: "attached-trailing-slash",
        endpoint: "https://attached.example.com",
        authToken: "attach-token",
        apiUrl: "https://api.test.com/",
      });

      assertEquals(await sandbox.readFile("/workspace/note.txt"), "attached body");
      assertEquals(
        fetchCalls[0]!.url,
        "https://api.test.com/sandbox-sessions/attached-trailing-slash/file?path=%2Fworkspace%2Fnote.txt",
      );
    });

    it("uses the request error contract for invalid proxy file responses", async () => {
      mockFetch([
        jsonResponse({ path: "/workspace/note.txt" }),
      ]);

      const sandbox = Sandbox.attach({
        id: "attached-invalid-file-response",
        endpoint: "https://attached.example.com",
        authToken: "attach-token",
        apiUrl: "https://api.test.com",
      });

      const error = await assertRejects(
        () => sandbox.readFile("/workspace/note.txt"),
        VeryfrontError,
        "Sandbox file response missing content",
      );
      assertEquals((error as VeryfrontError).slug, "request-error");
    });

    it("uses the request error contract for malformed proxy file JSON", async () => {
      mockFetch([
        new Response("{not json", {
          headers: { "Content-Type": "application/json" },
        }),
      ]);

      const sandbox = Sandbox.attach({
        id: "attached-malformed-file-response",
        endpoint: "https://attached.example.com",
        authToken: "attach-token",
        apiUrl: "https://api.test.com",
      });

      const error = await assertRejects(
        () => sandbox.readFile("/workspace/note.txt"),
        VeryfrontError,
        "Sandbox file response is not valid JSON",
      );
      assertEquals((error as VeryfrontError).slug, "request-error");
    });
  });

  describe("executeCommand()", () => {
    it("should execute command and collect output", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        ndjsonResponse([
          { type: "stdout", data: "hello\n" },
          { type: "exit", exitCode: 0 },
        ]),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const result = await sandbox.executeCommand("echo hello");

      assertEquals(result.stdout, "hello\n");
      assertEquals(result.stderr, "");
      assertEquals(result.exitCode, 0);
      assertEquals(fetchCalls[1]!.init?.method, "POST");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
      assertEquals(headerValue(fetchCalls, 1, "Content-Type"), "application/json");
      assertEquals(jsonBody(fetchCalls, 1), { command: "echo hello" });
    });

    it("should collect stderr output", async () => {
      mockFetch([
        jsonResponse({ id: "s2", endpoint: "https://sb.test", status: "running" }),
        ndjsonResponse([
          { type: "stderr", data: "error occurred\n" },
          { type: "exit", exitCode: 1 },
        ]),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const result = await sandbox.executeCommand("failing-cmd");

      assertEquals(result.stdout, "");
      assertEquals(result.stderr, "error occurred\n");
      assertEquals(result.exitCode, 1);
      assertEquals(jsonBody(fetchCalls, 1), { command: "failing-cmd" });
    });

    it("should fail closed when the stream ends without an exit event", async () => {
      mockFetch([
        jsonResponse({ id: "s3", endpoint: "https://sb.test", status: "running" }),
        ndjsonResponse([
          { type: "stdout", data: "partial" },
        ]),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const result = await sandbox.executeCommand("truncated-cmd");

      assertEquals(
        result.stdout,
        "partial",
        "output received before the stream ended is still returned",
      );
      assertEquals(
        result.exitCode,
        1,
        "a stream that ends without an exit event must fail closed",
      );
    });

    it("should fail closed when the exit event carries no exit code", async () => {
      mockFetch([
        jsonResponse({ id: "s4", endpoint: "https://sb.test", status: "running" }),
        ndjsonResponse([
          { type: "stdout", data: "done\n" },
          { type: "exit" },
        ]),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const result = await sandbox.executeCommand("exitless-cmd");

      assertEquals(
        result.exitCode,
        1,
        "an exit event without an exitCode must fail closed",
      );
    });

    it("should fail closed for a lazy sandbox stream that ends without an exit event", async () => {
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        ndjsonResponse([
          { type: "stdout", data: "partial" },
        ]),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
      });

      try {
        const result = await sandbox.executeCommand("truncated-cmd");

        assertEquals(
          result.stdout,
          "partial",
          "output received before the lazy stream ended is still returned",
        );
        assertEquals(
          result.exitCode,
          1,
          "a lazy stream that ends without an exit event must fail closed",
        );
      } finally {
        await sandbox.close();
      }
    });
  });

  describe("executeStream()", () => {
    it("should stream events directly", async () => {
      mockFetch([
        jsonResponse({ id: "stream-1", endpoint: "https://sb.test", status: "running" }),
        ndjsonResponse([
          { type: "stdout", data: "line1\n" },
          { type: "stderr", data: "warn\n" },
          { type: "exit", exitCode: 0 },
        ]),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const events: ExecStreamEvent[] = [];
      for await (const event of sandbox.executeStream("cmd")) {
        events.push(event);
      }

      assertEquals(events.length, 3);
      assertEquals(events[0]!.type, "stdout");
      assertEquals(events[0]!.data, "line1\n");
      assertEquals(events[1]!.type, "stderr");
      assertEquals(events[2]!.type, "exit");
      assertEquals(events[2]!.exitCode, 0);
      assertEquals(fetchCalls[1]!.init?.method, "POST");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
      assertEquals(headerValue(fetchCalls, 1, "Content-Type"), "application/json");
      assertEquals(jsonBody(fetchCalls, 1), { command: "cmd" });
    });

    it("should throw on non-OK response", async () => {
      mockFetch([
        jsonResponse({ id: "stream-2", endpoint: "https://sb.test", status: "running" }),
        textResponse("Internal Server Error", 500),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        async () => {
          for await (const _event of sandbox.executeStream("bad-cmd")) {
            // consume
          }
        },
        Error,
        "Exec failed",
      );
      assertEquals(jsonBody(fetchCalls, 1), { command: "bad-cmd" });
    });

    it("should handle chunked NDJSON delivery", async () => {
      // Simulate a response where JSON lines are split across chunks
      const chunk1 = '{"type":"stdout","data":"part1\\n"}\n{"type":"stde';
      const chunk2 = 'rr","data":"err\\n"}\n{"type":"exit","exitCode":0}\n';
      const encoder = new TextEncoder();

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(chunk1));
          controller.enqueue(encoder.encode(chunk2));
          controller.close();
        },
      });

      mockFetch([
        jsonResponse({ id: "stream-3", endpoint: "https://sb.test", status: "running" }),
        new Response(stream, { status: 200 }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const events: ExecStreamEvent[] = [];
      for await (const event of sandbox.executeStream("cmd")) {
        events.push(event);
      }

      assertEquals(events.length, 3);
      assertEquals(events[0]!.type, "stdout");
      assertEquals(events[1]!.type, "stderr");
      assertEquals(events[2]!.type, "exit");
      assertEquals(jsonBody(fetchCalls, 1), { command: "cmd" });
    });

    it("should skip malformed NDJSON lines and keep delivering events", async () => {
      const body = '{"type":"stdout","data":"a\\n"}\n' +
        "<<garbage>>\n" +
        '{"type":"exit","exitCode":0}\n' +
        "{truncated";

      mockFetch([
        jsonResponse({ id: "stream-malformed", endpoint: "https://sb.test", status: "running" }),
        new Response(body, { status: 200 }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const result = await sandbox.executeCommand("cmd");

      assertEquals(result.stdout, "a\n", "buffered stdout survives a malformed NDJSON line");
      assertEquals(result.exitCode, 0, "events after a malformed line are still delivered");
    });

    it("should cancel the response body when stream iteration stops early", async () => {
      let cancelCalled = false;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"stdout","data":"first\\n"}\n'));
        },
        cancel() {
          cancelCalled = true;
        },
      });

      mockFetch([
        jsonResponse({ id: "stream-cancel", endpoint: "https://sb.test", status: "running" }),
        new Response(stream, { status: 200 }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const iterator = sandbox.executeStream("cmd");
      const first = await iterator.next();

      assertEquals(first.done, false);
      assertEquals(first.value?.type, "stdout");

      await iterator.return(undefined);

      assertEquals(cancelCalled, true);
      assertEquals(
        fetchCalls[1]!.url,
        "https://api.test.com/sandbox-sessions/stream-cancel/commands/stream",
      );
    });

    it("flushes the decoder after the static command stream completes", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"exit","exitCode":0}'));
          controller.close();
        },
      });

      mockFetch([
        jsonResponse({ id: "stream-flush", endpoint: "https://sb.test", status: "running" }),
        new Response(stream, { status: 200 }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const events: ExecStreamEvent[] = [];
      const flushCount = await countTextDecoderFlushes(async () => {
        for await (const event of sandbox.executeStream("cmd")) {
          events.push(event);
        }
      });

      assertEquals(flushCount, 1);
      assertEquals(events, [{ type: "exit", exitCode: 0 }]);
    });
  });

  describe("executeCommand() with ExecOptions", () => {
    it("should pass cwd, timeout_seconds, and env in the request body", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const result = await sandbox.executeCommand("ls", {
        cwd: "/workspace/app",
        timeout_seconds: 30,
        env: { NODE_ENV: "test" },
        projectReference: "project-123",
      });

      assertEquals(result.stdout, "ok\n");
      assertEquals(result.exitCode, 0);
      assertEquals(jsonBody(fetchCalls, 1), {
        command: "ls",
        cwd: "/workspace/app",
        timeout_seconds: 30,
        env: { NODE_ENV: "test" },
        projectReference: "project-123",
      });
    });

    it("should not include undefined options in request body", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        ndjsonResponse([
          { type: "exit", exitCode: 0 },
        ]),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await sandbox.executeCommand("pwd");

      assertEquals(jsonBody(fetchCalls, 1), { command: "pwd" });
    });
  });

  describe("executeStream() with ExecOptions", () => {
    it("should pass options in the request body", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        ndjsonResponse([
          { type: "stdout", data: "out\n" },
          { type: "exit", exitCode: 0 },
        ]),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const events: ExecStreamEvent[] = [];
      for await (
        const event of sandbox.executeStream("cmd", {
          cwd: "/tmp",
          projectReference: "project-456",
        })
      ) {
        events.push(event);
      }

      assertEquals(events.length, 2);
      assertEquals(jsonBody(fetchCalls, 1), {
        command: "cmd",
        cwd: "/tmp",
        projectReference: "project-456",
      });
    });
  });

  describe("startBackgroundCommand() with ExecOptions", () => {
    it("should pass options in the request body", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "command-opts",
          status: "running",
          exit_code: null,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const command = await sandbox.startBackgroundCommand("npm test", {
        cwd: "/workspace",
        timeout_seconds: 120,
        env: { CI: "true" },
        projectReference: "project-789",
      });

      assertEquals(command.id, "command-opts");
      assertEquals(jsonBody(fetchCalls, 1), {
        command: "npm test",
        cwd: "/workspace",
        timeout_seconds: 120,
        env: { CI: "true" },
        projectReference: "project-789",
      });
    });
  });

  describe("readFile()", () => {
    it("should read a file from sandbox", async () => {
      mockFetch([
        jsonResponse({ id: "s3", endpoint: "https://sb.test", status: "running" }),
        textResponse("file content here"),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const content = await sandbox.readFile("/workspace/test.txt");

      assertEquals(content, "file content here");
      assertStringIncludes(fetchCalls[1]!.url, "/file?path=");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
    });

    it("should throw on read failure", async () => {
      mockFetch([
        jsonResponse({ id: "s4", endpoint: "https://sb.test", status: "running" }),
        textResponse("Not found", 404),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.readFile("/nonexistent"),
        Error,
        "Read file failed",
      );
    });
  });

  describe("writeFiles()", () => {
    it("should write files to sandbox", async () => {
      mockFetch([
        jsonResponse({ id: "s5", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await sandbox.writeFiles([
        { path: "/workspace/a.txt", content: "aaa" },
        { path: "/workspace/b.txt", content: "bbb" },
      ]);

      assertEquals(fetchCalls[1]!.init?.method, "POST");
      assertStringIncludes(fetchCalls[1]!.url, "/files");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
      assertEquals(headerValue(fetchCalls, 1, "Content-Type"), "application/json");
      assertEquals(jsonBody(fetchCalls, 1), {
        files: [
          { path: "/workspace/a.txt", content: "aaa" },
          { path: "/workspace/b.txt", content: "bbb" },
        ],
      });
    });
  });

  describe("heartbeat()", () => {
    it("should send heartbeat request", async () => {
      mockFetch([
        jsonResponse({ id: "s6", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await sandbox.heartbeat();

      assertStringIncludes(fetchCalls[1]!.url, "/sandbox-sessions/s6/heartbeat");
      assertEquals(fetchCalls[1]!.init?.method, "POST");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
    });

    it("should throw on heartbeat failure", async () => {
      mockFetch([
        jsonResponse({ id: "s6", endpoint: "https://sb.test", status: "running" }),
        textResponse("upstream timeout", 503),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });

      await assertRejects(
        () => sandbox.heartbeat(),
        Error,
        "Sandbox heartbeat failed: 503 upstream timeout",
      );
    });
  });

  describe("close()", () => {
    it("should send delete request", async () => {
      mockFetch([
        jsonResponse({ id: "s7", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await sandbox.close();

      assertStringIncludes(fetchCalls[1]!.url, "/sandbox-sessions/s7");
      assertEquals(fetchCalls[1]!.init?.method, "DELETE");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
    });

    it("should throw on close failure", async () => {
      mockFetch([
        jsonResponse({ id: "s7", endpoint: "https://sb.test", status: "running" }),
        textResponse("delete failed", 503),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });

      await assertRejects(
        () => sandbox.close(),
        Error,
        "Close sandbox failed: 503 delete failed",
      );
    });
  });

  describe("resolveDefaultSandboxRuntimeEndpoint()", () => {
    it("keeps public sandbox endpoints outside Kubernetes", () => {
      assertEquals(
        resolveDefaultSandboxRuntimeEndpoint({ endpoint: "https://abc123.sandbox.veryfront.com" }),
        "https://abc123.sandbox.veryfront.com",
      );
    });

    it("routes public sandbox endpoints to their in-cluster service in Kubernetes", () => {
      setEnv("KUBERNETES_SERVICE_HOST", "10.0.0.1");

      assertEquals(
        resolveDefaultSandboxRuntimeEndpoint({ endpoint: "https://abc123.sandbox.veryfront.com" }),
        "http://sandbox.veryfront-sandbox-abc123.svc.cluster.local",
      );
    });

    it("keeps non-matching sandbox endpoints unchanged in Kubernetes", () => {
      setEnv("KUBERNETES_SERVICE_HOST", "10.0.0.1");

      assertEquals(
        resolveDefaultSandboxRuntimeEndpoint({ endpoint: "https://sandbox.example.com" }),
        "https://sandbox.example.com",
      );
    });
  });

  describe("createLazy()", () => {
    it("rejects a custom API origin for a host token carried by request context", async () => {
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      await runWithRequestContext(
        { projectSlug: "project", token: "stored-login-token" },
        async () => {
          await assertRejects(
            async () => {
              Sandbox.createLazy({ apiUrl: "https://attacker.example" });
            },
            Error,
            "Sandbox auth must be provided explicitly for a custom API URL.",
          );
        },
      );
    });

    it("keeps ambient auth out of the public lazy sandbox object", () => {
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      const sandbox = Sandbox.createLazy();

      assertEquals(Object.hasOwn(sandbox, "authToken"), false);
      assertEquals("authToken" in sandbox, false);
      assertEquals((sandbox as unknown as Record<string, unknown>).authHeaders, undefined);
      assertEquals((sandbox as unknown as Record<string, unknown>).jsonHeaders, undefined);
    });

    it("rejects a caller runtime endpoint when authentication is ambient", async () => {
      setEnv("VERYFRONT_API_URL", "https://api.test.com");
      setHostSecret("VERYFRONT_API_TOKEN", "stored-login-token");
      mockFetch([
        jsonResponse({
          id: "session-1",
          endpoint: "https://session-1.sandbox.veryfront.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
      ]);
      const sandbox = Sandbox.createLazy({
        resolveRuntimeEndpoint: () => "https://attacker.example",
        execStartMaxAttempts: 1,
      });

      await assertRejects(
        () => sandbox.executeCommand("echo safe"),
        Error,
        "Custom sandbox runtime endpoints require an explicit authToken",
      );

      assertEquals(
        fetchCalls.some((call) => new URL(call.url).origin === "https://attacker.example"),
        false,
      );
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer stored-login-token");
    });

    it("keeps an explicitly authenticated caller runtime endpoint behind egress policy", async () => {
      const publicAddress = "192.0.2.1";
      const transportFetch: typeof fetch = (input, _init) => {
        const url = String(input);
        if (url === "https://api.test.com/sandbox-sessions") {
          return Promise.resolve(jsonResponse({
            id: "session-1",
            endpoint: "https://session-1.sandbox.veryfront.com",
            status: "running",
          }));
        }
        if (url.startsWith("https://api.test.com/sandbox-sessions/session-1")) {
          return Promise.resolve(jsonResponse({ ok: true }));
        }
        return Promise.resolve(ndjsonResponse([{ type: "exit", exitCode: 0 }]));
      };

      await __runWithOutboundFetchTransportForTests(
        {
          fetch: transportFetch,
          pinnedFetch: (url, _addresses, init) => transportFetch(url, init),
          resolveHost: (hostname) =>
            Promise.resolve(
              hostname === "metadata.internal" ? ["169.254.169.254"] : [publicAddress],
            ),
        },
        async () => {
          const sandbox = Sandbox.createLazy({
            authToken: "test-token",
            apiUrl: "https://api.test.com",
            execStartMaxAttempts: 1,
            resolveRuntimeEndpoint: () => "http://metadata.internal",
          });
          try {
            await assertRejects(
              () => sandbox.executeCommand("true"),
              Error,
              "egress blocked",
            );
          } finally {
            await sandbox.close();
          }
        },
        { allowedResolvedAddresses: [publicAddress] },
      );
    });

    it("waits long enough for pending sandbox sessions to survive operator reconcile lag", async () => {
      mockTimers({ advanceTimeByMs: true });

      let statusChecks = 0;
      installHostMockFetch(
        ((input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;
          fetchCalls.push({ url, init });

          if (url === "https://api.test.com/sandbox-sessions" && init?.method === "POST") {
            return Promise.resolve(jsonResponse({
              id: "sandbox-1",
              endpoint: "https://sandbox.example.com",
              status: "pending",
            }));
          }

          if (
            url === "https://api.test.com/sandbox-sessions/sandbox-1" &&
            (!init?.method || init.method === "GET")
          ) {
            statusChecks += 1;
            return Promise.resolve(jsonResponse({
              endpoint: "https://sandbox.example.com",
              status: statusChecks >= 85 ? "running" : "pending",
            }));
          }

          if (
            url === "https://api.test.com/sandbox-sessions/sandbox-1/heartbeat" &&
            init?.method === "POST"
          ) {
            return Promise.resolve(jsonResponse({ ok: true }));
          }

          if (
            url === "https://api.test.com/sandbox-sessions/sandbox-1/file?path=notes.txt" &&
            (!init?.method || init.method === "GET")
          ) {
            return Promise.resolve(jsonResponse({ path: "notes.txt", content: "file-body" }));
          }

          if (
            url === "https://api.test.com/sandbox-sessions/sandbox-1" && init?.method === "DELETE"
          ) {
            return Promise.resolve(jsonResponse({ ok: true }));
          }

          throw new Error(`Unexpected fetch call: ${url} ${init?.method ?? "GET"}`);
        }) as typeof fetch,
      );

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        heartbeatIntervalMs: 1_000_000,
        controlRequestTimeoutMs: 0,
      });

      const readPromise = sandbox.readFile("notes.txt");
      await Promise.resolve();

      assertEquals(await readPromise, "file-body");
      assertEquals(statusChecks >= 85, true);
      assertEquals(
        fetchCalls.some((call) => call.url.endsWith("/sandbox-sessions/sandbox-1/heartbeat")),
        true,
      );
      assertEquals(
        fetchCalls.some((call) => call.url.endsWith("/file?path=notes.txt")),
        true,
      );
      await sandbox.close();
    });

    it("cleans up failed startup heartbeats and reprovisions on the next attempt", async () => {
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        textResponse("heartbeat failed", 503),
        jsonResponse({ ok: true }),
        jsonResponse({
          id: "sandbox-2",
          endpoint: "https://sandbox-2.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        jsonResponse({ path: "notes.txt", content: "file-body" }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
      });

      await assertRejects(
        () => sandbox.readFile("notes.txt"),
        Error,
        "Sandbox heartbeat failed: 503 heartbeat failed",
      );

      assertEquals(sandbox.isActive, false);
      assertEquals(await sandbox.readFile("notes.txt"), "file-body");
      assertEquals(sandbox.isActive, true);
      assertEquals(
        fetchCalls.some((call) =>
          call.url === "https://api.test.com/sandbox-sessions/sandbox-1" &&
          call.init?.method === "DELETE"
        ),
        true,
      );
      assertEquals(
        fetchCalls.some((call) =>
          call.url === "https://api.test.com/sandbox-sessions/sandbox-2/file?path=notes.txt"
        ),
        true,
      );
      await sandbox.close();
    });

    it("waits for an in-flight ensure before closing the sandbox session", async () => {
      let resolveCreate!: (response: Response) => void;
      let hasResolveCreate = false;

      installHostMockFetch(
        ((input: string | URL | Request, init?: RequestInit) => {
          const url = typeof input === "string"
            ? input
            : input instanceof URL
            ? input.toString()
            : input.url;
          fetchCalls.push({ url, init });

          if (fetchCalls.length === 1) {
            return new Promise<Response>((resolve) => {
              resolveCreate = resolve;
              hasResolveCreate = true;
            });
          }

          if (fetchCalls.length === 2) {
            return Promise.resolve(
              jsonResponse({
                ok: true,
              }),
            );
          }

          if (fetchCalls.length === 3) {
            return Promise.resolve(jsonResponse({ ok: true }));
          }

          throw new Error(`Unexpected fetch call: ${url}`);
        }) as typeof fetch,
      );

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        heartbeatGraceMs: 0,
      });

      const ensurePromise = sandbox.ensure();
      for (let attempt = 0; attempt < 10 && !hasResolveCreate; attempt++) {
        await Promise.resolve();
      }

      const closePromise = sandbox.close();

      if (!hasResolveCreate) {
        throw new Error("Expected create promise resolver to be captured");
      }

      resolveCreate(
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
      );

      await ensurePromise;
      await closePromise;

      assertStringIncludes(fetchCalls[2]!.url, "/sandbox-sessions/sandbox-1");
      assertEquals(fetchCalls[2]!.init?.method, "DELETE");
      assertEquals(sandbox.isActive, false);
    });

    it("logs startup failures observed while close waits for in-flight ensure", async () => {
      let resolveCreate!: (response: Response) => void;
      let hasResolveCreate = false;
      const originalDebug = logger.debug.bind(logger);
      const debugEntries: Array<{ message: string; metadata: unknown[] }> = [];

      logger.debug = (message: string, ...metadata: unknown[]): void => {
        debugEntries.push({ message, metadata });
        originalDebug(message, ...metadata);
      };

      try {
        installHostMockFetch(
          ((input: string | URL | Request, init?: RequestInit) => {
            const url = typeof input === "string"
              ? input
              : input instanceof URL
              ? input.toString()
              : input.url;
            fetchCalls.push({ url, init });

            if (fetchCalls.length === 1) {
              return new Promise<Response>((resolve) => {
                resolveCreate = resolve;
                hasResolveCreate = true;
              });
            }

            throw new Error(`Unexpected fetch call: ${url}`);
          }) as typeof fetch,
        );

        const sandbox = Sandbox.createLazy({
          authToken: "test-token",
          apiUrl: "https://api.test.com",
        });

        const ensurePromise = sandbox.ensure();
        for (let attempt = 0; attempt < 10 && !hasResolveCreate; attempt++) {
          await Promise.resolve();
        }

        const closePromise = sandbox.close();

        if (!hasResolveCreate) {
          throw new Error("Expected create promise resolver to be captured");
        }

        resolveCreate(textResponse("create failed", 503));

        await assertRejects(
          () => ensurePromise,
          Error,
          "Failed to create sandbox",
        );
        await closePromise;

        assertEquals(sandbox.isActive, false);
        assertEquals(
          debugEntries.some((entry) => {
            const metadata = entry.metadata[0] as { error?: unknown } | undefined;
            return entry.message.includes("startup failed while closing") &&
              metadata?.error instanceof Error &&
              metadata.error.message.includes("Failed to create sandbox");
          }),
          true,
          "close should log the already-handled startup failure",
        );
      } finally {
        logger.debug = originalDebug;
      }
    });

    it("keeps an active sandbox session heartbeating until close", async () => {
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      const intervalCallbacks = new Map<number, () => void>();
      let nextIntervalId = 1;

      globalThis.setInterval = ((handler: TimerHandler) => {
        const id = nextIntervalId;
        nextIntervalId += 1;
        if (typeof handler !== "function") {
          throw new Error("Expected heartbeat interval handler to be a function");
        }
        intervalCallbacks.set(id, () => {
          handler();
        });
        return id as ReturnType<typeof setInterval>;
      }) as typeof setInterval;

      globalThis.clearInterval = ((id: number) => {
        intervalCallbacks.delete(id);
      }) as typeof clearInterval;

      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        jsonResponse({ ok: true }),
        textResponse("file-body"),
        jsonResponse({ ok: true }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        heartbeatGraceMs: 0,
      });

      try {
        assertEquals(await sandbox.readFile("notes.txt"), "file-body");
        assertEquals(intervalCallbacks.size, 1);

        await sandbox.heartbeat();
        await sandbox.close();
        const callsAfterClose = fetchCalls.length;

        const heartbeatCalls = fetchCalls.filter((call) =>
          call.url === "https://api.test.com/sandbox-sessions/sandbox-1/heartbeat"
        );

        assertEquals(heartbeatCalls.length, 3);
        assertEquals(fetchCalls.length, callsAfterClose);
        assertEquals(intervalCallbacks.size, 0);
      } finally {
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
      }
    });

    it("forwards projectReference from lazy project context for exec and async commands", async () => {
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        jsonResponse({
          id: "command-1",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:00:01Z",
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        getProjectId: () => "project-123",
      });

      try {
        await sandbox.executeCommand("echo ok");
        await sandbox.startBackgroundCommand("npm test");

        assertEquals(jsonBody(fetchCalls, 2), {
          command: "echo ok",
          projectReference: "project-123",
        });
        assertEquals(jsonBody(fetchCalls, 3), {
          command: "npm test",
          projectReference: "project-123",
        });
      } finally {
        await sandbox.close();
      }
    });

    it("uses the lazy runtime endpoint resolver for exec and async commands", async () => {
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        jsonResponse({
          id: "command-1",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:00:01Z",
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        resolveRuntimeEndpoint: ({ sessionId }) =>
          `http://sandbox.veryfront-sandbox-${sessionId}.svc.cluster.local/`,
      });

      try {
        await sandbox.executeCommand("echo ok");
        await sandbox.startBackgroundCommand("npm test");

        assertEquals(
          fetchCalls[2]!.url,
          "http://sandbox.veryfront-sandbox-sandbox-1.svc.cluster.local/exec",
        );
        assertEquals(
          fetchCalls[3]!.url,
          "http://sandbox.veryfront-sandbox-sandbox-1.svc.cluster.local/exec/commands",
        );
      } finally {
        await sandbox.close();
      }
    });

    it("keeps proxy routing when the runtime endpoint resolver only changes trailing slashes", async () => {
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        resolveRuntimeEndpoint: ({ endpoint }) => `${endpoint}/`,
      });

      try {
        await sandbox.executeCommand("echo ok");

        assertEquals(
          fetchCalls[2]!.url,
          "https://api.test.com/sandbox-sessions/sandbox-1/commands/stream",
        );
      } finally {
        await sandbox.close();
      }
    });

    it("uses API proxy routes for default Kubernetes data-plane calls", async () => {
      setEnv("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc");
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://3912734599.sandbox.veryfront.org",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
      });

      try {
        assertEquals(await sandbox.executeCommand("echo ok"), {
          stdout: "ok\n",
          stderr: "",
          exitCode: 0,
        });

        assertEquals(fetchCalls.map((call) => call.url), [
          "https://api.test.com/sandbox-sessions",
          "https://api.test.com/sandbox-sessions/sandbox-1/heartbeat",
          "https://api.test.com/sandbox-sessions/sandbox-1/commands/stream",
        ]);
      } finally {
        await sandbox.close();
      }
    });

    it("waits for explicit runtime endpoint readiness even when the session is already running", async () => {
      setEnv("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc");
      mockTimers({ advanceTimeByMs: true });
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://3912734599.sandbox.veryfront.org",
          status: "running",
        }),
        (input) => {
          const url = String(input);
          assertStringIncludes(url, "/readyz");
          throw new TypeError("fetch failed");
        },
        jsonResponse({ status: "ok" }),
        jsonResponse({ ok: true }),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        execStartRetryDelayMs: 1,
        resolveRuntimeEndpoint: ({ endpoint }) =>
          resolveDefaultSandboxRuntimeEndpoint({ endpoint }),
      });

      try {
        assertEquals(await sandbox.executeCommand("echo ok"), {
          stdout: "ok\n",
          stderr: "",
          exitCode: 0,
        });

        assertEquals(fetchCalls.map((call) => call.url), [
          "https://api.test.com/sandbox-sessions",
          "http://sandbox.veryfront-sandbox-3912734599.svc.cluster.local/readyz",
          "http://sandbox.veryfront-sandbox-3912734599.svc.cluster.local/readyz",
          "https://api.test.com/sandbox-sessions/sandbox-1/heartbeat",
          "http://sandbox.veryfront-sandbox-3912734599.svc.cluster.local/exec",
        ]);
      } finally {
        await sandbox.close();
      }
    });

    it("reprovisions SDK-created sessions when the explicit runtime endpoint never becomes ready", async () => {
      setEnv("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc");
      mockTimers({ advanceTimeByMs: true });
      mockFetch([
        jsonResponse({
          id: "stale",
          endpoint: "https://2826936518.sandbox.veryfront.org",
          status: "running",
        }),
        () => {
          throw new TypeError("fetch failed");
        },
        () => {
          throw new TypeError("fetch failed");
        },
        jsonResponse({ ok: true }),
        jsonResponse({
          id: "fresh",
          endpoint: "https://1373820032.sandbox.veryfront.org",
          status: "running",
        }),
        jsonResponse({ status: "ok" }),
        jsonResponse({ ok: true }),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        startupTimeoutMs: 3,
        pollIntervalMs: 2,
        controlRequestTimeoutMs: 0,
        resolveRuntimeEndpoint: ({ endpoint }) =>
          resolveDefaultSandboxRuntimeEndpoint({ endpoint }),
      });

      try {
        assertEquals(await sandbox.executeCommand("echo ok"), {
          stdout: "ok\n",
          stderr: "",
          exitCode: 0,
        });

        assertEquals(fetchCalls.map((call) => call.url), [
          "https://api.test.com/sandbox-sessions",
          "http://sandbox.veryfront-sandbox-2826936518.svc.cluster.local/readyz",
          "http://sandbox.veryfront-sandbox-2826936518.svc.cluster.local/readyz",
          "https://api.test.com/sandbox-sessions/stale",
          "https://api.test.com/sandbox-sessions",
          "http://sandbox.veryfront-sandbox-1373820032.svc.cluster.local/readyz",
          "https://api.test.com/sandbox-sessions/fresh/heartbeat",
          "http://sandbox.veryfront-sandbox-1373820032.svc.cluster.local/exec",
        ]);
        assertEquals(fetchCalls[3]!.init?.method, "DELETE");
      } finally {
        await sandbox.close();
      }
    });

    it("times out stalled lazy background-command control requests", async () => {
      let capturedSignal: AbortSignal | undefined;

      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        (_input, init) =>
          new Promise<Response>((_, reject) => {
            capturedSignal = init?.signal instanceof AbortSignal ? init.signal : undefined;
            capturedSignal?.addEventListener(
              "abort",
              () => reject(new DOMException("The operation was aborted.", "AbortError")),
              { once: true },
            );
          }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        controlRequestTimeoutMs: 1,
      });

      try {
        await assertRejects(
          () => sandbox.startBackgroundCommand("npm test"),
          Error,
        );
        assertEquals(capturedSignal?.aborted, true);
        assertEquals(fetchCalls[2]!.init?.signal instanceof AbortSignal, true);
      } finally {
        await sandbox.close();
      }
    });

    it("retries retryable lazy exec transport failures before streaming starts", async () => {
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        () => {
          throw new TypeError("fetch failed");
        },
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        execStartRetryDelayMs: 0,
        execStartTimeoutMs: 15_000,
      });

      try {
        const result = await sandbox.executeCommand("echo ok");
        assertEquals(result.stdout, "ok\n");
        assertEquals(
          fetchCalls[2]!.url,
          "https://api.test.com/sandbox-sessions/sandbox-1/commands/stream",
        );
        assertEquals(
          fetchCalls[3]!.url,
          "https://api.test.com/sandbox-sessions/sandbox-1/commands/stream",
        );
        assertEquals(fetchCalls[2]!.init?.signal instanceof AbortSignal, true);
      } finally {
        await sandbox.close();
      }
    });

    it("cancels the lazy response body when stream iteration stops early", async () => {
      let cancelCalled = false;
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"stdout","data":"first\\n"}\n'));
        },
        cancel() {
          cancelCalled = true;
        },
      });

      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        new Response(stream, { status: 200 }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        resolveRuntimeEndpoint: ({ endpoint }) =>
          resolveDefaultSandboxRuntimeEndpoint({ endpoint }),
      });

      try {
        const iterator = sandbox.executeStream("echo ok");
        const first = await iterator.next();

        assertEquals(first.done, false);
        assertEquals(first.value?.type, "stdout");

        await iterator.return(undefined);

        assertEquals(cancelCalled, true);
        assertEquals(
          fetchCalls[2]!.url,
          "https://api.test.com/sandbox-sessions/sandbox-1/commands/stream",
        );
      } finally {
        await sandbox.close();
      }
    });

    it("flushes the decoder after the lazy command stream completes", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('{"type":"exit","exitCode":0}'));
          controller.close();
        },
      });

      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        new Response(stream, { status: 200 }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        resolveRuntimeEndpoint: ({ endpoint }) =>
          resolveDefaultSandboxRuntimeEndpoint({ endpoint }),
      });

      try {
        const events: ExecStreamEvent[] = [];
        const flushCount = await countTextDecoderFlushes(async () => {
          for await (const event of sandbox.executeStream("echo ok")) {
            events.push(event);
          }
        });

        assertEquals(flushCount, 1);
        assertEquals(events, [{ type: "exit", exitCode: 0 }]);
      } finally {
        await sandbox.close();
      }
    });

    it("reprovisions lazy exec after exhausted in-cluster transport failures", async () => {
      const connectionRefusedError = () =>
        new TypeError("fetch failed", { cause: { code: "ECONNREFUSED" } });

      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://1111111111.sandbox.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        () => {
          throw connectionRefusedError();
        },
        () => {
          throw connectionRefusedError();
        },
        () => {
          throw connectionRefusedError();
        },
        jsonResponse({ ok: true }),
        jsonResponse({
          id: "sandbox-2",
          endpoint: "https://2222222222.sandbox.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        execStartRetryDelayMs: 0,
        resolveRuntimeEndpoint: ({ sessionId }) =>
          `http://sandbox.veryfront-sandbox-${sessionId}.svc.cluster.local`,
      });

      try {
        const result = await sandbox.executeCommand("echo ok");
        assertEquals(result.stdout, "ok\n");
        assertEquals(
          fetchCalls.filter((call) =>
            call.url === "http://sandbox.veryfront-sandbox-sandbox-1.svc.cluster.local/exec"
          ).length,
          3,
        );
        assertEquals(
          fetchCalls.some((call) =>
            call.url === "https://api.test.com/sandbox-sessions/sandbox-1" &&
            call.init?.method === "DELETE"
          ),
          true,
        );
        assertEquals(
          fetchCalls.some((call) =>
            call.url === "http://sandbox.veryfront-sandbox-sandbox-2.svc.cluster.local/exec"
          ),
          true,
        );
      } finally {
        await sandbox.close();
      }
    });

    it("keeps client heartbeats active while proxy-routed async commands run", async () => {
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      const intervalCallbacks = new Map<number, () => void>();
      let nextIntervalId = 1;

      globalThis.setInterval = ((handler: TimerHandler) => {
        const id = nextIntervalId;
        nextIntervalId += 1;
        if (typeof handler !== "function") {
          throw new Error("Expected heartbeat interval handler to be a function");
        }
        intervalCallbacks.set(id, () => {
          handler();
        });
        return id as ReturnType<typeof setInterval>;
      }) as typeof setInterval;

      globalThis.clearInterval = ((id: number) => {
        intervalCallbacks.delete(id);
      }) as typeof clearInterval;

      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        jsonResponse({
          id: "command-1",
          status: "running",
          exit_code: null,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        jsonResponse({
          id: "command-1",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:00Z",
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
          stdout: "done\n",
          stderr: "",
          stdout_truncated: false,
          stderr_truncated: false,
        }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        resolveRuntimeEndpoint: ({ endpoint }) =>
          resolveDefaultSandboxRuntimeEndpoint({ endpoint }),
      });

      try {
        const command = await sandbox.startBackgroundCommand("npm test");
        assertEquals(command.status, "running");
        assertEquals(intervalCallbacks.size, 1);

        const output = await sandbox.getBackgroundCommandOutput("command-1");
        assertEquals(output.status, "completed");
        assertEquals(output.stdout, "done\n");
        assertEquals(intervalCallbacks.size, 1);
        assertEquals(
          fetchCalls.some((call) =>
            call.url === "https://api.test.com/sandbox-sessions/sandbox-1/commands/command-1/output"
          ),
          true,
        );
      } finally {
        await sandbox.close();
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
      }
    });

    it("pauses client heartbeats while internal-routed async commands run", async () => {
      setEnv("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc");
      const originalSetInterval = globalThis.setInterval;
      const originalClearInterval = globalThis.clearInterval;
      const intervalCallbacks = new Map<number, () => void>();
      let nextIntervalId = 1;

      globalThis.setInterval = ((handler: TimerHandler) => {
        const id = nextIntervalId;
        nextIntervalId += 1;
        if (typeof handler !== "function") {
          throw new Error("Expected heartbeat interval handler to be a function");
        }
        intervalCallbacks.set(id, () => {
          handler();
        });
        return id as ReturnType<typeof setInterval>;
      }) as typeof setInterval;

      globalThis.clearInterval = ((id: number) => {
        intervalCallbacks.delete(id);
      }) as typeof clearInterval;

      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.sandbox.veryfront.org",
          status: "running",
        }),
        jsonResponse({ status: "ok" }),
        jsonResponse({ ok: true }),
        jsonResponse({
          id: "command-1",
          status: "running",
          exit_code: null,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        jsonResponse({
          id: "command-1",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:00Z",
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
          stdout: "done\n",
          stderr: "",
          stdout_truncated: false,
          stderr_truncated: false,
        }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        resolveRuntimeEndpoint: ({ endpoint }) =>
          resolveDefaultSandboxRuntimeEndpoint({ endpoint }),
      });

      try {
        const command = await sandbox.startBackgroundCommand("npm test");
        assertEquals(command.status, "running");
        assertEquals(intervalCallbacks.size, 0);

        const output = await sandbox.getBackgroundCommandOutput("command-1");
        assertEquals(output.status, "completed");
        assertEquals(output.stdout, "done\n");
        assertEquals(intervalCallbacks.size, 1);
        assertEquals(
          fetchCalls.some((call) =>
            call.url ===
              "http://sandbox.veryfront-sandbox-sandbox-1.svc.cluster.local/exec/commands/command-1/output"
          ),
          true,
        );
      } finally {
        await sandbox.close();
        globalThis.setInterval = originalSetInterval;
        globalThis.clearInterval = originalClearInterval;
      }
    });

    it("preserves the current session when a heartbeat fails while internal async commands are active", async () => {
      setEnv("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc");
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.sandbox.veryfront.org",
          status: "running",
        }),
        jsonResponse({ status: "ok" }),
        jsonResponse({ ok: true }),
        jsonResponse({
          id: "command-1",
          status: "running",
          exit_code: null,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        textResponse("upstream timeout", 503),
        jsonResponse({
          id: "command-1",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:00Z",
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
          stdout: "done\n",
          stderr: "",
          stdout_truncated: false,
          stderr_truncated: false,
        }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        resolveRuntimeEndpoint: ({ endpoint }) =>
          resolveDefaultSandboxRuntimeEndpoint({ endpoint }),
      });

      try {
        await sandbox.startBackgroundCommand("npm test");

        await assertRejects(
          () => sandbox.heartbeat(true),
          Error,
          "Sandbox heartbeat failed: 503 upstream timeout",
        );

        assertEquals(sandbox.isActive, true);
        const output = await sandbox.getBackgroundCommandOutput("command-1");
        assertEquals(output.status, "completed");
        assertEquals(
          fetchCalls.some((call) =>
            call.url ===
              "http://sandbox.veryfront-sandbox-sandbox-1.svc.cluster.local/exec/commands/command-1/output"
          ),
          true,
        );
      } finally {
        await sandbox.close();
      }
    });

    it("preserves the proxy session when a heartbeat fails while an async command is active", async () => {
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        jsonResponse({
          id: "command-1",
          status: "running",
          exit_code: null,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        textResponse("upstream timeout", 503),
        jsonResponse({
          id: "command-1",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:00Z",
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
          stdout: "done\n",
          stderr: "",
          stdout_truncated: false,
          stderr_truncated: false,
        }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        resolveRuntimeEndpoint: ({ endpoint }) =>
          resolveDefaultSandboxRuntimeEndpoint({ endpoint }),
      });

      try {
        await sandbox.startBackgroundCommand("npm test");

        await assertRejects(
          () => sandbox.heartbeat(true),
          Error,
          "Sandbox heartbeat failed: 503 upstream timeout",
        );

        assertEquals(sandbox.isActive, true);
        const output = await sandbox.getBackgroundCommandOutput("command-1");
        assertEquals(output.status, "completed");
        assertEquals(output.stdout, "done\n");
        assertEquals(
          fetchCalls.some((call) =>
            call.url ===
              "https://api.test.com/sandbox-sessions/sandbox-1/commands/command-1/output"
          ),
          true,
        );
        assertEquals(
          fetchCalls.some((call) =>
            call.url === "https://api.test.com/sandbox-sessions/sandbox-1" &&
            call.init?.method === "DELETE"
          ),
          false,
        );
      } finally {
        await sandbox.close();
      }
    });

    it("attaches to a configured existing sandbox without deleting it on close", async () => {
      mockFetch([
        jsonResponse({
          id: "existing-1",
          endpoint: "https://existing.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        ndjsonResponse([
          { type: "stdout", data: "ok\n" },
          { type: "exit", exitCode: 0 },
        ]),
      ]);

      const sandbox = Sandbox.createLazy({
        sandboxId: "existing-1",
        authToken: "token",
        apiUrl: "https://api.test.com",
      });

      assertEquals(await sandbox.executeCommand("echo ok"), {
        stdout: "ok\n",
        stderr: "",
        exitCode: 0,
      });
      await sandbox.close();

      assertEquals(fetchCalls.map((call) => [call.url, call.init?.method ?? "GET"]), [
        ["https://api.test.com/sandbox-sessions/existing-1", "GET"],
        ["https://api.test.com/sandbox-sessions/existing-1/heartbeat", "POST"],
        ["https://api.test.com/sandbox-sessions/existing-1/commands/stream", "POST"],
      ]);
    });

    it("uses API proxy routes for untracked lazy background command lookups", async () => {
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.example.com",
          status: "running",
        }),
        jsonResponse({ ok: true }),
        jsonResponse({
          id: "command-1",
          status: "running",
          exit_code: null,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        jsonResponse({
          id: "command-1",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:00Z",
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
          stdout: "done\n",
          stderr: "",
          stdout_truncated: false,
          stderr_truncated: false,
        }),
        jsonResponse({
          id: "command-1",
          status: "canceled",
          exit_code: null,
          signal: "SIGTERM",
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:30Z",
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
      });
      const injectedRoute = { commandsUrl: "https://attacker.example", routeKind: "runtime" };
      Object.defineProperty(sandbox, "activeBackgroundCommands", {
        value: new Map([["command-1", injectedRoute]]),
      });
      Object.defineProperty(sandbox, "resolveBackgroundCommandRoute", {
        value: () => Promise.resolve(injectedRoute),
      });

      try {
        assertEquals((await sandbox.getBackgroundCommand("command-1")).status, "running");
        assertEquals((await sandbox.getBackgroundCommandOutput("command-1")).stdout, "done\n");
        assertEquals((await sandbox.cancelBackgroundCommand("command-1")).status, "canceled");
      } finally {
        await sandbox.close();
      }

      assertEquals(fetchCalls.map((call) => [call.url, call.init?.method ?? "GET"]), [
        ["https://api.test.com/sandbox-sessions", "POST"],
        ["https://api.test.com/sandbox-sessions/sandbox-1/heartbeat", "POST"],
        ["https://api.test.com/sandbox-sessions/sandbox-1/commands/command-1", "GET"],
        ["https://api.test.com/sandbox-sessions/sandbox-1/commands/command-1/output", "GET"],
        [
          "https://api.test.com/sandbox-sessions/sandbox-1/commands/command-1/cancel",
          "POST",
        ],
        ["https://api.test.com/sandbox-sessions/sandbox-1", "DELETE"],
      ]);
    });

    it("uses internal hosted routes for untracked lazy background command lookups", async () => {
      setEnv("KUBERNETES_SERVICE_HOST", "kubernetes.default.svc");
      mockFetch([
        jsonResponse({
          id: "sandbox-1",
          endpoint: "https://sandbox-1.sandbox.veryfront.org",
          status: "running",
        }),
        jsonResponse({ status: "ok" }),
        jsonResponse({ ok: true }),
        jsonResponse({
          id: "command-1",
          status: "running",
          exit_code: null,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        jsonResponse({
          id: "command-1",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:00Z",
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
          stdout: "done\n",
          stderr: "",
          stdout_truncated: false,
          stderr_truncated: false,
        }),
        jsonResponse({
          id: "command-1",
          status: "canceled",
          exit_code: null,
          signal: "SIGTERM",
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:30Z",
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        jsonResponse({ ok: true }),
      ]);

      let resolverCalls = 0;
      const sandbox = Sandbox.createLazy({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        resolveRuntimeEndpoint: ({ endpoint }) => {
          resolverCalls++;
          return resolveDefaultSandboxRuntimeEndpoint({ endpoint });
        },
      });

      try {
        await sandbox.ensure();
        resolverCalls = 0;

        assertEquals((await sandbox.getBackgroundCommand("command-1")).status, "running");
        assertEquals((await sandbox.getBackgroundCommandOutput("command-1")).stdout, "done\n");
        assertEquals((await sandbox.cancelBackgroundCommand("command-1")).status, "canceled");
      } finally {
        await sandbox.close();
      }

      const internalCommandsUrl =
        "http://sandbox.veryfront-sandbox-sandbox-1.svc.cluster.local/exec/commands";
      assertEquals(resolverCalls, 2);
      assertEquals(fetchCalls.map((call) => [call.url, call.init?.method ?? "GET"]), [
        ["https://api.test.com/sandbox-sessions", "POST"],
        ["http://sandbox.veryfront-sandbox-sandbox-1.svc.cluster.local/readyz", "GET"],
        ["https://api.test.com/sandbox-sessions/sandbox-1/heartbeat", "POST"],
        [`${internalCommandsUrl}/command-1`, "GET"],
        [`${internalCommandsUrl}/command-1/output`, "GET"],
        [`${internalCommandsUrl}/command-1/cancel`, "POST"],
        ["https://api.test.com/sandbox-sessions/sandbox-1", "DELETE"],
      ]);
    });
  });

  describe("list()", () => {
    it("should list sandbox sessions", async () => {
      mockFetch([
        jsonResponse({
          data: [
            {
              id: "sess-1",
              short_id: "s1",
              endpoint: "https://sb1.test",
              status: "running",
              created_at: "2026-01-01T00:00:00Z",
            },
            {
              id: "sess-2",
              short_id: "s2",
              endpoint: "https://sb2.test",
              status: "stopped",
              created_at: "2026-01-02T00:00:00Z",
            },
          ],
          page_info: {
            self: "/sandbox-sessions?cursor=abc",
            next: "/sandbox-sessions?cursor=def",
            prev: null,
          },
        }),
      ]);

      const result = await Sandbox.list({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
      });

      assertEquals(result.data.length, 2);
      assertEquals(result.data[0]!.id, "sess-1");
      assertEquals(result.data[0]!.shortId, "s1");
      assertEquals(result.data[0]!.createdAt, "2026-01-01T00:00:00Z");
      assertEquals(result.data[1]!.status, "stopped");
      assertEquals(result.pageInfo.next, "/sandbox-sessions?cursor=def");
      assertEquals(result.pageInfo.prev, null);
      assertEquals(result.pageInfo.first, null);

      assertStringIncludes(fetchCalls[0]!.url, "/sandbox-sessions");
      assertEquals(headerValue(fetchCalls, 0, "Authorization"), "Bearer test-token");
    });

    it("should pass cursor and limit as query params", async () => {
      mockFetch([
        jsonResponse({ data: [], page_info: { self: null, next: null, prev: null } }),
      ]);

      await Sandbox.list({
        authToken: "test-token",
        apiUrl: "https://api.test.com",
        cursor: "abc123",
        limit: 10,
      });

      assertStringIncludes(fetchCalls[0]!.url, "cursor=abc123");
      assertStringIncludes(fetchCalls[0]!.url, "limit=10");
    });

    it("should throw on list failure", async () => {
      mockFetch([
        textResponse("Forbidden", 403),
      ]);

      await assertRejects(
        () => Sandbox.list({ authToken: "bad-token", apiUrl: "https://api.test.com" }),
        Error,
        "Failed to list sandboxes",
      );
    });
  });

  describe("startBackgroundCommand()", () => {
    it("should start a background command", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "command-1",
          status: "running",
          exit_code: null,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const command = await sandbox.startBackgroundCommand("npm test");

      assertEquals(command.id, "command-1");
      assertEquals(command.status, "running");
      assertEquals(command.exitCode, null);
      assertEquals(command.startedAt, "2026-01-01T00:00:00Z");
      assertEquals(command.heartbeatStatus, "disabled");
      assertEquals(command.heartbeatFailureCount, 0);

      assertEquals(fetchCalls[1]!.init?.method, "POST");
      assertEquals(fetchCalls[1]!.url, "https://api.test.com/sandbox-sessions/s1/commands");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
      assertEquals(headerValue(fetchCalls, 1, "Content-Type"), "application/json");
      assertEquals(jsonBody(fetchCalls, 1), { command: "npm test" });
    });

    it("should leave static background-command heartbeats manual", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "command-1",
          status: "running",
          exit_code: null,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: null,
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
        jsonResponse({ ok: true }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await sandbox.startBackgroundCommand("npm test");

      assertEquals(fetchCalls.length, 2);
      assertEquals(fetchCalls[1]!.url, "https://api.test.com/sandbox-sessions/s1/commands");

      await sandbox.heartbeat();

      assertEquals(fetchCalls.length, 3);
      assertEquals(
        fetchCalls[2]!.url,
        "https://api.test.com/sandbox-sessions/s1/heartbeat",
      );
      assertEquals(fetchCalls[2]!.init?.method, "POST");
    });

    it("should throw on start failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Internal Server Error", 500),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.startBackgroundCommand("bad-cmd"),
        Error,
        "Start background command failed",
      );
    });
  });

  describe("getBackgroundCommand()", () => {
    it("should get a background command by id", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "command-2",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:00Z",
          heartbeat_status: "healthy",
          last_heartbeat_at: "2026-01-01T00:00:30Z",
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const command = await sandbox.getBackgroundCommand("command-2");

      assertEquals(command.id, "command-2");
      assertEquals(command.status, "completed");
      assertEquals(command.exitCode, 0);
      assertEquals(command.finishedAt, "2026-01-01T00:01:00Z");
      assertEquals(command.heartbeatStatus, "healthy");
      assertEquals(command.lastHeartbeatAt, "2026-01-01T00:00:30Z");

      assertEquals(
        fetchCalls[1]!.url,
        "https://api.test.com/sandbox-sessions/s1/commands/command-2",
      );
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
    });

    it("should throw on get failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Not found", 404),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.getBackgroundCommand("nonexistent"),
        Error,
        "Get background command failed",
      );
    });
  });

  describe("getBackgroundCommandOutput()", () => {
    it("should get background command output", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "command-3",
          status: "completed",
          exit_code: 0,
          signal: null,
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:01:00Z",
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
          stdout: "hello world\n",
          stderr: "",
          stdout_truncated: false,
          stderr_truncated: false,
        }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const output = await sandbox.getBackgroundCommandOutput("command-3");

      assertEquals(output.id, "command-3");
      assertEquals(output.stdout, "hello world\n");
      assertEquals(output.stderr, "");
      assertEquals(output.stdoutTruncated, false);
      assertEquals(output.stderrTruncated, false);
      assertEquals(output.exitCode, 0);

      assertEquals(
        fetchCalls[1]!.url,
        "https://api.test.com/sandbox-sessions/s1/commands/command-3/output",
      );
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
    });

    it("should throw on output fetch failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Not found", 404),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.getBackgroundCommandOutput("nonexistent"),
        Error,
        "Get background command output failed",
      );
    });
  });

  describe("listBackgroundCommands()", () => {
    it("should list background commands", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          commands: [
            {
              id: "command-1",
              status: "running",
              exit_code: null,
              signal: null,
              started_at: "2026-01-01T00:00:00Z",
              finished_at: null,
              heartbeat_status: "disabled",
              last_heartbeat_at: null,
              last_heartbeat_error: null,
              heartbeat_failure_count: 0,
            },
            {
              id: "command-2",
              status: "completed",
              exit_code: 0,
              signal: null,
              started_at: "2026-01-01T00:00:00Z",
              finished_at: "2026-01-01T00:01:00Z",
              heartbeat_status: "disabled",
              last_heartbeat_at: null,
              last_heartbeat_error: null,
              heartbeat_failure_count: 0,
            },
          ],
        }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const commands = await sandbox.listBackgroundCommands();

      assertEquals(commands.length, 2);
      assertEquals(commands[0]!.id, "command-1");
      assertEquals(commands[0]!.status, "running");
      assertEquals(commands[1]!.id, "command-2");
      assertEquals(commands[1]!.status, "completed");
      assertEquals(commands[1]!.exitCode, 0);

      assertEquals(fetchCalls[1]!.url, "https://api.test.com/sandbox-sessions/s1/commands");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
    });

    it("should handle array response format", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse([
          {
            id: "command-1",
            status: "running",
            exit_code: null,
            signal: null,
            started_at: "2026-01-01T00:00:00Z",
            finished_at: null,
            heartbeat_status: "disabled",
            last_heartbeat_at: null,
            last_heartbeat_error: null,
            heartbeat_failure_count: 0,
          },
        ]),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const commands = await sandbox.listBackgroundCommands();

      assertEquals(commands.length, 1);
      assertEquals(commands[0]!.id, "command-1");
    });

    it("should throw on list failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Internal Server Error", 500),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.listBackgroundCommands(),
        Error,
        "List background commands failed",
      );
    });
  });

  describe("cancelBackgroundCommand()", () => {
    it("should cancel a background command", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "command-4",
          status: "canceled",
          exit_code: null,
          signal: "SIGTERM",
          started_at: "2026-01-01T00:00:00Z",
          finished_at: "2026-01-01T00:00:30Z",
          heartbeat_status: "disabled",
          last_heartbeat_at: null,
          last_heartbeat_error: null,
          heartbeat_failure_count: 0,
        }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      const command = await sandbox.cancelBackgroundCommand("command-4");

      assertEquals(command.id, "command-4");
      assertEquals(command.status, "canceled");
      assertEquals(command.signal, "SIGTERM");

      assertEquals(
        fetchCalls[1]!.url,
        "https://api.test.com/sandbox-sessions/s1/commands/command-4/cancel",
      );
      assertEquals(fetchCalls[1]!.init?.method, "POST");
      assertEquals(headerValue(fetchCalls, 1, "Authorization"), "Bearer token");
    });

    it("should throw on cancel failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Not found", 404),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.cancelBackgroundCommand("nonexistent"),
        Error,
        "Cancel background command failed",
      );
    });
  });

  describe("properties", () => {
    it("should expose id and url", async () => {
      mockFetch([
        jsonResponse({
          id: "props-test",
          endpoint: "https://sb.example.com",
          status: "running",
        }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      assertEquals(sandbox.id, "props-test");
      assertEquals(sandbox.url, "https://sb.example.com");
    });
  });
});
