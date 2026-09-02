import "#veryfront/schemas/_test-setup.ts";
import { installMockFetch, restoreMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { clearProjectAgentRuntimeRegistries } from "../../../src/agent/project/agent-runtime.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { VeryfrontError } from "veryfront/errors";
import type { CreateScheduleRunFromSourceResult, Run, VeryfrontRunsClient } from "veryfront/runs";
import type { ScheduleDefinition } from "veryfront/schedule";
import { setJsonMode } from "../../shared/json-output.ts";
import type { ParsedArgs } from "../../shared/types.ts";
import {
  createLocalScheduleTimeout,
  formatRemoteScheduleRunOutput,
  handleScheduleCommand,
  normalizeLocalScheduleInput,
  resolveRemoteScheduleTarget,
  toScheduleAgentOptions,
  waitForRemoteScheduleRun,
} from "./handler.ts";

const originalExit = Deno.exit;
const originalConsoleLog = console.log;
const environmentNames = [
  "VERYFRONT_API_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
  "XDG_CONFIG_HOME",
] as const;
const originalEnvironment = Object.fromEntries(
  environmentNames.map((name) => [name, Deno.env.get(name)]),
) as Record<(typeof environmentNames)[number], string | undefined>;

const projectId = "22222222-2222-4222-8222-222222222222";
const scheduleId = "33333333-3333-4333-8333-333333333333";
const runId = "run_11111111-1111-4111-8111-111111111111";
const TEST_PUBLIC_API_ORIGIN = "https://93.184.216.34";

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

function makeAcceptedScheduleRun(timeoutSeconds = 5): CreateScheduleRunFromSourceResult {
  return {
    scheduleRun: {
      run_id: runId,
      run_execution_id: runId,
      schedule_id: scheduleId,
    },
    timeoutSeconds,
    target: {
      kind: "agent",
      id: "job-submission-orchestrator",
    },
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
    // deno-lint-ignore no-explicit-any
    (Deno as any).exit = originalExit;
    restoreMockFetch();
    console.log = originalConsoleLog;
    setJsonMode(false);
    restoreEnvironment();
    _resetEnvironmentConfig();
    clearProjectAgentRuntimeRegistries();
  });

  it("runs a pushed schedule without importing local runtime source", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-schedule-remote-" });
    const configHome = await Deno.makeTempDir({ prefix: "vf-schedule-remote-config-home-" });
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const responses = [
      jsonResponse({
        schedules: [{
          id: scheduleId,
          name: "Process job submissions",
          status: "active",
          target: {
            kind: "agent",
            id: "job-submission-orchestrator",
          },
          definition_source: "source",
          source_trigger_id: "process-job-submissions",
          timeout_seconds: 1800,
        }],
        source_schedules: [],
      }),
      jsonResponse({
        run_id: runId,
        run_execution_id: runId,
        schedule_id: scheduleId,
      }, 201),
      jsonResponse(makeRun({ target: null })),
    ];
    const output: string[] = [];

    const configExecutedSentinel = `${projectDir}/config-executed.sentinel`;

    try {
      await Deno.mkdir(`${projectDir}/schedules`, { recursive: true });
      // Detect execution two ways: a side effect (sentinel file) and a
      // competing projectSlug that would win over veryfront.json if the
      // module were ever imported.
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        `Deno.writeTextFileSync(${JSON.stringify(configExecutedSentinel)}, "executed");\n` +
          'export default { projectSlug: "module-config-must-not-run" };\n',
      );
      await Deno.writeTextFile(
        `${projectDir}/veryfront.json`,
        JSON.stringify({
          apiUrl: TEST_PUBLIC_API_ORIGIN,
          apiToken: "config-token",
          projectSlug: "json-only-project",
        }) + "\n",
      );
      await Deno.writeTextFile(
        `${projectDir}/schedules/unrelated-broken.ts`,
        "export default nope(",
      );

      Deno.env.delete("VERYFRONT_API_URL");
      Deno.env.delete("VERYFRONT_API_TOKEN");
      Deno.env.delete("VERYFRONT_PROJECT_SLUG");
      Deno.env.set("XDG_CONFIG_HOME", configHome);
      _resetEnvironmentConfig();
      setJsonMode(true);
      console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
      installMockFetch(
        (async (
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
        }) as typeof fetch,
      );
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = (code = 0) => {
        throw new ExitSentinel(code);
      };

      let exitCode: number | undefined;
      try {
        await handleScheduleCommand({
          _: ["schedule", "run", "process-job-submissions"],
          "project-dir": projectDir,
          remote: true,
          json: true,
        } as ParsedArgs);
      } catch (error) {
        if (!(error instanceof ExitSentinel)) throw error;
        exitCode = error.code;
      }

      assertEquals(exitCode, 0);
      assertEquals(
        await Deno.stat(configExecutedSentinel).then(() => true, () => false),
        false,
        "remote schedule run must not execute local veryfront.config.ts",
      );
      assertEquals(requests.map((request) => request.url), [
        `${TEST_PUBLIC_API_ORIGIN}/projects/json-only-project/schedules?status=active&source_trigger_id=process-job-submissions`,
        `${TEST_PUBLIC_API_ORIGIN}/projects/json-only-project/schedules/${scheduleId}/runs`,
        `${TEST_PUBLIC_API_ORIGIN}/runs/${encodeURIComponent(runId)}`,
      ]);
      assertEquals(
        requests.map((request) => new Headers(request.init?.headers).get("Authorization")),
        [
          "Bearer config-token",
          "Bearer config-token",
          "Bearer config-token",
        ],
      );
      const createRunBody = JSON.parse(String(requests[1]?.init?.body));
      assertEquals(createRunBody.run_name, "Process job submissions");
      assertEquals(typeof createRunBody.idempotency_key, "string");
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
      await Deno.remove(configHome, { recursive: true });
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

  it("propagates a configured local timeout signal to the target", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "vf-schedule-local-timeout-" });
    const output: string[] = [];

    try {
      await Deno.mkdir(`${projectDir}/schedules`, { recursive: true });
      await Deno.mkdir(`${projectDir}/tasks`, { recursive: true });
      await Deno.writeTextFile(
        `${projectDir}/veryfront.config.ts`,
        "export default {};\n",
      );
      await Deno.writeTextFile(
        `${projectDir}/schedules/timed-task.ts`,
        [
          "export default {",
          '  id: "timed-task",',
          '  schedule: "0 8 * * *",',
          '  target: { kind: "task", id: "signal-aware" },',
          "  timeoutSeconds: 30,",
          "};",
          "",
        ].join("\n"),
      );
      await Deno.writeTextFile(
        `${projectDir}/tasks/signal-aware.ts`,
        [
          "export default {",
          '  name: "Signal aware",',
          "  run({ signal }) {",
          "    return { signalPresent: signal instanceof AbortSignal };",
          "  },",
          "};",
          "",
        ].join("\n"),
      );

      setJsonMode(true);
      console.log = (...args: unknown[]) => output.push(args.map(String).join(" "));
      // deno-lint-ignore no-explicit-any
      (Deno as any).exit = (code = 0) => {
        throw new ExitSentinel(code);
      };

      let exitCode: number | undefined;
      try {
        await handleScheduleCommand({
          _: ["schedule", "run", "timed-task"],
          "project-dir": projectDir,
          json: true,
        } as ParsedArgs);
      } catch (error) {
        if (!(error instanceof ExitSentinel)) throw error;
        exitCode = error.code;
      }

      assertEquals(exitCode, 0);
      assertEquals(JSON.parse(output.at(-1) ?? "{}").data.output, {
        signalPresent: true,
      });
    } finally {
      await stopEsbuild();
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("remote schedule polling", () => {
  it("falls back to the pushed schedule target when the run target is unavailable", () => {
    const fallback = { kind: "agent" as const, id: "pushed-orchestrator" };
    assertEquals(resolveRemoteScheduleTarget(makeRun({ target: null }), fallback), fallback);
    assertEquals(
      resolveRemoteScheduleTarget(makeRun({ target: "eval:unsupported" }), fallback),
      fallback,
    );
    assertEquals(
      resolveRemoteScheduleTarget(makeRun({ target: "task:Invalid Target" }), fallback),
      fallback,
    );
    assertEquals(
      resolveRemoteScheduleTarget(makeRun({ target: `task:${"x".repeat(257)}` }), fallback),
      fallback,
    );
    assertThrows(
      () =>
        resolveRemoteScheduleTarget(
          makeRun({ target: "eval:unsupported" }),
          { kind: "task", id: "Invalid Target" } as never,
        ),
      Error,
      "Remote schedule returned an invalid target.",
    );
  });

  it("preserves fallback conversation addressing when the run target matches", () => {
    const fallback = {
      kind: "agent" as const,
      id: "job-submission-orchestrator",
      conversationMode: "create_new" as const,
    };

    assertEquals(
      resolveRemoteScheduleTarget(
        makeRun({ target: "agent:job-submission-orchestrator" }),
        fallback,
      ),
      fallback,
    );
    assertEquals(
      resolveRemoteScheduleTarget(makeRun({ target: "agent:different-orchestrator" }), fallback),
      { kind: "agent", id: "different-orchestrator" },
    );
  });

  it("preserves the waiting reason in caller-visible output", () => {
    assertEquals(
      formatRemoteScheduleRunOutput(
        makeRun({
          status: "waiting",
          waiting_reason: "awaiting_human",
          output: null,
          completed_at: null,
        }),
      ),
      {
        runId,
        status: "waiting",
        waitingReason: "awaiting_human",
        result: null,
      },
    );
  });

  it("uses the accepted cloud schedule timeout instead of the local definition", async () => {
    const runs = [
      makeRun({
        status: "pending",
        output: null,
        completed_at: null,
        timeout_seconds: null,
      }),
      makeRun({
        status: "running",
        output: null,
        completed_at: null,
        timeout_seconds: null,
      }),
      makeRun({ timeout_seconds: null }),
    ];
    const client = {
      get: (requestedRunId: string) => {
        assertEquals(requestedRunId, runId);
        const run = runs.shift();
        if (!run) throw new Error("Unexpected poll");
        return Promise.resolve(run);
      },
    } satisfies Pick<VeryfrontRunsClient, "get">;
    let now = 0;

    const run = await waitForRemoteScheduleRun(
      client,
      makeAcceptedScheduleRun(1800),
      {
        now: () => now,
        sleep: () => {
          now += 36_000;
          return Promise.resolve();
        },
      },
    );

    assertEquals(run.status, "completed");
  });

  it("rejects invalid cloud timeout metadata before polling", async () => {
    let polls = 0;
    const client = {
      get: () => {
        polls++;
        return Promise.resolve(makeRun());
      },
    } satisfies Pick<VeryfrontRunsClient, "get">;

    for (const timeoutSeconds of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assertRejects(
        () =>
          waitForRemoteScheduleRun(
            client,
            makeAcceptedScheduleRun(timeoutSeconds),
          ),
        Error,
        "Remote schedule returned an invalid execution timeout.",
      );
    }
    assertEquals(polls, 0);
  });

  it("does not spend the execution timeout while the remote run is queued", async () => {
    const runs = [
      makeRun({ status: "pending", output: null, completed_at: null, started_at: null }),
      makeRun({ status: "pending", output: null, completed_at: null, started_at: null }),
      makeRun({
        status: "running",
        output: null,
        completed_at: null,
        started_at: "1970-01-01T00:02:00.000Z",
      }),
      makeRun({
        started_at: "1970-01-01T00:02:00.000Z",
        completed_at: "1970-01-01T00:02:00.500Z",
      }),
    ];
    const client = {
      get: (requestedRunId: string) => {
        assertEquals(requestedRunId, runId);
        const run = runs.shift();
        if (!run) throw new Error("Unexpected poll");
        return Promise.resolve(run);
      },
    } satisfies Pick<VeryfrontRunsClient, "get">;
    let now = 0;

    const run = await waitForRemoteScheduleRun(client, makeAcceptedScheduleRun(1), {
      now: () => now,
      sleep: () => {
        now += 60_000;
        return Promise.resolve();
      },
    });

    assertEquals(run.status, "completed");
  });

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

    const run = await waitForRemoteScheduleRun(client, makeAcceptedScheduleRun(), {
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

    const run = await waitForRemoteScheduleRun(client, makeAcceptedScheduleRun());

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
      () => waitForRemoteScheduleRun(client, makeAcceptedScheduleRun()),
      Error,
      "Hosted agent execution failed",
    );
  });

  it("reports cancelled runs as failures", async () => {
    const client = {
      get: () => Promise.resolve(makeRun({ status: "cancelled" })),
    } satisfies Pick<VeryfrontRunsClient, "get">;

    await assertRejects(
      () => waitForRemoteScheduleRun(client, makeAcceptedScheduleRun()),
      Error,
      `Scheduled run was cancelled: ${runId}`,
    );
  });

  it("stops polling at the remote schedule deadline", async () => {
    const client = {
      get: () =>
        Promise.resolve(
          makeRun({
            status: "running",
            completed_at: null,
            timeout_seconds: null,
            started_at: "1970-01-01T00:00:00.000Z",
          }),
        ),
    } satisfies Pick<VeryfrontRunsClient, "get">;
    let now = 0;

    await assertRejects(
      () =>
        waitForRemoteScheduleRun(client, makeAcceptedScheduleRun(1), {
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

  it("uses the timeout recorded on the cloud run once execution starts", async () => {
    const client = {
      get: () =>
        Promise.resolve(
          makeRun({
            status: "running",
            completed_at: null,
            timeout_seconds: 1,
            started_at: "1970-01-01T00:00:00.000Z",
          }),
        ),
    } satisfies Pick<VeryfrontRunsClient, "get">;
    let now = 0;

    await assertRejects(
      () =>
        waitForRemoteScheduleRun(client, makeAcceptedScheduleRun(1800), {
          now: () => now,
          sleep: () => {
            now += 32_000;
            return Promise.resolve();
          },
        }),
      Error,
      `Timed out waiting for scheduled run: ${runId}`,
    );
  });

  it("falls back when the cloud run records an unsafe timeout", async () => {
    const client = {
      get: () =>
        Promise.resolve(
          makeRun({
            status: "running",
            completed_at: null,
            timeout_seconds: Number.MAX_SAFE_INTEGER + 1,
            started_at: "1970-01-01T00:00:00.000Z",
          }),
        ),
    } satisfies Pick<VeryfrontRunsClient, "get">;
    let now = 0;

    await assertRejects(
      () =>
        waitForRemoteScheduleRun(client, makeAcceptedScheduleRun(1), {
          now: () => now,
          sleep: () => {
            now += 32_000;
            return Promise.resolve();
          },
        }),
      Error,
      `Timed out waiting for scheduled run: ${runId}`,
    );
  });

  it("stops polling when a remote run never leaves the queue", async () => {
    const client = {
      get: () =>
        Promise.resolve(
          makeRun({ status: "pending", output: null, completed_at: null, started_at: null }),
        ),
    } satisfies Pick<VeryfrontRunsClient, "get">;
    let now = 0;

    await assertRejects(
      () =>
        waitForRemoteScheduleRun(client, makeAcceptedScheduleRun(1), {
          now: () => now,
          sleep: () => {
            now += 60_000;
            return Promise.resolve();
          },
        }),
      Error,
      `Timed out waiting for scheduled run to start: ${runId}`,
    );
  });
});

describe("local schedule execution boundaries", () => {
  it("requires input overrides to contain a JSON object", () => {
    const input = { queue: "priority" };
    assertEquals(normalizeLocalScheduleInput(input), input);

    for (const value of [null, "priority", 42, true, []]) {
      const error = assertThrows(
        () => normalizeLocalScheduleInput(value),
        VeryfrontError,
        "--input JSON file must contain a JSON object.",
      );
      assertInstanceOf(error, VeryfrontError);
      assertEquals(error.slug, "invalid-argument");
    }
  });

  it("preserves long execution deadlines with bounded timer chunks", () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const timeout = createLocalScheduleTimeout(5, {
      maxDelaySeconds: 2,
      setTimer: (callback, delayMs) => {
        callbacks.push(callback);
        delays.push(delayMs);
        return callbacks.length as unknown as ReturnType<typeof setTimeout>;
      },
      clearTimer: () => {},
    });

    assertEquals(timeout.signal?.aborted, false);
    assertEquals(delays, [2_000]);

    callbacks.shift()?.();
    assertEquals(timeout.signal?.aborted, false);
    assertEquals(delays, [2_000, 2_000]);

    callbacks.shift()?.();
    assertEquals(timeout.signal?.aborted, false);
    assertEquals(delays, [2_000, 2_000, 1_000]);

    callbacks.shift()?.();
    assertEquals(timeout.signal?.aborted, true);
    assertEquals(timeout.signal?.reason instanceof DOMException, true);
    assertEquals(timeout.signal?.reason.name, "TimeoutError");
  });

  it("disposes the active execution timer after completion", () => {
    const cleared: number[] = [];
    const timeout = createLocalScheduleTimeout(30, {
      setTimer: () => 17 as unknown as ReturnType<typeof setTimeout>,
      clearTimer: (timerId) => cleared.push(timerId as unknown as number),
    });

    timeout.dispose();
    timeout.dispose();

    assertEquals(cleared, [17]);
    assertEquals(timeout.signal?.aborted, false);
    assertEquals(createLocalScheduleTimeout(undefined).signal, undefined);
  });
});

describe("schedule/handler agent run options", () => {
  const agentSchedule = {
    id: "triage-new-cases",
    schedule: "*/10 * * * *",
    target: { kind: "agent", id: "case-triage" },
  } as const satisfies ScheduleDefinition;

  it("reads the conversation mode from the canonical target", () => {
    const error = assertThrows(
      () =>
        toScheduleAgentOptions(
          {
            ...agentSchedule,
            target: {
              kind: "agent",
              id: "case-triage",
              conversationMode: "existing",
              conversationId: "11111111-1111-4111-8111-111111111111",
            },
          },
          {},
        ),
      VeryfrontError,
      "Local scheduled agent runs cannot attach to an existing cloud conversation.",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });

  it("still reads the legacy input._schedule_target conversation mode", () => {
    const error = assertThrows(
      () =>
        toScheduleAgentOptions(agentSchedule, {
          _schedule_target: {
            conversationMode: "existing",
            conversationId: "11111111-1111-4111-8111-111111111111",
          },
        }),
      VeryfrontError,
      "Local scheduled agent runs cannot attach to an existing cloud conversation.",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });

  it("rejects a misspelled legacy key in an operator --input file", () => {
    const error = assertThrows(
      () =>
        toScheduleAgentOptions(agentSchedule, {
          _schedule_target: { converstionMode: "existing" },
        }),
      VeryfrontError,
      "Schedule input._schedule_target.converstionMode is not supported.",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });

  it("rejects an unusable legacy conversation mode in an operator --input file", () => {
    const error = assertThrows(
      () =>
        toScheduleAgentOptions(agentSchedule, {
          _schedule_target: { conversationMode: "bogus" },
        }),
      VeryfrontError,
      "Schedule input._schedule_target.conversationMode must be create_new, existing, or none.",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });

  it("keeps a well-formed legacy declaration working", () => {
    const options = toScheduleAgentOptions(agentSchedule, {
      _schedule_target: { conversationMode: "create_new" },
    });

    assertEquals(typeof options.agentInput, "string");
  });

  it("allows every other conversation mode", () => {
    const options = toScheduleAgentOptions(
      {
        ...agentSchedule,
        target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
      },
      {},
    );

    assertEquals(options.agentInput, "Run scheduled agent case-triage for triage-new-cases");
  });

  // A `--input` file replaces the authored input without passing through
  // `schedule()`, so the agreement both fallbacks rely on is re-established
  // here instead of assumed.
  it("rejects an input prompt that disagrees with the definition prompt", () => {
    const error = assertThrows(
      () =>
        toScheduleAgentOptions(
          { ...agentSchedule, agentMessage: { prompt: "DEFINITION PROMPT" } },
          { prompt: "OPERATOR OVERRIDE" },
        ),
      VeryfrontError,
      "Schedule agentMessage.prompt and input.prompt are both set to different values. Declare it in one place.",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });

  it("rejects an input conversation mode that disagrees with the definition target", () => {
    const error = assertThrows(
      () =>
        toScheduleAgentOptions(
          {
            ...agentSchedule,
            target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
          },
          {
            _schedule_target: {
              conversationMode: "existing",
              conversationId: "11111111-1111-4111-8111-111111111111",
            },
          },
        ),
      VeryfrontError,
      "Schedule target.conversationMode and input._schedule_target.conversationMode are both set to different values. Declare it in one place.",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });

  it("rejects an input conversation id that disagrees with the definition target", () => {
    const error = assertThrows(
      () =>
        toScheduleAgentOptions(
          {
            ...agentSchedule,
            target: {
              kind: "agent",
              id: "case-triage",
              conversationMode: "existing",
              conversationId: "22222222-2222-4222-8222-222222222222",
            },
          },
          {
            _schedule_target: {
              conversationMode: "existing",
              conversationId: "11111111-1111-4111-8111-111111111111",
            },
          },
        ),
      VeryfrontError,
      "Schedule target.conversationId and input._schedule_target.conversationId are both set to different values. Declare it in one place.",
    );
    assertInstanceOf(error, VeryfrontError);
    assertEquals(error.slug, "invalid-argument");
  });

  it("accepts a conversation mode declared identically in both places", () => {
    const options = toScheduleAgentOptions(
      {
        ...agentSchedule,
        target: { kind: "agent", id: "case-triage", conversationMode: "create_new" },
        agentMessage: { prompt: "Triage every open case." },
      },
      {
        _schedule_target: { conversationMode: "create_new" },
        prompt: "Triage every open case.",
      },
    );

    assertEquals(options.agentInput, "Triage every open case.");
  });

  // Reading either copy yields the authored prompt: a disagreement is rejected
  // above, so the fallback can never drop author-supplied content.
  it("reads the prompt from either declaration", () => {
    assertEquals(
      toScheduleAgentOptions(
        { ...agentSchedule, agentMessage: { prompt: "Triage every open case." } },
        { prompt: "Triage every open case." },
      ).agentInput,
      "Triage every open case.",
    );
    assertEquals(
      toScheduleAgentOptions(
        { ...agentSchedule, agentMessage: { prompt: "Triage every open case." } },
        {},
      ).agentInput,
      "Triage every open case.",
    );
    assertEquals(
      toScheduleAgentOptions(agentSchedule, { prompt: "Legacy prompt." }).agentInput,
      "Legacy prompt.",
    );
  });

  it("returns no agent options for non-agent targets", () => {
    assertEquals(
      toScheduleAgentOptions(
        { ...agentSchedule, target: { kind: "workflow", id: "escalate-ticket" } },
        { _schedule_target: { conversationMode: "existing" } },
      ),
      {},
    );
  });
});
