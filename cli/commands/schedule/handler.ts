import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
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
import { runTriggerTarget } from "veryfront/trigger";
import { outputTriggerRun, readJsonFile } from "../trigger-utils.ts";

const REMOTE_SCHEDULE_POLL_INTERVAL_MS = 1_000;
const REMOTE_SCHEDULE_TIMEOUT_GRACE_MS = 30_000;

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
  const deadline = now() +
    accepted.timeoutSeconds * 1_000 +
    REMOTE_SCHEDULE_TIMEOUT_GRACE_MS;
  while (true) {
    const run = await client.get(runId);
    if (run.status === "completed" || run.status === "waiting") {
      return run;
    }
    if (run.status === "failed") {
      throw new Error(run.error?.message ?? `Scheduled run failed: ${runId}`);
    }
    if (run.status === "cancelled") {
      throw new Error(`Scheduled run was cancelled: ${runId}`);
    }
    if (now() >= deadline) {
      throw new Error(`Timed out waiting for scheduled run: ${runId}`);
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

export async function handleScheduleCommand(args: ParsedArgs): Promise<void> {
  const opts: ScheduleArgs = parseArgsOrThrow(parseScheduleArgs, "schedule", args);
  const projectDir = Deno.cwd();
  if (opts.remote && opts.input) {
    throw new Error(
      "Remote schedule runs use the source already pushed to Veryfront and do not accept --input.",
    );
  }
  const input = opts.input ? await readJsonFile(opts.input, "--input JSON file") : undefined;

  await withProjectSourceContext(projectDir, async (context) => {
    const { adapter, config, configCacheKey, projectId } = context;
    const result = await discoverSchedules({ projectDir, adapter, config });
    if (result.errors.length > 0) {
      throw new Error(`Schedule discovery failed: ${result.errors[0]?.message}`);
    }

    const schedule = result.items.find((candidate) => candidate.id === opts.id);
    if (!schedule) {
      throw new Error(`Schedule "${opts.id}" not found.`);
    }

    if (opts.remote) {
      const startedAt = Date.now();
      const client = createRunsClient({
        projectReference: config.projectSlug,
      });
      const accepted = await client.createScheduleRunFromSource({
        sourceTriggerId: schedule.id,
        runName: schedule.name ?? schedule.id,
        idempotencyKey: `schedule-cli:${crypto.randomUUID()}`,
      });
      const remoteRun = await waitForRemoteScheduleRun(
        client,
        accepted,
      );
      await outputTriggerRun({
        command: "schedule",
        triggerId: schedule.id,
        target: schedule.target,
        output: formatRemoteScheduleRunOutput(remoteRun),
        durationMs: remoteRun.duration_ms ?? Date.now() - startedAt,
      });
      return;
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
