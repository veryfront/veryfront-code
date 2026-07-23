import "#veryfront/schemas/_test-setup.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import { createRunsClient, VeryfrontRunsClient } from "./runs-client.ts";

const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchResponses: Array<Response | (() => Response)> = [];

const projectId = "22222222-2222-4222-8222-222222222222";

function mockFetch(responses: Array<Response | (() => Response)>): void {
  fetchCalls = [];
  fetchResponses = [...responses];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    fetchCalls.push({ url, init });

    const next = fetchResponses.shift();
    if (!next) {
      throw new Error(`No mock response for ${url}`);
    }

    return typeof next === "function" ? next() : next;
  }) as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function call(index: number): { url: string; init?: RequestInit } {
  const entry = fetchCalls[index];
  if (!entry) {
    throw new Error(`Missing fetch call ${index}`);
  }
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

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    run_id: "run_11111111-1111-4111-8111-111111111111",
    kind: "task",
    status: "pending",
    owner: { kind: "project", id: projectId },
    parent_run_id: null,
    root_run_id: "run_11111111-1111-4111-8111-111111111111",
    waiting_reason: null,
    metadata: null,
    target: "task:sync-data",
    workflow_id: null,
    schedule_id: null,
    batch_id: null,
    runtime_target_kind: null,
    runtime_target_environment_id: null,
    runtime_target_branch_id: null,
    input: null,
    config: null,
    output: null,
    error: null,
    logs: null,
    artifacts: [],
    duration_ms: null,
    exit_code: null,
    start_mode: null,
    timeout_seconds: null,
    backoff_limit: null,
    trigger_kind: null,
    trigger_id: null,
    created_by: null,
    updated_at: "2026-03-20T12:00:00.000Z",
    created_at: "2026-03-20T12:00:00.000Z",
    started_at: null,
    completed_at: null,
    ...overrides,
  };
}

const RUNS_ENV_KEYS = [
  "VERYFRONT_API_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
] as const;

function clearRunsEnv(): void {
  for (const key of RUNS_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // env may already be unset
    }
  }
}

describe("VeryfrontRunsClient", () => {
  beforeEach(() => {
    fetchCalls = [];
    fetchResponses = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearRunsEnv();
  });

  it("exports a client factory", () => {
    assertExists(createRunsClient);
    assertEquals(typeof createRunsClient, "function");
  });

  it("creates task runs through canonical /runs", async () => {
    mockFetch([jsonResponse({ accepted: true, run: makeRun() }, 202)]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const response = await client.createTaskRun({
      projectId,
      name: "Sync data",
      target: "task:sync-data",
      batchId: "66666666-6666-4666-8666-666666666666",
      runtimeTargetKind: "preview_branch",
      runtimeTargetBranchId: "55555555-5555-4555-8555-555555555555",
      timeoutSeconds: 900,
      backoffLimit: 0,
      config: { batchSize: 100 },
    });

    assertEquals(response.run.kind, "task");
    assertStringIncludes(call(0).url, "/runs");
    assertEquals(call(0).init?.method, "POST");
    assertEquals(headerValue(0, "Authorization"), "Bearer test-token");
    assertEquals(jsonBody(0), {
      kind: "task",
      owner: { kind: "project", id: projectId },
      request: {
        name: "Sync data",
        target: "task:sync-data",
        batch_id: "66666666-6666-4666-8666-666666666666",
        runtime_target_kind: "preview_branch",
        runtime_target_branch_id: "55555555-5555-4555-8555-555555555555",
        config: { batchSize: 100 },
        timeout_seconds: 900,
        backoff_limit: 0,
      },
    });
  });

  it("creates workflow runs through canonical /runs", async () => {
    mockFetch([
      jsonResponse({
        accepted: true,
        run: makeRun({ kind: "workflow" }),
      }, 202),
    ]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    await client.createWorkflowRun({
      projectId,
      workflowId: "content-pipeline",
      target: "workflow:content-pipeline",
      input: { topic: "AI agents" },
      startMode: "manual",
    });

    assertEquals(jsonBody(0), {
      kind: "workflow",
      owner: { kind: "project", id: projectId },
      request: {
        workflow_id: "content-pipeline",
        target: "workflow:content-pipeline",
        input: { topic: "AI agents" },
        start_mode: "manual",
      },
    });
  });

  it("creates eval runs through canonical /runs", async () => {
    mockFetch([
      jsonResponse({
        accepted: true,
        run: makeRun({
          kind: "eval",
          target: "eval:capital-basic-eval",
          input: { dataset: "smoke" },
          config: { repetitions: 2 },
        }),
      }, 202),
    ]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    await client.createEvalRun({
      projectId,
      target: "eval:capital-basic-eval",
      input: { dataset: "smoke" },
      config: { repetitions: 2 },
      startMode: "manual",
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: "44444444-4444-4444-8444-444444444444",
    });

    assertEquals(jsonBody(0), {
      kind: "eval",
      owner: { kind: "project", id: projectId },
      request: {
        target: "eval:capital-basic-eval",
        runtime_target_kind: "environment",
        runtime_target_environment_id: "44444444-4444-4444-8444-444444444444",
        input: { dataset: "smoke" },
        config: { repetitions: 2 },
        start_mode: "manual",
      },
    });
  });

  it("creates knowledge ingest task runs", async () => {
    mockFetch([jsonResponse({ accepted: true, run: makeRun() }, 202)]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    await client.knowledge.ingestByUploadIds({
      projectId,
      uploadIds: ["33333333-3333-4333-8333-333333333333"],
      batchId: "66666666-6666-4666-8666-666666666666",
    });

    assertEquals(jsonBody(0), {
      kind: "task",
      owner: { kind: "project", id: projectId },
      request: {
        name: "Ingest knowledge",
        target: "task:knowledge-ingest",
        batch_id: "66666666-6666-4666-8666-666666666666",
        config: {
          upload_ids: ["33333333-3333-4333-8333-333333333333"],
        },
      },
    });
  });

  it("lists project runs with project-reference routing", async () => {
    mockFetch([
      jsonResponse({
        data: [makeRun()],
        page_info: { self: null, first: null, next: null, prev: null },
      }),
    ]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const response = await client.list({ limit: 50 });

    assertEquals(response.data.length, 1);
    assertStringIncludes(call(0).url, "/projects/dreamy-haven/runs");
    assertStringIncludes(call(0).url, "limit=50");
  });

  it("reads run detail, events, and cancellation through canonical run routes", async () => {
    mockFetch([
      jsonResponse(makeRun()),
      jsonResponse({
        data: [{
          event_id: 1,
          event_type: "RUN_STARTED",
          payload: {},
          created_at: "2026-03-20T12:00:01.000Z",
        }],
        page_info: { self: null, first: null, next: null, prev: null },
      }),
      jsonResponse({ cancelled: true, run: makeRun({ status: "cancelled" }) }),
    ]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const run = await client.get("run_11111111-1111-4111-8111-111111111111");
    const events = await client.events(run.run_id, { afterEventId: 1, limit: 10 });
    const cancelled = await client.cancel(run.run_id);

    assertEquals(run.output, null);
    assertEquals(run.artifacts, []);
    assertEquals(events.data[0]?.event_type, "RUN_STARTED");
    assertEquals(cancelled.cancelled, true);
    assertStringIncludes(call(0).url, "/runs/run_11111111-1111-4111-8111-111111111111");
    assertStringIncludes(call(1).url, "/events?after_event_id=1&limit=10");
    assertStringIncludes(call(2).url, "/cancel");
    assertEquals(call(2).init?.method, "POST");
  });

  it("uses environment defaults when config is omitted", async () => {
    setEnv("VERYFRONT_API_URL", "https://api.env.test");
    setEnv("VERYFRONT_API_TOKEN", "env-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "env-project");

    mockFetch([jsonResponse(makeRun())]);

    const client = new VeryfrontRunsClient();
    await client.get("run_11111111-1111-4111-8111-111111111111");

    assertStringIncludes(call(0).url, "https://api.env.test/runs/");
    assertEquals(headerValue(0, "Authorization"), "Bearer env-token");
  });

  it("fails fast when auth is missing", async () => {
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      projectReference: "dreamy-haven",
    });

    await assertRejects(
      () => client.list(),
      Error,
      "Runs auth not configured",
    );
  });

  it("fails fast when project reference is missing for project listing", async () => {
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
    });

    await assertRejects(
      () => client.list(),
      Error,
      "Runs project reference not configured",
    );
  });

  it("snapshots and validates configuration at construction", async () => {
    const config = {
      apiUrl: "https://api.test.com/v1/",
      authToken: "original-token",
      projectReference: "original-project",
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    };
    const client = new VeryfrontRunsClient(config);
    config.apiUrl = "https://attacker.invalid";
    config.authToken = "mutated-token";
    config.projectReference = "mutated-project";

    mockFetch([jsonResponse(makeRun())]);
    await client.get("run_11111111-1111-4111-8111-111111111111");

    assertEquals(
      call(0).url,
      "https://api.test.com/v1/runs/run_11111111-1111-4111-8111-111111111111",
    );
    assertEquals(headerValue(0, "Authorization"), "Bearer original-token");

    assertThrows(
      () =>
        new VeryfrontRunsClient({
          apiUrl: "https://api.test.com?token=secret",
          authToken: "token",
        }),
      Error,
      "must not include a query string or fragment",
    );
    assertThrows(
      () =>
        new VeryfrontRunsClient({
          apiUrl: "https://api.test.com",
          authToken: "token",
          retry: { maxRetries: -1 },
        }),
      Error,
      "Retry maxRetries",
    );
    assertThrows(
      () =>
        new VeryfrontRunsClient({
          apiUrl: "https://api.test.com",
          authToken: "token",
          retry: { maxRetries: null } as unknown as { maxRetries: number },
        }),
      Error,
      "Retry maxRetries",
    );
  });

  it("reads an atomic request identity once per operation", async () => {
    interface TestIdentity {
      authToken: string;
      projectReference: string;
    }

    const identity = new AsyncLocalStorage<TestIdentity>();
    const reads = new Map<string, number>();
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      requestIdentityProvider: () => {
        const current = identity.getStore();
        if (current) {
          reads.set(current.projectReference, (reads.get(current.projectReference) ?? 0) + 1);
        }
        return current;
      },
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    });

    mockFetch([
      jsonResponse({ data: [], page_info: { self: null, first: null, next: null, prev: null } }),
      jsonResponse({ data: [], page_info: { self: null, first: null, next: null, prev: null } }),
    ]);

    await Promise.all([
      identity.run(
        { authToken: "token-a", projectReference: "project-a" },
        () => client.list(),
      ),
      identity.run(
        { authToken: "token-b", projectReference: "project-b" },
        () => client.list(),
      ),
    ]);

    const requests = fetchCalls.map((entry) => ({
      authorization: new Headers(entry.init?.headers).get("Authorization"),
      pathname: new URL(entry.url).pathname,
    })).sort((left, right) => left.pathname.localeCompare(right.pathname));
    assertEquals(requests, [
      { authorization: "Bearer token-a", pathname: "/projects/project-a/runs" },
      { authorization: "Bearer token-b", pathname: "/projects/project-b/runs" },
    ]);
    assertEquals(reads, new Map([["project-a", 1], ["project-b", 1]]));
  });

  it("rejects invalid mutable request identity values", () => {
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "token",
    });

    assertThrows(() => client.setRequestToken(""), Error, "non-empty string");
    assertThrows(() => client.setRequestToken("bad\nvalue"), Error, "invalid");
    assertThrows(() => client.setProjectReference(""), Error, "non-empty string");
  });

  it("rejects invalid request inputs before fetching", async () => {
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "token",
      projectReference: "project",
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    });

    await assertRejects(() => client.get(""), Error, "run ID must be a non-empty string");
    await assertRejects(() => client.list({ limit: 0 }), Error, "limit must be a positive integer");
    await assertRejects(
      () =>
        client.createTaskRun({
          projectId,
          target: "task:sync-data",
          timeoutSeconds: -1,
        }),
      Error,
      "timeoutSeconds must be a non-negative integer",
    );

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await assertRejects(
      () =>
        client.createTaskRun({
          projectId,
          target: "task:sync-data",
          config: circular,
        }),
      Error,
      "JSON-serializable",
    );
    assertEquals(fetchCalls.length, 0);
  });

  it("supports cancellation and bounded response policies", async () => {
    const controller = new AbortController();
    controller.abort();
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "token",
      requestPolicy: { signal: controller.signal, maxResponseBytes: 1_024 },
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    });

    await assertRejects(() => client.get("run_1"), Error, "cancelled");
    assertEquals(fetchCalls.length, 0);
  });

  it("rejects inconsistent runtime targets", async () => {
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "token",
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    });

    await assertRejects(
      () =>
        client.createTaskRun({
          projectId,
          target: "task:sync-data",
          runtimeTargetKind: "environment",
        }),
      Error,
      "runtimeTargetEnvironmentId is required",
    );
    await assertRejects(
      () =>
        client.createEvalRun({
          projectId,
          target: "eval:smoke",
          runtimeTargetKind: "main_branch",
          runtimeTargetBranchId: "branch-1",
        }),
      Error,
      "requires a preview_branch runtime target",
    );
    assertEquals(fetchCalls.length, 0);
  });

  it("validates knowledge ingest collections and paths", async () => {
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "token",
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    });

    await assertRejects(
      () => client.knowledge.ingestByUploadIds({ projectId, uploadIds: [] }),
      Error,
      "between 1 and 10000 items",
    );
    await assertRejects(
      () =>
        client.knowledge.ingestByUploadPaths({
          projectId,
          uploadPaths: ["knowledge/valid.md", "knowledge/invalid\0.md"],
        }),
      Error,
      "invalid control characters",
    );
    assertEquals(fetchCalls.length, 0);
  });

  it("reports invalid API payloads without echoing response data", async () => {
    mockFetch([
      jsonResponse(makeRun({
        created_at: "PRIVATE_INVALID_TIMESTAMP",
      })),
    ]);
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "token",
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    });

    const error = await assertRejects(
      () => client.get("run_1"),
      Error,
      "Veryfront API returned an invalid runs response",
    );
    assertEquals(error.message.includes("PRIVATE_INVALID_TIMESTAMP"), false);
  });

  it("snapshots request identity fields exactly once", async () => {
    let tokenReads = 0;
    let projectReads = 0;
    const identity = {
      get authToken() {
        tokenReads++;
        if (tokenReads > 1) throw new Error("TOKEN_GETTER_READ_TWICE");
        return "request-token";
      },
      get projectReference() {
        projectReads++;
        if (projectReads > 1) throw new Error("PROJECT_GETTER_READ_TWICE");
        return "request-project";
      },
    };
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      requestIdentityProvider: () => identity,
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    });
    mockFetch([jsonResponse(makeRun())]);

    await client.get("run_1");

    assertEquals(tokenReads, 1);
    assertEquals(projectReads, 1);
  });

  it("does not consult environment defaults when explicit configuration is complete", async () => {
    setEnv("VERYFRONT_API_URL", "not-a-url");
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "token",
      projectReference: "project",
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    });
    mockFetch([jsonResponse(makeRun())]);

    await client.get("run_1");

    assertEquals(call(0).url, "https://api.test.com/runs/run_1");
  });

  it("preserves human-readable names instead of normalizing request data", async () => {
    const client = new VeryfrontRunsClient({
      apiUrl: "https://api.test.com",
      authToken: "token",
      retry: { maxRetries: 0, initialDelay: 0, maxDelay: 0 },
    });
    mockFetch([jsonResponse({ accepted: true, run: makeRun() }, 202)]);

    await client.createTaskRun({
      projectId,
      name: "  Intentional spacing  ",
      target: "task:sync-data",
    });

    assertEquals(
      (jsonBody(0) as { request: { name: string } }).request.name,
      "  Intentional spacing  ",
    );
  });
});
