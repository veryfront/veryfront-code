import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { resolveConfigWithAuth } from "#cli/shared/config";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess } from "#cli/utils";
import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import {
  createRunsClient,
  type CreateScheduleRunFromSourceResult,
  type Run,
  type VeryfrontRunsClient,
} from "veryfront/runs";
import { discoverSchedules } from "veryfront/schedule";
import { runTriggerTarget, type TriggerTarget } from "veryfront/trigger";
import { outputTriggerRun, readJsonFile } from "../trigger-utils.ts";

const REMOTE_SCHEDULE_POLL_INTERVAL_MS = 1_000;
const REMOTE_SCHEDULE_TIMEOUT_GRACE_MS = 30_000;
// Bound how long the CLI waits for dispatch without consuming the cloud run's
// execution budget. The run remains durable in Veryfront if this wait expires.
const REMOTE_SCHEDULE_QUEUE_WAIT_TIMEOUT_MS = 5 * 60_000;

const getScheduleArgsSchema = defineSchema((v) =>
  v.object({
    action: v.literal("run"),
    id: v.string(),
    input: v.string().optional(),
    remote: v.boolean().default(false),
    debug: v.boolean().default(false),
  })
);

const ScheduleArgsSchema = lazySchema(getScheduleArgsSchema);

type ScheduleArgs = InferSchema<ReturnType<typeof getScheduleArgsSchema>>;

const parseScheduleArgs = createArgParser(ScheduleArgsSchema, {
  action: { keys: ["action"], type: "string", positional: 0 },
  id: { keys: ["id"], type: "string", positional: 1 },
  input: { keys: ["input"], type: "string" },
  remote: { keys: ["remote"], type: "boolean" },
  debug: { keys: ["debug"], type: "boolean" },
});

interface RemoteSchedulePollOptions {
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

export async function waitForRemoteScheduleRun(
  client: Pick<VeryfrontRunsClient, "get">,
  accepted: CreateScheduleRunFromSourceResult,
  options: RemoteSchedulePollOptions = {},
): Promise<Run> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ??
    ((delayMs: number) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const runId = accepted.scheduleRun.run_id;
  const acceptedAt = now();
  const queueDeadline = acceptedAt + REMOTE_SCHEDULE_QUEUE_WAIT_TIMEOUT_MS;
  let executionStartedAtMs: number | undefined;
  while (true) {
    const run = await client.get(runId);
    const observedAt = now();
    const parsedStartedAt = run.started_at ? Date.parse(run.started_at) : NaN;
    if (executionStartedAtMs === undefined && Number.isFinite(parsedStartedAt)) {
      executionStartedAtMs = Math.min(parsedStartedAt, observedAt);
    } else if (run.status !== "pending" && executionStartedAtMs === undefined) {
      executionStartedAtMs = observedAt;
    }
    if (run.status === "completed" || run.status === "waiting") {
      return run;
    }
    if (run.status === "failed") {
      throw new Error(run.error?.message ?? `Scheduled run failed: ${runId}`);
    }
    if (run.status === "cancelled") {
      throw new Error(`Scheduled run was cancelled: ${runId}`);
    }
    const recordedTimeoutSeconds = run.timeout_seconds;
    const executionTimeoutSeconds = recordedTimeoutSeconds !== null &&
        recordedTimeoutSeconds > 0
      ? recordedTimeoutSeconds
      : accepted.timeoutSeconds;
    const executionDeadline = executionStartedAtMs === undefined
      ? undefined
      : executionStartedAtMs + executionTimeoutSeconds * 1_000 +
        REMOTE_SCHEDULE_TIMEOUT_GRACE_MS;
    if (executionDeadline !== undefined && observedAt >= executionDeadline) {
      throw new Error(`Timed out waiting for scheduled run: ${runId}`);
    }
    if (executionStartedAtMs === undefined && observedAt >= queueDeadline) {
      throw new Error(`Timed out waiting for scheduled run to start: ${runId}`);
    }
    await sleep(REMOTE_SCHEDULE_POLL_INTERVAL_MS);
  }
}

export function formatRemoteScheduleRunOutput(run: Run): Record<string, unknown> {
  return {
    runId: run.run_id,
    status: run.status,
    ...(run.waiting_reason ? { waitingReason: run.waiting_reason } : {}),
    result: run.output,
  };
}

export function resolveRemoteScheduleTarget(run: Run, fallback: TriggerTarget): TriggerTarget {
  if (!run.target) return fallback;
  const separator = run.target.indexOf(":");
  if (separator < 1) return fallback;
  const kind = run.target.slice(0, separator);
  const id = run.target.slice(separator + 1).trim();
  if ((kind !== "agent" && kind !== "task" && kind !== "workflow") || id.length === 0) {
    return fallback;
  }
  return { kind, id };
}

async function runRemoteSchedule(projectDir: string, opts: ScheduleArgs): Promise<void> {
  const startedAt = Date.now();
  const cliConfig = await resolveConfigWithAuth(projectDir);
  const client = createRunsClient({
    apiUrl: cliConfig.apiUrl,
    authToken: cliConfig.apiToken,
    projectReference: cliConfig.projectSlug,
  });
  const accepted = await client.createScheduleRunFromSource({
    sourceTriggerId: opts.id,
    idempotencyKey: `schedule-cli:${crypto.randomUUID()}`,
  });
  const remoteRun = await waitForRemoteScheduleRun(
    client,
    accepted,
  );
  await outputTriggerRun({
    command: "schedule",
    triggerId: opts.id,
    target: resolveRemoteScheduleTarget(remoteRun, accepted.target),
    output: formatRemoteScheduleRunOutput(remoteRun),
    durationMs: remoteRun.duration_ms ?? Date.now() - startedAt,
  });
}

export async function handleScheduleCommand(args: ParsedArgs): Promise<void> {
  const opts: ScheduleArgs = parseArgsOrThrow(parseScheduleArgs, "schedule", args);
  const projectDir = Deno.cwd();
  if (opts.remote && opts.input) {
    throw new Error(
      "Invalid schedule arguments: remote runs use the source already pushed to Veryfront and do not accept --input.",
    );
  }
  if (opts.remote) {
    await runRemoteSchedule(projectDir, opts);
    exitProcess(0);
    return;
  }

  await withProjectSourceContext(projectDir, async (context) => {
    const { adapter, config, configCacheKey, projectId } = context;
    const input = opts.input ? await readJsonFile(opts.input, "--input JSON file") : undefined;
    const result = await discoverSchedules({ projectDir, adapter, config });
    if (result.errors.length > 0) {
      throw new Error(`Schedule discovery failed: ${result.errors[0]?.message}`);
    }

    const schedule = result.items.find((candidate) => candidate.id === opts.id);
    if (!schedule) {
      throw new Error(`Schedule "${opts.id}" not found.`);
    }

    const triggerInput = input ?? schedule.input ?? {};
    const scheduleConfig =
      triggerInput && typeof triggerInput === "object" && !Array.isArray(triggerInput)
        ? triggerInput as Record<string, unknown>
        : {};
    const scheduleName = schedule.name ?? schedule.id;
    const scheduleTarget = scheduleConfig._schedule_target;
    const conversationMode = scheduleTarget && typeof scheduleTarget === "object" &&
        !Array.isArray(scheduleTarget)
      ? (scheduleTarget as Record<string, unknown>).conversationMode
      : undefined;
    if (schedule.target.kind === "agent" && conversationMode === "existing") {
      throw new Error(
        "Local scheduled agent runs cannot attach to an existing cloud conversation.",
      );
    }

    const agentRunOptions = schedule.target.kind === "agent"
      ? {
        agentInput:
          typeof scheduleConfig.prompt === "string" && scheduleConfig.prompt.trim().length > 0
            ? scheduleConfig.prompt
            : `Run scheduled agent ${schedule.target.id} for ${scheduleName}`,
        agentContext: {
          trigger: "schedule",
          schedule: { id: schedule.id, name: scheduleName },
          forwardedProps: scheduleConfig,
        },
      }
      : {};

    const run = await runTriggerTarget({
      projectDir,
      adapter,
      config,
      cacheKey: configCacheKey,
      projectId,
      target: schedule.target,
      input: triggerInput,
      ...agentRunOptions,
      debug: opts.debug,
    });

    await outputTriggerRun({
      command: "schedule",
      triggerId: schedule.id,
      target: schedule.target,
      output: run.output,
      durationMs: run.durationMs,
    });
  }).catch((error: unknown) => {
    throw error;
  });

  exitProcess(0);
}
