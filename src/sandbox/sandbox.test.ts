import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert";
import { Sandbox } from "./sandbox.ts";

// Mock fetch for testing
const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchResponses: Array<Response> = [];

function mockFetch(responses: Array<Response | (() => Response)>) {
  fetchResponses = responses.map((r) => (typeof r === "function" ? r() : r));
  fetchCalls = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchCalls.push({ url, init });
    const response = fetchResponses.shift();
    if (!response) throw new Error(`No mock response for: ${url}`);
    return response;
  }) as typeof fetch;
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

describe("Sandbox", () => {
  beforeEach(() => {
    fetchCalls = [];
    fetchResponses = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
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

      assertStringIncludes(fetchCalls[0].url, "/sandbox-sessions");
      assertEquals(fetchCalls[0].init?.method, "POST");
      assertStringIncludes(fetchCalls[0].init?.headers?.toString() ?? "", "");
    });

    it("should poll until ready when not running", async () => {
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

    it("should throw when sandbox fails to start", async () => {
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
      assertStringIncludes(fetchCalls[0].url, "/sandbox-sessions/session-existing");
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
      // Create sandbox first
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
      assertStringIncludes(fetchCalls[1].url, "/file?path=");
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

      assertEquals(fetchCalls[1].init?.method, "POST");
      assertStringIncludes(fetchCalls[1].url, "/files");
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

      assertStringIncludes(fetchCalls[1].url, "/sandbox-sessions/s6/heartbeat");
      assertEquals(fetchCalls[1].init?.method, "POST");
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

      assertStringIncludes(fetchCalls[1].url, "/sandbox-sessions/s7");
      assertEquals(fetchCalls[1].init?.method, "DELETE");
    });
  });

  describe("properties", () => {
    it("should expose id and url", async () => {
      mockFetch([
        jsonResponse({ id: "props-test", endpoint: "https://sb.example.com", status: "running" }),
      ]);

      const sandbox = await Sandbox.create({ authToken: "token", apiUrl: "https://api.test.com" });
      assertEquals(sandbox.id, "props-test");
      assertEquals(sandbox.url, "https://sb.example.com");
    });
  });
});
