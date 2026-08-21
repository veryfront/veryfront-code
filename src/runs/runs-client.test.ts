import "#veryfront/schemas/_test-setup.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider";
import { createRunsClient, VeryfrontRunsClient } from "./runs-client.ts";

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchResponses: Array<Response | (() => Response)> = [];

const projectId = "22222222-2222-4222-8222-222222222222";
const scheduleId = "33333333-3333-4333-8333-333333333333";

function mockFetch(responses: Array<Response | (() => Response)>): void {
  fetchCalls = [];
  fetchResponses = [...responses];
  restoreMockFetch();
  installMockFetch(
    (async (input: string | URL | Request, init?: RequestInit) => {
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
    }) as typeof fetch,
  );
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
    restoreMockFetch();
    clearRunsEnv();
  });

  it("exports a client factory", () => {
    assertExists(createRunsClient);
    assertEquals(typeof createRunsClient, "function");
  });

  it("creates task runs through canonical /runs", async () => {
    mockFetch([jsonResponse({ accepted: true, run: makeRun() }, 202)]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
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
      apiUrl: "https://93.184.216.34",
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
      apiUrl: "https://93.184.216.34",
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

  it("creates schedule runs by resolving the source trigger id", async () => {
    mockFetch([
      jsonResponse({
        schedules: [{
          id: scheduleId,
          project_id: projectId,
          name: "Process job submissions",
          status: "active",
          target: {
            kind: "agent",
            id: "job-submission-orchestrator",
            conversation_mode: "create_new",
          },
          schedule: "0 * * * *",
          timezone: "Europe/Berlin",
          runtime_target_kind: "main_branch",
          runtime_target_environment_id: null,
          runtime_target_branch_id: null,
          config: {
            prompt: "Process job submissions.",
          },
          timeout_seconds: 1800,
          backoff_limit: 1,
          concurrency_policy: "Forbid",
          definition_source: "source",
          source_trigger_id: "process-job-submissions",
          source_path: "schedules/process-job-submissions.ts",
          source_hash: "source-hash",
          last_scheduled_at: null,
          last_successful_at: null,
          health: null,
          max_runs: null,
          run_count: 0,
          completed_at: null,
          paused_reason: null,
          paused_at: null,
          last_failure_at: null,
          last_failure_code: null,
          last_failure_message: null,
          last_failure_run_id: null,
          created_by: null,
          integration_requirements: [],
          created_at: "2026-07-26T12:00:00.000Z",
          updated_at: "2026-07-26T12:00:00.000Z",
        }],
        source_schedules: [],
      }),
      jsonResponse({
        run_id: "run_11111111-1111-4111-8111-111111111111",
        run_execution_id: "run_11111111-1111-4111-8111-111111111111",
        schedule_id: scheduleId,
      }, 201),
    ]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const response = await client.createScheduleRunFromSource({
      sourceTriggerId: "process-job-submissions",
      runName: "Local CLI verification",
      idempotencyKey: "schedule-cli-test",
    });

    assertEquals(response, {
      scheduleRun: {
        run_id: "run_11111111-1111-4111-8111-111111111111",
        run_execution_id: "run_11111111-1111-4111-8111-111111111111",
        schedule_id: scheduleId,
      },
      timeoutSeconds: 1800,
      target: {
        kind: "agent",
        id: "job-submission-orchestrator",
        conversationMode: "create_new",
      },
    });
    assertEquals(
      call(0).url,
      "https://93.184.216.34/projects/dreamy-haven/schedules?status=active&source_trigger_id=process-job-submissions",
    );
    assertEquals(
      call(1).url,
      `https://93.184.216.34/projects/dreamy-haven/schedules/${scheduleId}/runs`,
    );
    assertEquals(call(1).init?.method, "POST");
    assertEquals(headerValue(1, "Authorization"), "Bearer test-token");
    assertEquals(jsonBody(1), {
      run_name: "Local CLI verification",
      idempotency_key: "schedule-cli-test",
    });
  });

  it("reuses a generated idempotency key when direct schedule creation retries", async () => {
    mockFetch([
      jsonResponse({ error: "temporary upstream failure" }, 500),
      jsonResponse({
        run_id: "run_11111111-1111-4111-8111-111111111111",
        run_execution_id: "run_11111111-1111-4111-8111-111111111111",
        schedule_id: scheduleId,
      }, 201),
    ]);
    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
      authToken: "test-token",
      projectReference: "dreamy-haven",
      retry: {
        maxRetries: 1,
        initialDelay: 1,
        maxDelay: 1,
      },
    });

    await client.createScheduleRun({
      scheduleId,
      runName: "Manual schedule retry guard",
    });

    const firstBody = jsonBody(0) as { run_name: string; idempotency_key: string };
    const retryBody = jsonBody(1) as { run_name: string; idempotency_key: string };
    assertEquals(fetchCalls.length, 2);
    assertEquals(call(0).init?.method, "POST");
    assertEquals(call(1).init?.method, "POST");
    assertEquals(firstBody, {
      run_name: "Manual schedule retry guard",
      idempotency_key: firstBody.idempotency_key,
    });
    assertStringIncludes(firstBody.idempotency_key, "schedule-run:");
    assertEquals(retryBody, firstBody);
  });

  it("does not create a run when the pushed source schedule is missing", async () => {
    mockFetch([
      jsonResponse({
        schedules: [],
        source_schedules: [],
      }),
    ]);
    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    await assertRejects(
      () =>
        client.createScheduleRunFromSource({
          sourceTriggerId: "missing-schedule",
        }),
      Error,
      'Active source schedule "missing-schedule" not found in project "dreamy-haven".',
    );

    assertEquals(fetchCalls.length, 1);
    assertEquals(
      call(0).url,
      "https://93.184.216.34/projects/dreamy-haven/schedules?status=active&source_trigger_id=missing-schedule",
    );
  });

  it("creates the matching source schedule when it is not the first listed schedule", async () => {
    const matchingScheduleId = "44444444-4444-4444-8444-444444444444";
    mockFetch([
      jsonResponse({
        schedules: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            name: "Another active schedule",
            status: "active",
            target: {
              kind: "agent",
              id: "other-agent",
            },
            definition_source: "source",
            source_trigger_id: "other-source-schedule",
            timeout_seconds: 300,
          },
          {
            id: matchingScheduleId,
            name: "Process job submissions",
            status: "active",
            target: {
              kind: "agent",
              id: "job-submission-orchestrator",
            },
            definition_source: "source",
            source_trigger_id: "process-job-submissions",
            timeout_seconds: 1800,
          },
        ],
      }),
      jsonResponse({
        run_id: "run_11111111-1111-4111-8111-111111111111",
        run_execution_id: "run_11111111-1111-4111-8111-111111111111",
        schedule_id: matchingScheduleId,
      }, 201),
    ]);
    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const response = await client.createScheduleRunFromSource({
      sourceTriggerId: "process-job-submissions",
    });

    assertEquals(response.scheduleRun.schedule_id, matchingScheduleId);
    assertEquals(
      call(1).url,
      `https://93.184.216.34/projects/dreamy-haven/schedules/${matchingScheduleId}/runs`,
    );
  });

  it("does not trust a non-active schedule returned by the active filter", async () => {
    mockFetch([
      jsonResponse({
        schedules: [{
          id: scheduleId,
          name: "Process job submissions",
          status: "paused",
          target: {
            kind: "agent",
            id: "job-submission-orchestrator",
          },
          definition_source: "source",
          source_trigger_id: "process-job-submissions",
          timeout_seconds: 1800,
        }],
      }),
    ]);
    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    await assertRejects(
      () =>
        client.createScheduleRunFromSource({
          sourceTriggerId: "process-job-submissions",
        }),
      Error,
      'Active source schedule "process-job-submissions" not found in project "dreamy-haven".',
    );

    assertEquals(fetchCalls.length, 1);
  });

  it("creates knowledge ingest task runs", async () => {
    mockFetch([jsonResponse({ accepted: true, run: makeRun() }, 202)]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
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
      apiUrl: "https://93.184.216.34",
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
      apiUrl: "https://93.184.216.34",
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
    setEnv("VERYFRONT_API_URL", "https://93.184.216.34");
    setEnv("VERYFRONT_API_TOKEN", "env-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "env-project");

    mockFetch([jsonResponse(makeRun())]);

    const client = new VeryfrontRunsClient();
    await client.get("run_11111111-1111-4111-8111-111111111111");

    assertStringIncludes(call(0).url, "https://93.184.216.34/runs/");
    assertEquals(headerValue(0, "Authorization"), "Bearer env-token");
  });

  it("never pairs a request token with a source-selected cloud endpoint", async () => {
    setEnv("VERYFRONT_API_URL", "https://93.184.216.34");
    setEnv("VERYFRONT_API_TOKEN", "host-token");
    mockFetch([jsonResponse(makeRun())]);

    await runWithVeryfrontCloudContext(
      {
        apiBaseUrl: "https://93.184.216.35",
        projectSlug: "tenant-project",
      },
      async () => {
        const unpaired = new VeryfrontRunsClient();
        await assertRejects(
          () => unpaired.get("run_11111111-1111-4111-8111-111111111111"),
          Error,
          "Runs auth not configured",
        );

        const requestScoped = new VeryfrontRunsClient();
        requestScoped.setRequestToken("request-token");
        await requestScoped.get("run_11111111-1111-4111-8111-111111111111");
      },
    );

    assertEquals(fetchCalls.length, 1);
    assertStringIncludes(call(0).url, "https://93.184.216.34/runs/");
    assertEquals(headerValue(0, "Authorization"), "Bearer request-token");
  });

  it("fails fast when auth is missing", async () => {
    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
      projectReference: "dreamy-haven",
    });

    await assertRejects(
      () => client.list(),
      Error,
      "apiUrl requires an explicit authToken",
    );
  });

  it("fails fast when project reference is missing for project listing", async () => {
    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
      authToken: "test-token",
    });

    await assertRejects(
      () => client.list(),
      Error,
      "Runs project reference not configured",
    );
  });
});
