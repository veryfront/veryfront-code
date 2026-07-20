import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import { withProjectSourceContext } from "#cli/shared/project-source-context";
import type { ParsedArgs } from "#cli/shared/types";
import { exitProcess } from "#cli/utils";
import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { discoverSchedules } from "veryfront/schedule";
import { runTriggerTarget } from "veryfront/trigger";
import { outputTriggerRun, readJsonFile } from "../trigger-utils.ts";

const getScheduleArgsSchema = defineSchema((v) =>
  v.object({
    action: v.literal("run"),
    id: v.string(),
    input: v.string().optional(),
    debug: v.boolean().default(false),
  })
);

const ScheduleArgsSchema = lazySchema(getScheduleArgsSchema);

type ScheduleArgs = InferSchema<ReturnType<typeof getScheduleArgsSchema>>;

const parseScheduleArgs = createArgParser(ScheduleArgsSchema, {
  action: { keys: ["action"], type: "string", positional: 0 },
  id: { keys: ["id"], type: "string", positional: 1 },
  input: { keys: ["input"], type: "string" },
  debug: { keys: ["debug"], type: "boolean" },
});

export async function handleScheduleCommand(args: ParsedArgs): Promise<void> {
  const opts: ScheduleArgs = parseArgsOrThrow(parseScheduleArgs, "schedule", args);
  const projectDir = Deno.cwd();
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
