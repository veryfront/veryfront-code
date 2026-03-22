import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { runWithProjectEnv } from "../server/project-env/storage.ts";
import type { ExecStreamEvent } from "./sandbox.ts";
import { Sandbox } from "./sandbox.ts";

// Mock fetch for testing
const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchResponses: Array<Response | (() => Response)> = [];

function mockFetch(responses: Array<Response | (() => Response)>) {
  fetchResponses = [...responses];
  fetchCalls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchCalls.push({ url, init });
    const entry = fetchResponses.shift();
    if (!entry) throw new Error(`No mock response for: ${url}`);
    return typeof entry === "function" ? entry() : entry;
  }) as typeof fetch;
}

// Zero-delay setTimeout mock to avoid real polling delays (cross-runtime)
const originalSetTimeout = globalThis.setTimeout;
function mockTimers() {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).setTimeout = (fn: () => void, _ms?: number) => {
    return originalSetTimeout(fn, 0);
  };
}
function restoreTimers() {
  // deno-lint-ignore no-explicit-any
  (globalThis as any).setTimeout = originalSetTimeout;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status = 200): Response {
  return new Response(body, { status });
}

function ndjsonResponse(events: Array<Record<string, unknown>>): Response {
  const body = events.map((e) => JSON.stringify(e)).join("\n");
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function call(index: number): { url: string; init?: RequestInit } {
  const entry = fetchCalls[index];
  if (!entry) throw new Error(`No fetch call at index ${index}`);
  return entry;
}

function headerValue(index: number, name: string): string | null {
  return new Headers(call(index).init?.headers).get(name);
}

function jsonBody(index: number): unknown {
  const body = call(index).init?.body;
  if (typeof body !== "string") {
    throw new Error(`Expected string body for fetch call ${index}`);
  }
  return JSON.parse(body);
}

const SANDBOX_ENV_KEYS = [
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_API_URL",
] as const;

function clearSandboxEnv(): void {
  for (const key of SANDBOX_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // expected: env may already be unset
    }
  }
}

describe("Sandbox", () => {
  beforeEach(() => {
    fetchCalls = [];
    fetchResponses = [];
  });

  afterEach(() => {
    restoreTimers();
    globalThis.fetch = originalFetch;
    clearSandboxEnv();
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

      const sandbox = await Sandbox.create({ authToken: "test-token" });
      assertEquals(sandbox.id, "session-1");
      assertEquals(sandbox.url, "https://sandbox.example.com");

      assertStringIncludes(call(0).url, "/sandbox-sessions");
      assertEquals(call(0).init?.method, "POST");
      assertEquals(headerValue(0, "Authorization"), "Bearer test-token");
      assertEquals(headerValue(0, "Content-Type"), "application/json");
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

      assertStringIncludes(call(0).url, "https://api.test.com/sandbox-sessions");
      assertEquals(headerValue(0, "Authorization"), "Bearer vf_env_token");
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

      assertEquals(headerValue(0, "Authorization"), "Bearer vf_request_token");
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

      assertEquals(headerValue(0, "Authorization"), "Bearer vf_explicit_token");
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
      assertStringIncludes(call(1).url, "/sandbox-sessions/session-2");
      assertEquals(headerValue(1, "Authorization"), "Bearer test-token");
    });

    it("should throw on creation failure", async () => {
      mockFetch([
        textResponse("Forbidden", 403),
      ]);

      await assertRejects(
        () => Sandbox.create({ authToken: "bad-token", apiUrl: "https://api.test.com" }),
        Error,
        "Failed to create sandbox",
      );
    });

    it("should throw before fetching when no auth is configured", async () => {
      await assertRejects(
        () => Sandbox.create({ apiUrl: "https://api.test.com" }),
        Error,
        "Sandbox auth not configured",
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

      await assertRejects(
        () => Sandbox.create({ authToken: "test-token", apiUrl: "https://api.test.com" }),
        Error,
        "Sandbox failed to start",
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

        assertStringIncludes(call(0).url, "https://internal.api.test/sandbox-sessions");
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
      assertStringIncludes(call(0).url, "/sandbox-sessions/session-existing");
      assertEquals(headerValue(0, "Authorization"), "Bearer test-token");
    });

    it("should reconnect using VERYFRONT_API_TOKEN when authToken is omitted", async () => {
      setEnv("VERYFRONT_API_TOKEN", "vf_env_token");

      mockFetch([
        jsonResponse({ endpoint: "https://sandbox.example.com" }),
      ]);

      const sandbox = await Sandbox.get("session-existing", {
        apiUrl: "https://api.test.com",
      });
      assertEquals(sandbox.id, "session-existing");
      assertEquals(headerValue(0, "Authorization"), "Bearer vf_env_token");
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
      assertEquals(call(1).init?.method, "POST");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
      assertEquals(headerValue(1, "Content-Type"), "application/json");
      assertEquals(jsonBody(1), { command: "echo hello" });
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
      assertEquals(jsonBody(1), { command: "failing-cmd" });
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
      assertEquals(call(1).init?.method, "POST");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
      assertEquals(headerValue(1, "Content-Type"), "application/json");
      assertEquals(jsonBody(1), { command: "cmd" });
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
      assertEquals(jsonBody(1), { command: "bad-cmd" });
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
      assertEquals(jsonBody(1), { command: "cmd" });
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
      assertStringIncludes(call(1).url, "/file?path=");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
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

      assertEquals(call(1).init?.method, "POST");
      assertStringIncludes(call(1).url, "/files");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
      assertEquals(headerValue(1, "Content-Type"), "application/json");
      assertEquals(jsonBody(1), {
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

      assertStringIncludes(call(1).url, "/sandbox-sessions/s6/heartbeat");
      assertEquals(call(1).init?.method, "POST");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
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

      assertStringIncludes(call(1).url, "/sandbox-sessions/s7");
      assertEquals(call(1).init?.method, "DELETE");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
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

      assertStringIncludes(call(0).url, "/sandbox-sessions");
      assertEquals(headerValue(0, "Authorization"), "Bearer test-token");
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

      assertStringIncludes(call(0).url, "cursor=abc123");
      assertStringIncludes(call(0).url, "limit=10");
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

  describe("startCommandJob()", () => {
    it("should start a command job", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "job-1",
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
      const job = await sandbox.startCommandJob("npm test");

      assertEquals(job.id, "job-1");
      assertEquals(job.status, "running");
      assertEquals(job.exitCode, null);
      assertEquals(job.startedAt, "2026-01-01T00:00:00Z");
      assertEquals(job.heartbeatStatus, "disabled");
      assertEquals(job.heartbeatFailureCount, 0);

      assertEquals(call(1).init?.method, "POST");
      assertStringIncludes(call(1).url, "/exec/jobs");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
      assertEquals(headerValue(1, "Content-Type"), "application/json");
      assertEquals(jsonBody(1), { command: "npm test" });
    });

    it("should throw on start failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Internal Server Error", 500),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.startCommandJob("bad-cmd"),
        Error,
        "Start command job failed",
      );
    });
  });

  describe("getCommandJob()", () => {
    it("should get a command job by id", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "job-2",
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
      const job = await sandbox.getCommandJob("job-2");

      assertEquals(job.id, "job-2");
      assertEquals(job.status, "completed");
      assertEquals(job.exitCode, 0);
      assertEquals(job.finishedAt, "2026-01-01T00:01:00Z");
      assertEquals(job.heartbeatStatus, "healthy");
      assertEquals(job.lastHeartbeatAt, "2026-01-01T00:00:30Z");

      assertStringIncludes(call(1).url, "/exec/jobs/job-2");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
    });

    it("should throw on get failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Not found", 404),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.getCommandJob("nonexistent"),
        Error,
        "Get command job failed",
      );
    });
  });

  describe("getCommandJobOutput()", () => {
    it("should get command job output", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "job-3",
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
      const output = await sandbox.getCommandJobOutput("job-3");

      assertEquals(output.id, "job-3");
      assertEquals(output.stdout, "hello world\n");
      assertEquals(output.stderr, "");
      assertEquals(output.stdoutTruncated, false);
      assertEquals(output.stderrTruncated, false);
      assertEquals(output.exitCode, 0);

      assertStringIncludes(call(1).url, "/exec/jobs/job-3/output");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
    });

    it("should throw on output fetch failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Not found", 404),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.getCommandJobOutput("nonexistent"),
        Error,
        "Get command job output failed",
      );
    });
  });

  describe("listCommandJobs()", () => {
    it("should list command jobs", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          jobs: [
            {
              id: "job-1",
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
              id: "job-2",
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
      const jobs = await sandbox.listCommandJobs();

      assertEquals(jobs.length, 2);
      assertEquals(jobs[0]!.id, "job-1");
      assertEquals(jobs[0]!.status, "running");
      assertEquals(jobs[1]!.id, "job-2");
      assertEquals(jobs[1]!.status, "completed");
      assertEquals(jobs[1]!.exitCode, 0);

      assertStringIncludes(call(1).url, "/exec/jobs");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
    });

    it("should handle array response format", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse([
          {
            id: "job-1",
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
      const jobs = await sandbox.listCommandJobs();

      assertEquals(jobs.length, 1);
      assertEquals(jobs[0]!.id, "job-1");
    });

    it("should throw on list failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Internal Server Error", 500),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.listCommandJobs(),
        Error,
        "List command jobs failed",
      );
    });
  });

  describe("cancelCommandJob()", () => {
    it("should cancel a command job", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        jsonResponse({
          id: "job-4",
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
      const job = await sandbox.cancelCommandJob("job-4");

      assertEquals(job.id, "job-4");
      assertEquals(job.status, "canceled");
      assertEquals(job.signal, "SIGTERM");

      assertStringIncludes(call(1).url, "/exec/jobs/job-4/cancel");
      assertEquals(call(1).init?.method, "POST");
      assertEquals(headerValue(1, "Authorization"), "Bearer token");
    });

    it("should throw on cancel failure", async () => {
      mockFetch([
        jsonResponse({ id: "s1", endpoint: "https://sb.test", status: "running" }),
        textResponse("Not found", 404),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      await assertRejects(
        () => sandbox.cancelCommandJob("nonexistent"),
        Error,
        "Cancel command job failed",
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
