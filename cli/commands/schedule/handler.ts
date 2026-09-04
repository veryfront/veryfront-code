import { CommonArgs, createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { resolveConfigWithAuthNoModule } from "#cli/shared/config";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess } from "#cli/utils";
import { defineSchema, lazySchema } from "veryfront/schemas";
import {
  DEPLOYMENT_ERROR,
  DEPLOYMENT_VERIFICATION_TIMEOUT,
  INVALID_ARGUMENT,
  RESOURCE_NOT_FOUND,
} from "veryfront/errors";
import type { InferSchema } from "veryfront/extensions/schema";
import {
  createRunsClient,
  type CreateScheduleRunFromSourceResult,
  type Run,
  type VeryfrontRunsClient,
} from "veryfront/runs";
import {
  discoverSchedules,
  legacyScheduleTargetDiagnostic,
  type ScheduleDefinition,
} from "veryfront/schedule";
import {
  conversationConflictDiagnostic,
  declarationConflictDiagnostic,
  isTriggerId,
  isTriggerTarget,
  type ResolvedTriggerTarget,
  runTriggerTarget,
  type TriggerTarget,
} from "veryfront/trigger";
import { outputTriggerList, outputTriggerRun, readJsonFile } from "../trigger-utils.ts";

const REMOTE_SCHEDULE_POLL_INTERVAL_MS = 1_000;
const REMOTE_SCHEDULE_TIMEOUT_GRACE_MS = 30_000;
// Bound how long the CLI waits for dispatch without consuming the cloud run's
// execution budget. The run remains durable in Veryfront if this wait expires.
const REMOTE_SCHEDULE_QUEUE_WAIT_TIMEOUT_MS = 5 * 60_000;
// Deno and Node both clamp longer setTimeout delays. Chaining bounded chunks
// preserves the authored timeout instead of firing early after host coercion.
const MAX_HOST_TIMER_DELAY_MS = 2 ** 31 - 1;
const MAX_TIMER_DELAY_SECONDS = Math.floor(MAX_HOST_TIMER_DELAY_MS / 1_000);

const getScheduleArgsSchema = defineSchema((v) =>
  v.object({
    action: v.enum(["run", "list"]).optional(),
    id: v.string().optional(),
    input: v.string().optional(),
    projectDir: v.string().optional(),
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
  projectDir: CommonArgs.projectDir,
  remote: { keys: ["remote"], type: "boolean" },
  debug: { keys: ["debug"], type: "boolean" },
});

function formatSchedule(schedule: ScheduleDefinition): string {
  return `${schedule.id} -> ${schedule.target.kind}:${schedule.target.id} (${schedule.schedule})`;
}

async function handleScheduleList(projectDir: string): Promise<void> {
  await withProjectSourceContext(projectDir, async ({ adapter, config }) => {
    const result = await discoverSchedules({
      projectDir,
      adapter,
      config,
      allowHostProjectCodeExecution: true,
    });
    await outputTriggerList({
      command: "schedules",
      items: result.items,
      errors: result.errors,
      formatItem: formatSchedule,
    });
  });
}

interface RemoteSchedulePollOptions {
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
}

interface LocalScheduleTimeoutOptions {
  maxDelaySeconds?: number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timerId: ReturnType<typeof setTimeout>) => void;
}

export interface LocalScheduleTimeout {
  readonly signal: AbortSignal | undefined;
  dispose(): void;
}

/**
 * Create a disposable cooperative timeout for one local schedule execution.
 *
 * Long durations are armed in bounded chunks so timer coercion cannot shorten
 * the configured deadline.
 */
export function createLocalScheduleTimeout(
  timeoutSeconds: number | undefined,
  options: LocalScheduleTimeoutOptions = {},
): LocalScheduleTimeout {
  if (timeoutSeconds === undefined) {
    return { signal: undefined, dispose() {} };
  }
  if (!Number.isSafeInteger(timeoutSeconds) || timeoutSeconds <= 0) {
    throw new TypeError("Local schedule timeout must be a positive safe integer.");
  }

  const maxDelaySeconds = options.maxDelaySeconds ?? MAX_TIMER_DELAY_SECONDS;
  if (!Number.isSafeInteger(maxDelaySeconds) || maxDelaySeconds <= 0) {
    throw new TypeError("Local schedule timer chunk must be a positive safe integer.");
  }

  const setTimer = options.setTimer ?? globalThis.setTimeout;
  const clearTimer = options.clearTimer ?? globalThis.clearTimeout;
  const controller = new AbortController();
  let remainingSeconds = timeoutSeconds;
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;

  const armNextChunk = (): void => {
    if (disposed || controller.signal.aborted) return;
    const delaySeconds = Math.min(remainingSeconds, maxDelaySeconds);
    remainingSeconds -= delaySeconds;
    timerId = setTimer(() => {
      timerId = undefined;
      if (disposed) return;
      if (remainingSeconds > 0) {
        armNextChunk();
        return;
      }
      controller.abort(
        new DOMException(
          "Local schedule execution exceeded its configured timeout.",
          "TimeoutError",
        ),
      );
    }, delaySeconds * 1_000);
  };

  armNextChunk();
  return {
    signal: controller.signal,
    dispose(): void {
      disposed = true;
      if (timerId !== undefined) {
        clearTimer(timerId);
        timerId = undefined;
      }
    },
  };
}

export function normalizeLocalScheduleInput(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw INVALID_ARGUMENT.create({
      detail: "--input JSON file must contain a JSON object.",
    });
  }
  return value as Record<string, unknown>;
}

/** Read the conversation pair from the legacy `input._schedule_target` channel. */
function readLegacyScheduleConversation(
  input: Record<string, unknown>,
): { conversationMode: unknown; conversationId: unknown } {
  const legacyTarget = input._schedule_target;
  if (!legacyTarget || typeof legacyTarget !== "object" || Array.isArray(legacyTarget)) {
    return { conversationMode: undefined, conversationId: undefined };
  }
  const record = legacyTarget as Record<string, unknown>;
  return {
    conversationMode: record.conversationMode,
    conversationId: record.conversationId,
  };
}

/**
 * Build the local agent run options for one scheduled occurrence.
 *
 * Addressing comes from the canonical target, falling back to the legacy
 * `input._schedule_target` channel written by older SDKs. Prompt content comes
 * from `agentMessage.prompt`, falling back to the legacy `input.prompt`.
 *
 * Neither fallback may drop authored content, and this function is what
 * supplies that invariant here: `--input` replaces the authored input without
 * passing through `schedule()`, so an operator file can disagree with the
 * definition no matter what the definition itself was validated against. Two
 * declarations of one value that disagree are rejected rather than resolved,
 * leaving only the equal-or-absent case for the fallbacks to read.
 */
export function toScheduleAgentOptions(
  schedule: ScheduleDefinition,
  input: Record<string, unknown>,
): { agentInput?: string; agentContext?: Record<string, unknown> } {
  const target = schedule.target;
  if (target.kind !== "agent") return {};

  const legacyConversation = readLegacyScheduleConversation(input);
  // `--input <file>` never passes through `schedule()`, so the operator file's
  // own shape is unvalidated until here. Without this, a misspelled key or a
  // bogus mode in that file is read as absent and the run silently proceeds
  // standalone -- the same silent drop this contract exists to remove.
  const legacyTargetDetail = legacyScheduleTargetDiagnostic(input, legacyConversation);
  if (legacyTargetDetail !== null) {
    throw INVALID_ARGUMENT.create({ detail: legacyTargetDetail });
  }

  const conflictDetail = conversationConflictDiagnostic(
    "Schedule",
    "input._schedule_target",
    target,
    legacyConversation.conversationMode,
    legacyConversation.conversationId,
  ) ??
    declarationConflictDiagnostic(
      "Schedule",
      "agentMessage.prompt",
      "input.prompt",
      schedule.agentMessage?.prompt,
      input.prompt,
    );
  if (conflictDetail !== null) {
    throw INVALID_ARGUMENT.create({ detail: conflictDetail });
  }

  const conversationMode = target.conversationMode ??
    legacyConversation.conversationMode;
  if (conversationMode === "existing") {
    throw INVALID_ARGUMENT.create({
      detail: "Local scheduled agent runs cannot attach to an existing cloud conversation.",
    });
  }

  const scheduleName = schedule.name ?? schedule.id;
  const prompt = schedule.agentMessage?.prompt ?? input.prompt;
  return {
    agentInput: typeof prompt === "string" && prompt.trim().length > 0
      ? prompt
      : `Run scheduled agent ${target.id} for ${scheduleName}`,
    agentContext: {
      trigger: "schedule",
      schedule: { id: schedule.id, name: scheduleName },
      forwardedProps: input,
    },
  };
}

export async function waitForRemoteScheduleRun(
  client: Pick<VeryfrontRunsClient, "get">,
  accepted: CreateScheduleRunFromSourceResult,
  options: RemoteSchedulePollOptions = {},
): Promise<Run> {
  if (
    !Number.isSafeInteger(accepted.timeoutSeconds) ||
    accepted.timeoutSeconds <= 0
  ) {
    throw new Error("Remote schedule returned an invalid execution timeout.");
  }
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
      throw DEPLOYMENT_ERROR.create({
        detail: run.error?.message ?? `Scheduled run failed: ${runId}`,
      });
    }
    if (run.status === "cancelled") {
      throw DEPLOYMENT_ERROR.create({ detail: `Scheduled run was cancelled: ${runId}` });
    }
    const recordedTimeoutSeconds = run.timeout_seconds;
    const executionTimeoutSeconds = Number.isSafeInteger(recordedTimeoutSeconds) &&
        recordedTimeoutSeconds !== null &&
        recordedTimeoutSeconds > 0
      ? recordedTimeoutSeconds
      : accepted.timeoutSeconds;
    const executionDeadline = executionStartedAtMs === undefined
      ? undefined
      : executionStartedAtMs + executionTimeoutSeconds * 1_000 +
        REMOTE_SCHEDULE_TIMEOUT_GRACE_MS;
    if (executionDeadline !== undefined && observedAt >= executionDeadline) {
      throw DEPLOYMENT_VERIFICATION_TIMEOUT.create({
        detail: `Timed out waiting for scheduled run: ${runId}`,
      });
    }
    if (executionStartedAtMs === undefined && observedAt >= queueDeadline) {
      throw DEPLOYMENT_VERIFICATION_TIMEOUT.create({
        detail: `Timed out waiting for scheduled run to start: ${runId}`,
      });
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

export function resolveRemoteScheduleTarget(
  run: Run,
  fallback: TriggerTarget,
): ResolvedTriggerTarget {
  const fallbackTarget = isTriggerTarget(fallback) ? { ...fallback } : null;
  if (!run.target) {
    if (fallbackTarget !== null) return fallbackTarget;
    throw new Error("Remote schedule returned an invalid target.");
  }
  const separator = run.target.indexOf(":");
  if (separator < 1) {
    if (fallbackTarget !== null) return fallbackTarget;
    throw new Error("Remote schedule returned an invalid target.");
  }
  const kind = run.target.slice(0, separator);
  const id = run.target.slice(separator + 1).trim();
  const candidate = { kind, id };
  if (isTriggerTarget(candidate)) {
    if (
      fallbackTarget !== null &&
      fallbackTarget.kind === candidate.kind &&
      fallbackTarget.id === candidate.id
    ) {
      return fallbackTarget;
    }
    return candidate;
  }
  if (fallbackTarget !== null) return fallbackTarget;
  throw new Error("Remote schedule returned an invalid target.");
}

async function runRemoteSchedule(
  projectDir: string,
  opts: ScheduleArgs & { id: string },
): Promise<void> {
  const startedAt = Date.now();
  // Remote runs execute source already pushed to Veryfront; resolving
  // credentials for them must never import veryfront.config.ts/.js, which
  // would execute local (possibly untrusted) repository code.
  const cliConfig = await resolveConfigWithAuthNoModule(projectDir);
  const client = createRunsClient({
    apiUrl: cliConfig.apiUrl,
    authToken: cliConfig.apiToken,
    projectReference: cliConfig.projectSlug,
  });
  const accepted = await client.createScheduleRunFromSource({
    sourceTriggerId: opts.id,
    idempotencyKey: `schedule-cli:${crypto.randomUUID()}`,
  });
  if (!isTriggerTarget(accepted.target)) {
    throw new Error("Remote schedule returned an invalid target.");
  }
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
  const projectDir = opts.projectDir ?? Deno.cwd();

  // Dispatch "list" (also the default when no action is given)
  if (!opts.action || opts.action === "list") {
    await handleScheduleList(projectDir);
    return;
  }

  // action === "run"
  if (!opts.id) {
    throw INVALID_ARGUMENT.create({ detail: "Usage: veryfront schedule run <id>" });
  }

  if (!isTriggerId(opts.id)) {
    throw INVALID_ARGUMENT.create({ detail: `Invalid schedule id: "${opts.id}".` });
  }
  if (opts.remote && opts.input !== undefined) {
    throw INVALID_ARGUMENT.create({
      detail:
        "Remote schedule runs use the source already pushed to Veryfront and do not accept --input.",
    });
  }
  if (opts.remote) {
    await runRemoteSchedule(projectDir, opts as ScheduleArgs & { id: string });
    exitProcess(0);
    return;
  }

  await withProjectSourceContext(projectDir, async (context) => {
    const { adapter, config, configCacheKey, projectId } = context;
    const input = opts.input !== undefined
      ? await readJsonFile(opts.input, "--input JSON file")
      : undefined;
    const result = await discoverSchedules({
      projectDir,
      adapter,
      config,
      allowHostProjectCodeExecution: true,
    });
    if (result.errors.length > 0) {
      throw DEPLOYMENT_ERROR.create({
        detail: `Schedule discovery failed: ${result.errors[0]?.message}`,
      });
    }

    const schedule = result.items.find((candidate) => candidate.id === opts.id);
    if (!schedule) {
      throw RESOURCE_NOT_FOUND.create({ detail: `Schedule "${opts.id}" not found.` });
    }

    const triggerInput = normalizeLocalScheduleInput(
      opts.input === undefined ? schedule.input ?? {} : input,
    );
    const agentRunOptions = toScheduleAgentOptions(schedule, triggerInput);

    const timeout = createLocalScheduleTimeout(schedule.timeoutSeconds);
    const run = await (async () => {
      try {
        return await runTriggerTarget({
          projectDir,
          adapter,
          config,
          cacheKey: configCacheKey,
          projectId,
          target: schedule.target,
          input: triggerInput,
          ...agentRunOptions,
          signal: timeout.signal,
          debug: opts.debug,
        });
      } finally {
        timeout.dispose();
      }
    })();

    await outputTriggerRun({
      command: "schedule",
      triggerId: schedule.id,
      target: schedule.target,
      output: run.output,
      durationMs: run.durationMs,
    });
  });

  exitProcess(0);
}
