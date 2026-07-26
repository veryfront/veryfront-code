import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearProjectAgentRuntimeRegistries } from "../../../src/agent/project/agent-runtime.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import type { Run, VeryfrontRunsClient } from "veryfront/runs";
import { setJsonMode } from "../../shared/json-output.ts";
import type { ParsedArgs } from "../../shared/types.ts";
import { handleScheduleCommand, waitForRemoteScheduleRun } from "./handler.ts";

const originalCwd = Deno.cwd();
const originalExit = Deno.exit;
const originalFetch = globalThis.fetch;
const originalConsoleLog = console.log;
const environmentNames = [
  "VERYFRONT_API_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, Deno.env.get(name)]),
) as Record<(typeof environmentNames)[number], string | undefined>;

const projectId = "22222222-2222-4222-8222-222222222222";
const scheduleId = "33333333-3333-4333-8333-333333333333";
const runId = "run_11111111-1111-4111-8111-111111111111";

class ExitSentinel extends Error {
  constructor(readonly code: number) {
    super(`exit:${code}`);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    run_id: runId,
    kind: "agent",
    status: "completed",
    owner: { kind: "project", id: projectId },
    parent_run_id: null,
    root_run_id: runId,
    waiting_reason: null,
    metadata: null,
    target: "agent:job-submission-orchestrator",
    workflow_id: null,
    schedule_id: scheduleId,
    batch_id: null,
    runtime_target_kind: "main_branch",
    runtime_target_environment_id: null,
    runtime_target_branch_id: null,
    input: null,
    config: null,
    output: {
      scanned: 1,
      succeeded: 1,
      failed: 0,
    },
    error: null,
    logs: null,
    artifacts: [],
    duration_ms: 12_345,
    exit_code: 0,
    start_mode: null,
    timeout_seconds: 1800,
    backoff_limit: 1,
    trigger_kind: "schedule",
    trigger_id: scheduleId,
    created_by: null,
    updated_at: "2026-07-26T12:00:12.345Z",
    created_at: "2026-07-26T12:00:00.000Z",
    started_at: "2026-07-26T12:00:00.100Z",
    completed_at: "2026-07-26T12:00:12.345Z",
    ...overrides,
  };
}

function restoreEnvironment(): void {
  for (const name of environmentNames) {
    const value = originalEnvironment[name];
    if (value === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, value);
    }
  }
}

describe("schedule command", () => {
  afterEach(() => {
    Deno.chdir(originalCwd);
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = originalExit;
    globalThis.fetch = originalFetch;
    console.log = originalConsoleLog;
    setJsonMode(false);
    restoreEnvironment();
    clearProjectAgentRuntimeRegistries();
  });

  it("runs a source-defined schedule in the canonical cloud runtime", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-schedule-remote-" });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      jsonResponse({
        schedules: [{
          id: scheduleId,
          status: "active",
          definition_source: "source",
          source_trigger_id: "process-job-submissions",
        }],
        source_schedules: [],
      }),
      jsonResponse({
        run_id: runId,
        run_execution_id: runId,
        schedule_id: scheduleId,
      }, 201),
      jsonResponse(makeRun()),
    ];
    const output: string[] = [];

    try {
      await Deno.mkdir(`${projectDir}/schedules`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        'export default { projectSlug: "dreamy-haven", fs: { type: "local" } };\n',
      );
      await Deno.writeTextFile(
        `${projectDir}/schedules/process-job-submissions.ts`,
        [
          'import { schedule } from "veryfront/schedule";',
          "export default schedule({",
          '  id: "process-job-submissions",',
          '  name: "Process job submissions",',
          '  schedule: "0 * * * *",',
          '  timezone: "Europe/Berlin",',
          '  target: { kind: "agent", id: "job-submission-orchestrator" },',
          '  input: { prompt: "Process job submissions." },',
          "});",
          "",
        ].join("\n"),
      );

      Deno.env.set("VERYFRONT_API_URL", "https://api.test.com");
      Deno.env.set("VERYFRONT_API_TOKEN", "test-token");
      Deno.env.set("VERYFRONT_PROJECT_SLUG", "dreamy-haven");
      Deno.chdir(projectDir);
      setJsonMode(true);
      console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
      globalThis.fetch = (async (
        input: string | URL | Request,
        init?: RequestInit,
      ) => {
        const url = typeof input === "string"
          ? input
          : input instanceof URL
          ? input.toString()
          : input.url;
        requests.push({ url, init });
        const response = responses.shift();
        if (!response) throw new Error(`Unexpected request: ${url}`);
        return response;
      }) as typeof fetch;
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = (code = 0) => {
        throw new ExitSentinel(code);
      };

      let exitCode: number | undefined;
      try {
        await handleScheduleCommand({
          _: ["schedule", "run", "process-job-submissions"],
          remote: true,
          json: true,
        } as ParsedArgs);
      } catch (error) {
        if (!(error instanceof ExitSentinel)) throw error;
        exitCode = error.code;
      }

      assertEquals(exitCode, 0);
      assertEquals(requests.map((request) => request.url), [
        "https://api.test.com/projects/dreamy-haven/schedules?status=active&source_trigger_id=process-job-submissions&limit=1",
        `https://api.test.com/projects/dreamy-haven/schedules/${scheduleId}/runs`,
        `https://api.test.com/runs/${encodeURIComponent(runId)}`,
      ]);
      assertEquals(JSON.parse(output.at(-1) ?? "{}"), {
        success: true,
        command: "schedule",
        data: {
          command: "schedule",
          triggerId: "process-job-submissions",
          target: { kind: "agent", id: "job-submission-orchestrator" },
          output: {
            runId,
            status: "completed",
            result: {
              scanned: 1,
              succeeded: 1,
              failed: 0,
            },
          },
          durationMs: 12_345,
        },
      });
    } finally {
      await stopEsbuild();
      await Deno.remove(projectDir, { recursive: true });
    }
  });

  it("rejects local input overrides before starting a remote run", async () => {
    await assertRejects(
      () =>
        handleScheduleCommand({
          _: ["schedule", "run", "process-job-submissions"],
          remote: true,
          input: "missing.json",
        } as ParsedArgs),
      Error,
      "Remote schedule runs use the source already pushed to Veryfront and do not accept --input.",
    );
  });
});

describe("remote schedule polling", () => {
  it("polls pending and running states until the run completes", async () => {
    const runs = [
      makeRun({ status: "pending", output: null, completed_at: null }),
      makeRun({ status: "running", output: null, completed_at: null }),
      makeRun(),
    ];
    const client = {
      get: () => {
        const run = runs.shift();
        if (!run) throw new Error("Unexpected poll");
        return Promise.resolve(run);
      },
    } satisfies Pick<VeryfrontRunsClient, "get">;
    let now = 0;

    const run = await waitForRemoteScheduleRun(client, runId, 5_000, {
      now: () => now,
      sleep: (delayMs) => {
        now += delayMs;
        return Promise.resolve();
      },
    });

    assertEquals(run.status, "completed");
    assertEquals(run.output, {
      scanned: 1,
      succeeded: 1,
      failed: 0,
    });
  });

  it("returns waiting runs for caller-visible human action", async () => {
    const client = {
      get: () =>
        Promise.resolve(
          makeRun({
            status: "waiting",
            waiting_reason: "awaiting_human",
            completed_at: null,
          }),
        ),
    } satisfies Pick<VeryfrontRunsClient, "get">;

    const run = await waitForRemoteScheduleRun(client, runId, 5_000);

    assertEquals(run.status, "waiting");
    assertEquals(run.waiting_reason, "awaiting_human");
  });

  it("surfaces the recorded error from failed runs", async () => {
    const client = {
      get: () =>
        Promise.resolve(
          makeRun({
            status: "failed",
            error: { message: "Hosted agent execution failed" },
          }),
        ),
    } satisfies Pick<VeryfrontRunsClient, "get">;

    await assertRejects(
      () => waitForRemoteScheduleRun(client, runId, 5_000),
      Error,
      "Hosted agent execution failed",
    );
  });

  it("reports cancelled runs as failures", async () => {
    const client = {
      get: () => Promise.resolve(makeRun({ status: "cancelled" })),
    } satisfies Pick<VeryfrontRunsClient, "get">;

    await assertRejects(
      () => waitForRemoteScheduleRun(client, runId, 5_000),
      Error,
      `Scheduled run was cancelled: ${runId}`,
    );
  });

  it("stops polling at the remote schedule deadline", async () => {
    const client = {
      get: () => Promise.resolve(makeRun({ status: "running", completed_at: null })),
    } satisfies Pick<VeryfrontRunsClient, "get">;
    let now = 0;

    await assertRejects(
      () =>
        waitForRemoteScheduleRun(client, runId, 1_500, {
          now: () => now,
          sleep: (delayMs) => {
            now += delayMs;
            return Promise.resolve();
          },
        }),
      Error,
      `Timed out waiting for scheduled run: ${runId}`,
    );
  });
});
