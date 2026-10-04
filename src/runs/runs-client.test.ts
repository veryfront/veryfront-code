import "#veryfront/schemas/_test-setup.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import {
  createRunsClient,
  VeryfrontRunsClient,
  type VeryfrontRunsClientConfig,
} from "./runs-client.ts";

let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchResponses: Array<Response | (() => Response)> = [];

const projectId = "22222222-2222-4222-8222-222222222222";
const scheduleId = "33333333-3333-4333-8333-333333333333";

function createTestClient(
  overrides: Partial<VeryfrontRunsClientConfig> = {},
): VeryfrontRunsClient {
  return new VeryfrontRunsClient({
    apiUrl: "https://93.184.216.34",
    authToken: "test-token",
    projectReference: "dreamy-haven",
    ...overrides,
  });
}

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
  const kind = overrides.kind === "eval" ? "task" : overrides.kind ?? "task";
  const target = typeof overrides.target === "string"
    ? overrides.target.split(":").slice(1).join(":")
    : "sync-data";
  return {
    id: "11111111-1111-4111-8111-111111111111",
    project_id: projectId,
    target: { type: kind, id: overrides.kind === "eval" ? "eval" : target },
    status: overrides.status ?? "pending",
    input: overrides.input ?? null,
    output: overrides.output ?? null,
    config: overrides.config,
    created_at: "2026-07-26T12:00:00.000Z",
    updated_at: "2026-07-26T12:00:00.000Z",
  };
}

describe("VeryfrontRunsClient", () => {
  it("preserves metadata and nullable historical targets", async () => {
    mockFetch([
      jsonResponse({
        ...makeRun(),
        metadata: { source_key: "archive" },
        target: { type: "task", id: null },
      }),
    ]);
    const run = await createTestClient().get("11111111-1111-4111-8111-111111111111");
    assertEquals(run.metadata, { source_key: "archive" });
    assertEquals(run.target, null);
  });
  it("preserves canonical failure details in compatibility reads", async () => {
    mockFetch([
      jsonResponse({
        ...makeRun({ status: "failed" }),
        error: {
          code: "FAILED",
          message: "Failure",
          details: { step: "ingest", retryable: false },
        },
      }),
    ]);
    const run = await createTestClient().get("11111111-1111-4111-8111-111111111111");
    assertEquals(run.error?.detail, { step: "ingest", retryable: false });
  });

  it("acknowledges a pending cancellation without inventing terminal completion", async () => {
    mockFetch([
      jsonResponse({
        ...makeRun({ status: "running" }),
        control: { cancellation: { requested_at: "2026-10-04T12:00:00.000Z" } },
      }, 202),
    ]);
    const reply = await createTestClient().cancel(
      "11111111-1111-4111-8111-111111111111",
      "cancel-one",
    );
    assertEquals(reply.cancelled, true);
    assertEquals(reply.run.status, "running");
    assertEquals(headerValue(0, "Idempotency-Key"), "cancel-one");
  });
  beforeEach(() => {
    fetchCalls = [];
    fetchResponses = [];
  });

  afterEach(() => {
    restoreMockFetch();
  });

  it("exports a client factory", () => {
    const client = createRunsClient({
      apiUrl: "https://93.184.216.34",
      authToken: "test-token",
    });

    assertExists(createRunsClient);
    assertEquals(typeof createRunsClient, "function");
    assertEquals(client instanceof VeryfrontRunsClient, true);
  });

  it("does not expose ambient connection resolution as a runtime method", () => {
    const client = createRunsClient();
    assertEquals(
      (client as unknown as Record<string, unknown>).resolveConnection,
      undefined,
    );
  });

  it("creates task runs through canonical /runs", async () => {
    mockFetch([jsonResponse(makeRun(), 202)]);

    const client = createTestClient();

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
      project_id: projectId,
      title: "Sync data",
      target: { type: "task", id: "sync-data" },
      batch_id: "66666666-6666-4666-8666-666666666666",
      config: { batchSize: 100 },
      execution: {
        runtime: { type: "preview_branch", id: "55555555-5555-4555-8555-555555555555" },
        timeout_seconds: 900,
        retry_limit: 0,
      },
    });
  });

  it("normalizes a trailing slash in the configured API URL", async () => {
    mockFetch([jsonResponse(makeRun())]);
    const client = createTestClient({ apiUrl: "https://93.184.216.34/" });

    await client.get("11111111-1111-4111-8111-111111111111");

    assertEquals(
      call(0).url,
      "https://93.184.216.34/runs/11111111-1111-4111-8111-111111111111",
    );
  });

  it("reads a canonical UUID resource and exposes its update precondition", async () => {
    const id = "11111111-1111-4111-8111-111111111111";
    const resource = {
      id,
      project_id: projectId,
      target: { type: "task" as const, id: "sync-data" },
      status: "completed" as const,
      input: { source: "manual" },
      output: { synced: 3 },
      labels: { team: "research" },
      created_at: "2026-10-04T08:00:00.000Z",
      updated_at: "2026-10-04T08:00:01.000Z",
    };
    mockFetch([
      new Response(JSON.stringify(resource), {
        headers: { "Content-Type": "application/json", ETag: '"version-1"' },
      }),
    ]);
    let etag: string | null = null;

    const result = await createTestClient().getRun(id, {
      onHeaders: (headers) => {
        etag = headers.get("etag");
      },
    });

    assertEquals(result, resource);
    assertEquals(etag, '"version-1"');
    assertEquals(call(0).url, `https://93.184.216.34/runs/${id}`);
  });

  it("creates workflow runs through canonical /runs", async () => {
    mockFetch([
      jsonResponse(makeRun({ kind: "workflow" }), 202),
    ]);

    const client = createTestClient();

    await client.createWorkflowRun({
      projectId,
      workflowId: "content-pipeline",
      target: "workflow:content-pipeline",
      input: { topic: "AI agents" },
    });

    assertEquals(jsonBody(0), {
      project_id: projectId,
      target: { type: "workflow", id: "content-pipeline" },
      input: { topic: "AI agents" },
      execution: {},
    });
  });

  it("creates eval runs as task:eval through canonical /runs", async () => {
    mockFetch([
      jsonResponse(
        makeRun({
          kind: "task",
          target: "task:eval",
          input: { dataset: "smoke" },
          config: { repetitions: 2, eval_id: "eval:capital-basic-eval" },
        }),
        202,
      ),
    ]);

    const client = createTestClient();

    await client.createEvalRun({
      projectId,
      target: "eval:capital-basic-eval",
      input: { dataset: "smoke" },
      config: { repetitions: 2 },
      runtimeTargetKind: "environment",
      runtimeTargetEnvironmentId: "44444444-4444-4444-8444-444444444444",
    });

    assertEquals(jsonBody(0), {
      project_id: projectId,
      target: { type: "task", id: "eval" },
      input: { dataset: "smoke" },
      config: { repetitions: 2, eval_id: "eval:capital-basic-eval" },
      execution: { runtime: { type: "environment", id: "44444444-4444-4444-8444-444444444444" } },
    });
  });

  it("preserves the API 404 when task:eval admission cannot find the eval", async () => {
    mockFetch([
      jsonResponse({
        type: "https://veryfront.com/errors/resource-not-found",
        title: "Resource not found",
        status: 404,
        detail: 'Eval "eval:missing" not found',
      }, 404),
    ]);

    const error = await assertRejects(() =>
      createTestClient().createEvalRun({
        projectId,
        target: "eval:missing",
      })
    );

    assertEquals((error as { status?: number }).status, 404);
  });

  it("reads historical evaluations as canonical task targets", async () => {
    mockFetch([
      jsonResponse(makeRun({
        kind: "eval",
        target: "eval:capital-basic-eval",
      })),
    ]);

    const run = await createTestClient().get("11111111-1111-4111-8111-111111111111");

    assertEquals(run.kind, "task");
    assertEquals(run.target, "task:eval");
  });

  it("sends any JSON value as task, workflow and eval run input (#2109)", async () => {
    const input = ["INV-7731", "Harbor Office"];
    mockFetch([
      jsonResponse(makeRun({ input }), 202),
      jsonResponse(makeRun({ kind: "workflow", input }), 202),
      jsonResponse(makeRun({ kind: "eval", input }), 202),
    ]);
    const client = createTestClient();

    const task = await client.createTaskRun({
      projectId,
      target: "task:classify-ticket",
      input,
      config: { urgent: true },
    });
    await client.createWorkflowRun({
      projectId,
      workflowId: "classify-ticket-flow",
      target: "workflow:classify-ticket-flow",
      input,
    });
    await client.createEvalRun({ projectId, target: "eval:invoice-lookup", input });

    assertEquals(task.run.input, input);
    assertEquals(jsonBody(0), {
      project_id: projectId,
      target: { type: "task", id: "classify-ticket" },
      input,
      config: { urgent: true },
      execution: {},
    });
    assertEquals((jsonBody(1) as { input: unknown }).input, input);
    assertEquals((jsonBody(2) as { input: unknown }).input, input);
  });

  it("omits task input when none is given, so config-only callers are unchanged", async () => {
    mockFetch([jsonResponse(makeRun(), 202)]);

    await createTestClient().createTaskRun({
      projectId,
      target: "task:sync-data",
      config: { a: 1 },
    });

    assertEquals(
      Object.hasOwn(jsonBody(0) as Record<string, unknown>, "input"),
      false,
    );
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
      jsonResponse({ id: projectId, slug: "dreamy-haven", name: "Project" }),
      jsonResponse(makeRun(), 202),
    ]);

    const client = createTestClient();

    const response = await client.createScheduleRunFromSource({
      sourceTriggerId: "process-job-submissions",
      runName: "Local CLI verification",
      idempotencyKey: "schedule-cli-test",
    });

    assertEquals(response, {
      scheduleRun: {
        run_id: "11111111-1111-4111-8111-111111111111",
        run_execution_id: "11111111-1111-4111-8111-111111111111",
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
      "https://93.184.216.34/projects/dreamy-haven",
    );
    assertEquals(call(2).url, "https://93.184.216.34/runs");
    assertEquals(call(2).init?.method, "POST");
    assertEquals(headerValue(2, "Authorization"), "Bearer test-token");
    assertEquals(headerValue(2, "Idempotency-Key"), "schedule-cli-test");
    assertEquals(jsonBody(2), {
      project_id: projectId,
      source: { type: "schedule", id: scheduleId },
      title: "Local CLI verification",
    });
  });

  it("reuses a generated idempotency key when direct schedule creation retries", async () => {
    mockFetch([
      jsonResponse({ id: projectId, slug: "dreamy-haven", name: "Project" }),
      jsonResponse({ error: "temporary upstream failure" }, 500),
      jsonResponse(makeRun(), 202),
    ]);
    const client = createTestClient({
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

    assertEquals(fetchCalls.length, 3);
    assertEquals(call(1).init?.method, "POST");
    assertEquals(call(2).init?.method, "POST");
    assertEquals(jsonBody(1), {
      project_id: projectId,
      source: { type: "schedule", id: scheduleId },
      title: "Manual schedule retry guard",
    });
    assertEquals(jsonBody(2), jsonBody(1));
    assertStringIncludes(headerValue(1, "Idempotency-Key") ?? "", "schedule-run:");
    assertEquals(headerValue(2, "Idempotency-Key"), headerValue(1, "Idempotency-Key"));
  });

  it("does not create a run when the pushed source schedule is missing", async () => {
    mockFetch([
      jsonResponse({
        schedules: [],
        source_schedules: [],
      }),
    ]);
    const client = createTestClient();

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
      jsonResponse({ id: projectId, slug: "dreamy-haven", name: "Project" }),
      jsonResponse(makeRun(), 202),
    ]);
    const client = createTestClient();

    const response = await client.createScheduleRunFromSource({
      sourceTriggerId: "process-job-submissions",
    });

    assertEquals(response.scheduleRun.schedule_id, matchingScheduleId);
    assertEquals(
      call(1).url,
      "https://93.184.216.34/projects/dreamy-haven",
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
    const client = createTestClient();

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

  it("does not trust a manually defined schedule returned by the source filter", async () => {
    mockFetch([
      jsonResponse({
        schedules: [{
          id: scheduleId,
          name: "Process job submissions",
          status: "active",
          target: {
            kind: "agent",
            id: "job-submission-orchestrator",
          },
          definition_source: "manual",
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

    assertEquals(
      fetchCalls.length,
      1,
      "a manually defined schedule must not be triggered as a source schedule",
    );
  });

  it("creates every knowledge ingest task-run variant", async () => {
    mockFetch([
      jsonResponse(makeRun(), 202),
      jsonResponse(makeRun(), 202),
      jsonResponse(makeRun(), 202),
    ]);

    const client = createTestClient();

    await client.knowledge.ingestByUploadIds({
      projectId,
      uploadIds: ["33333333-3333-4333-8333-333333333333"],
      batchId: "66666666-6666-4666-8666-666666666666",
    });
    await client.knowledge.ingestByUploadPaths({
      projectId,
      uploadPaths: ["guides/getting-started.md"],
      name: "Ingest selected guides",
    });
    await client.knowledge.ingestByUploadPrefix({
      projectId,
      uploadPrefix: "handbook/",
    });

    assertEquals(jsonBody(0), {
      project_id: projectId,
      title: "Ingest knowledge",
      target: { type: "task", id: "knowledge-ingest" },
      batch_id: "66666666-6666-4666-8666-666666666666",
      config: {
        upload_ids: ["33333333-3333-4333-8333-333333333333"],
      },
      execution: {},
    });
    assertEquals(jsonBody(1), {
      project_id: projectId,
      title: "Ingest selected guides",
      target: { type: "task", id: "knowledge-ingest" },
      config: { paths: ["guides/getting-started.md"] },
      execution: {},
    });
    assertEquals(jsonBody(2), {
      project_id: projectId,
      title: "Ingest knowledge",
      target: { type: "task", id: "knowledge-ingest" },
      config: { path_prefix: "handbook/" },
      execution: {},
    });
  });

  it("never sends a stray input from a knowledge ingest call (#2109)", async () => {
    mockFetch([
      jsonResponse(makeRun(), 202),
      jsonResponse(makeRun(), 202),
      jsonResponse(makeRun(), 202),
    ]);
    const client = createTestClient();
    // Structural typing lets a wider object through the `Omit<..., "input">` input types.
    const stray = { projectId, input: ["INV-7731"] };

    await client.knowledge.ingestByUploadIds({
      ...stray,
      uploadIds: ["33333333-3333-4333-8333-333333333333"],
    });
    await client.knowledge.ingestByUploadPaths({ ...stray, uploadPaths: ["docs/a.md"] });
    await client.knowledge.ingestByUploadPrefix({ ...stray, uploadPrefix: "docs/" });

    for (const index of [0, 1, 2]) {
      assertEquals(
        Object.hasOwn(jsonBody(index) as Record<string, unknown>, "input"),
        false,
      );
    }
  });

  it("creates knowledge ingest task runs from upload paths", async () => {
    mockFetch([jsonResponse(makeRun(), 202)]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    await client.knowledge.ingestByUploadPaths({
      projectId,
      uploadPaths: ["docs/a.md", "docs/b.md"],
    });

    assertEquals(
      jsonBody(0),
      {
        project_id: projectId,
        title: "Ingest knowledge",
        target: { type: "task", id: "knowledge-ingest" },
        config: {
          paths: ["docs/a.md", "docs/b.md"],
        },
        execution: {},
      },
      "ingestByUploadPaths sends the paths config with the default run name",
    );
  });

  it("creates knowledge ingest task runs from an upload prefix", async () => {
    mockFetch([jsonResponse(makeRun(), 202)]);

    const client = new VeryfrontRunsClient({
      apiUrl: "https://93.184.216.34",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    await client.knowledge.ingestByUploadPrefix({
      projectId,
      uploadPrefix: "docs/",
    });

    assertEquals(
      jsonBody(0),
      {
        project_id: projectId,
        title: "Ingest knowledge",
        target: { type: "task", id: "knowledge-ingest" },
        config: {
          path_prefix: "docs/",
        },
        execution: {},
      },
      "ingestByUploadPrefix sends the path_prefix config with the default run name",
    );
  });

  it("lists project runs with project-reference routing", async () => {
    mockFetch([
      jsonResponse({
        data: [makeRun()],
        page_info: { next: "next-page" },
      }),
    ]);

    const client = createTestClient();

    const response = await client.list({ limit: 50 });

    assertEquals(response.data.length, 1);
    assertEquals(response.page_info, { self: null, first: null, prev: null, next: "next-page" });
    assertStringIncludes(call(0).url, "/projects/dreamy-haven/runs");
    assertStringIncludes(call(0).url, "limit=50");
  });

  it("accepts an empty canonical run page and retains the requested cursor", async () => {
    mockFetch([jsonResponse({ data: [], page_info: { next: null } })]);
    const response = await createTestClient().list({ cursor: "current-page" });
    assertEquals(response.data, []);
    assertEquals(response.page_info, { self: "current-page", first: null, prev: null, next: null });
  });

  it("reads run detail through the canonical route", async () => {
    mockFetch([jsonResponse(makeRun())]);
    const client = createTestClient();

    const run = await client.get("11111111-1111-4111-8111-111111111111");

    assertEquals(run.output, null);
    assertEquals(run.artifacts, []);
    assertEquals(
      call(0).url,
      "https://93.184.216.34/runs/11111111-1111-4111-8111-111111111111",
    );
    assertEquals(call(0).init?.method, "GET");
  });

  it("lists run events through the canonical paginated route", async () => {
    mockFetch([jsonResponse({
      data: [{
        event_id: 1,
        event_type: "RUN_STARTED",
        payload: {},
        created_at: "2026-03-20T12:00:01.000Z",
      }],
      page_info: { self: null, first: null, next: null, prev: null },
    })]);
    const client = createTestClient();

    const events = await client.events(
      "11111111-1111-4111-8111-111111111111",
      { afterEventId: 1, limit: 10 },
    );

    assertEquals(events.data[0]?.event_type, "RUN_STARTED");
    assertEquals(
      call(0).url,
      "https://93.184.216.34/runs/11111111-1111-4111-8111-111111111111/events?after_event_id=1&limit=10",
    );
    assertEquals(call(0).init?.method, "GET");
  });

  it("cancels a run through the canonical action route", async () => {
    mockFetch([
      jsonResponse(makeRun({ status: "cancelled" }), 202),
    ]);
    const client = createTestClient();

    const cancelled = await client.cancel("11111111-1111-4111-8111-111111111111");

    assertEquals(cancelled.cancelled, true);
    assertEquals(
      call(0).url,
      "https://93.184.216.34/runs/11111111-1111-4111-8111-111111111111/cancel",
    );
    assertEquals(call(0).init?.method, "POST");
  });

  it("uses environment defaults when config is omitted", async () => {
    mockFetch([jsonResponse(makeRun())]);

    await withEnv(
      {
        VERYFRONT_API_URL: "https://93.184.216.34",
        VERYFRONT_API_TOKEN: "env-token",
        VERYFRONT_PROJECT_SLUG: "env-project",
      },
      async () => {
        const client = new VeryfrontRunsClient();
        await client.get("11111111-1111-4111-8111-111111111111");
      },
    );

    assertStringIncludes(call(0).url, "https://93.184.216.34/runs/");
    assertEquals(headerValue(0, "Authorization"), "Bearer env-token");
  });

  it("never pairs a request token with a source-selected cloud endpoint", async () => {
    mockFetch([jsonResponse(makeRun())]);

    await withEnv(
      {
        VERYFRONT_API_URL: "https://93.184.216.34",
        VERYFRONT_API_TOKEN: "host-token",
      },
      async () => {
        await runWithVeryfrontCloudContext(
          {
            apiBaseUrl: "https://93.184.216.35",
            projectSlug: "tenant-project",
          },
          async () => {
            const unpaired = new VeryfrontRunsClient();
            await assertRejects(
              () => unpaired.get("11111111-1111-4111-8111-111111111111"),
              Error,
              "Runs auth not configured",
            );

            const requestScoped = new VeryfrontRunsClient();
            requestScoped.setRequestToken("request-token");
            await requestScoped.get("11111111-1111-4111-8111-111111111111");
          },
        );
      },
    );

    assertEquals(fetchCalls.length, 1);
    assertStringIncludes(call(0).url, "https://93.184.216.34/runs/");
    assertEquals(headerValue(0, "Authorization"), "Bearer request-token");
  });

  it("routes runs requests through the guarded outbound transport", async () => {
    mockFetch([jsonResponse(makeRun())]);

    const client = new VeryfrontRunsClient({
      apiUrl: "http://127.0.0.1:9",
      authToken: "test-token",
      projectReference: "dreamy-haven",
      retry: { maxRetries: 0 },
    });

    await assertRejects(
      () => client.get("11111111-1111-4111-8111-111111111111"),
      Error,
      "Outbound network egress blocked for internal host",
    );

    assertEquals(
      fetchCalls.length,
      0,
      "the egress guard blocks before any fetch is dispatched",
    );
  });

  it("uses captured URL normalization after project prototype mutation", async () => {
    mockFetch([jsonResponse(makeRun())]);
    const originalReplace = String.prototype.replace;
    String.prototype.replace = function () {
      return "https://project-controlled.example";
    };
    try {
      await createTestClient().get("11111111-1111-4111-8111-111111111111");
    } finally {
      String.prototype.replace = originalReplace;
    }

    assertStringIncludes(call(0).url, "https://93.184.216.34/runs/");
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
    mockFetch([]);
    await withEnv(
      { VERYFRONT_PROJECT_SLUG: "" },
      async () => {
        const client = new VeryfrontRunsClient({
          apiUrl: "https://93.184.216.34",
          authToken: "test-token",
        });

        await assertRejects(
          () => client.list(),
          Error,
          "Runs project reference not configured",
        );
      },
    );
    assertEquals(fetchCalls.length, 0);
  });
});
