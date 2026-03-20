import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert";
import { deleteEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { createJobsClient, VeryfrontJobsClient } from "./jobs-client.ts";

const originalFetch = globalThis.fetch;
let fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
let fetchResponses: Array<Response | (() => Response)> = [];

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

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    project_id: "22222222-2222-4222-8222-222222222222",
    environment_id: null,
    cron_job_id: null,
    batch_id: null,
    name: "Ingest 1 file",
    status: "submitted",
    target: "task:knowledge-ingest",
    config: {
      file_count: 1,
      upload_ids: ["33333333-3333-4333-8333-333333333333"],
    },
    context_id: null,
    timeout_seconds: 300,
    backoff_limit: 3,
    exit_code: null,
    failed_reason: null,
    failure_detail: null,
    result: null,
    started_at: null,
    completed_at: null,
    created_by: "44444444-4444-4444-8444-444444444444",
    created_at: "2026-03-20T12:00:00.000Z",
    updated_at: "2026-03-20T12:00:00.000Z",
    ...overrides,
  };
}

function makeCronJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "55555555-5555-4555-8555-555555555555",
    project_id: "22222222-2222-4222-8222-222222222222",
    environment_id: null,
    name: "Nightly ingest",
    status: "active",
    target: "task:knowledge-ingest",
    schedule: "0 2 * * *",
    timezone: "Europe/Stockholm",
    config: {
      file_count: 1,
      upload_ids: ["33333333-3333-4333-8333-333333333333"],
    },
    timeout_seconds: 300,
    backoff_limit: 3,
    concurrency_policy: "Forbid",
    last_scheduled_at: null,
    last_successful_at: null,
    created_by: "44444444-4444-4444-8444-444444444444",
    created_at: "2026-03-20T12:00:00.000Z",
    updated_at: "2026-03-20T12:00:00.000Z",
    ...overrides,
  };
}

const JOBS_ENV_KEYS = [
  "VERYFRONT_API_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
] as const;

function clearJobsEnv(): void {
  for (const key of JOBS_ENV_KEYS) {
    try {
      deleteEnv(key);
    } catch {
      // env may already be unset
    }
  }
}

describe("VeryfrontJobsClient", () => {
  beforeEach(() => {
    fetchCalls = [];
    fetchResponses = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearJobsEnv();
  });

  it("exports a client factory", () => {
    assertExists(createJobsClient);
    assertEquals(typeof createJobsClient, "function");
  });

  it("creates one-off jobs with camelCase inputs mapped to REST payloads", async () => {
    mockFetch([jsonResponse(makeJob())]);

    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const job = await client.create({
      name: "Ingest 1 file",
      target: "task:knowledge-ingest",
      batchId: "66666666-6666-4666-8666-666666666666",
      timeoutSeconds: 900,
      backoffLimit: 0,
      config: {
        file_count: 1,
        upload_ids: ["33333333-3333-4333-8333-333333333333"],
      },
    });

    assertEquals(job.name, "Ingest 1 file");
    assertStringIncludes(call(0).url, "/projects/dreamy-haven/jobs");
    assertEquals(call(0).init?.method, "POST");
    assertEquals(headerValue(0, "Authorization"), "Bearer test-token");
    assertEquals(jsonBody(0), {
      name: "Ingest 1 file",
      target: "task:knowledge-ingest",
      batch_id: "66666666-6666-4666-8666-666666666666",
      timeout_seconds: 900,
      backoff_limit: 0,
      config: {
        file_count: 1,
        upload_ids: ["33333333-3333-4333-8333-333333333333"],
      },
    });
  });

  it("lists jobs with filter query params", async () => {
    mockFetch([
      jsonResponse({
        data: [makeJob()],
        page_info: {
          self: null,
          first: null,
          next: null,
          prev: null,
        },
      }),
    ]);

    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const response = await client.list({
      limit: 50,
      status: "working",
      batchId: "66666666-6666-4666-8666-666666666666",
    });

    assertEquals(response.data.length, 1);
    assertStringIncludes(call(0).url, "limit=50");
    assertStringIncludes(call(0).url, "status=working");
    assertStringIncludes(call(0).url, "batch_id=66666666-6666-4666-8666-666666666666");
  });

  it("prefers request-scoped auth and project context when explicit config is omitted", async () => {
    mockFetch([
      jsonResponse({
        data: [makeJob()],
        page_info: {
          self: null,
          first: null,
          next: null,
          prev: null,
        },
      }),
    ]);

    await runWithRequestContext(
      {
        token: "request-token",
        projectSlug: "fresh-zephyr",
      },
      async () => {
        const client = new VeryfrontJobsClient({ apiUrl: "https://api.test.com" });
        const response = await client.list();

        assertEquals(response.data.length, 1);
      },
    );

    assertEquals(headerValue(0, "Authorization"), "Bearer request-token");
    assertStringIncludes(call(0).url, "/projects/fresh-zephyr/jobs");
  });

  it("uses environment defaults when config is omitted", async () => {
    setEnv("VERYFRONT_API_URL", "https://api.env.test");
    setEnv("VERYFRONT_API_TOKEN", "env-token");
    setEnv("VERYFRONT_PROJECT_SLUG", "env-project");

    mockFetch([jsonResponse(makeJob())]);

    const client = new VeryfrontJobsClient();
    await client.get("11111111-1111-4111-8111-111111111111");

    assertStringIncludes(call(0).url, "https://api.env.test/projects/env-project/jobs/");
    assertEquals(headerValue(0, "Authorization"), "Bearer env-token");
  });

  it("returns canonical job events", async () => {
    mockFetch([
      jsonResponse({
        entries: [
          {
            timestamp: "2026-03-20T12:00:01.000Z",
            level: "info",
            message: "Knowledge source ingested",
            service: "job-runner",
            metadata: {
              source_name: "foo.pdf",
            },
          },
        ],
        next_cursor: null,
        stats: {
          bytes_processed: 100,
          lines_processed: 2,
          query_time_ms: 5,
        },
      }),
    ]);

    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const events = await client.events("11111111-1111-4111-8111-111111111111", {
      limit: 10,
      direction: "forward",
    });

    assertEquals(events.entries.length, 1);
    assertStringIncludes(call(0).url, "/events?limit=10&direction=forward");
  });

  it("returns raw job logs", async () => {
    mockFetch([jsonResponse({ logs: "one\ntwo" })]);

    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const logs = await client.logs("11111111-1111-4111-8111-111111111111");
    assertEquals(logs.logs, "one\ntwo");
  });

  it("cancels a job", async () => {
    mockFetch([jsonResponse(makeJob({ status: "canceled" }))]);

    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const job = await client.cancel("11111111-1111-4111-8111-111111111111");
    assertEquals(job.status, "canceled");
    assertEquals(call(0).init?.method, "POST");
    assertStringIncludes(call(0).url, "/cancel");
  });

  it("exposes batch resources", async () => {
    mockFetch([
      jsonResponse({
        id: "66666666-6666-4666-8666-666666666666",
        project_id: "22222222-2222-4222-8222-222222222222",
        target: "task:knowledge-ingest",
        job_count: 3,
        status_counts: {
          submitted: 0,
          working: 1,
          completed: 2,
          failed: 0,
          canceled: 0,
        },
        created_at: "2026-03-20T12:00:00.000Z",
        updated_at: "2026-03-20T12:10:00.000Z",
        result: null,
      }),
      jsonResponse({
        data: [makeJob()],
        page_info: {
          self: null,
          first: null,
          next: null,
          prev: null,
        },
      }),
    ]);

    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const batch = await client.batches.get("66666666-6666-4666-8666-666666666666");
    const jobs = await client.batches.listJobs("66666666-6666-4666-8666-666666666666", {
      status: "working",
    });

    assertEquals(batch.job_count, 3);
    assertEquals(jobs.data.length, 1);
    assertStringIncludes(call(1).url, "status=working");
  });

  it("exposes target discovery", async () => {
    mockFetch([
      jsonResponse({
        reserved_families: ["task:*", "workflow:*", "deploy:*"],
        data: [
          {
            target: "task:knowledge-ingest",
            family: "task",
            description: "Convert uploaded files",
            input_schema: { type: "object" },
            output_schema: { type: "object" },
          },
        ],
      }),
      jsonResponse({
        target: "task:knowledge-ingest",
        family: "task",
        description: "Convert uploaded files",
        input_schema: { type: "object" },
        output_schema: { type: "object" },
      }),
    ]);

    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const definitions = await client.targets.list();
    const definition = await client.targets.get("task:knowledge-ingest");

    assertEquals(definitions.data.length, 1);
    assertEquals(definition.target, "task:knowledge-ingest");
  });

  it("exposes cron job operations", async () => {
    mockFetch([
      jsonResponse(makeCronJob()),
      jsonResponse({
        data: [makeCronJob()],
        page_info: {
          self: null,
          first: null,
          next: null,
          prev: null,
        },
      }),
      jsonResponse(makeCronJob({ status: "paused" })),
      jsonResponse(makeCronJob({ status: "deleting" })),
      jsonResponse(makeJob({ name: "Nightly ingest (manual)" }), 201),
    ]);

    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
      projectReference: "dreamy-haven",
    });

    const created = await client.cron.create({
      name: "Nightly ingest",
      target: "task:knowledge-ingest",
      schedule: "0 2 * * *",
      timezone: "Europe/Stockholm",
      concurrencyPolicy: "Forbid",
      config: {
        file_count: 1,
      },
    });
    const listed = await client.cron.list({ status: "active" });
    const updated = await client.cron.update("55555555-5555-4555-8555-555555555555", {
      status: "paused",
    });
    const deleted = await client.cron.delete("55555555-5555-4555-8555-555555555555");
    const triggered = await client.cron.trigger("55555555-5555-4555-8555-555555555555");

    assertEquals(created.name, "Nightly ingest");
    assertEquals(listed.data.length, 1);
    assertEquals(updated.status, "paused");
    assertEquals(deleted.status, "deleting");
    assertEquals(triggered.name, "Nightly ingest (manual)");
    assertEquals(call(0).init?.method, "POST");
    assertEquals(call(2).init?.method, "PATCH");
    assertEquals(call(3).init?.method, "DELETE");
    assertEquals(call(4).init?.method, "POST");
  });

  it("fails fast when auth is missing", async () => {
    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      projectReference: "dreamy-haven",
    });

    await assertRejects(
      () => client.list(),
      Error,
      "Jobs auth not configured",
    );
  });

  it("fails fast when project reference is missing", async () => {
    const client = new VeryfrontJobsClient({
      apiUrl: "https://api.test.com",
      authToken: "test-token",
    });

    await assertRejects(
      () => client.list(),
      Error,
      "Jobs project reference not configured",
    );
  });
});
