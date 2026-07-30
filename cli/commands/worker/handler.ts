import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { MAX_TIMER_DELAY_MS } from "veryfront/utils";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getWorkerArgsSchema = defineSchema((v) =>
  v.object({
    concurrency: v.number().int().positive().max(Number.MAX_SAFE_INTEGER).default(3),
    pollInterval: v.number().int().positive().max(MAX_TIMER_DELAY_MS).default(5000),
    stalledThreshold: v.number().int().positive().max(MAX_TIMER_DELAY_MS).default(60000),
    executor: v.enum(["process"]).default("process"),
    entrypoint: v.string().optional(),
    projectDir: v.string().optional(),
    debug: v.boolean().default(false),
  })
);

const WorkerArgsSchema = lazySchema(getWorkerArgsSchema);

export type WorkerArgs = InferSchema<ReturnType<typeof getWorkerArgsSchema>>;

export const parseWorkerArgs = createArgParser(WorkerArgsSchema, {
  concurrency: { keys: ["concurrency", "c"], type: "number" },
  pollInterval: { keys: ["poll-interval"], type: "number" },
  stalledThreshold: { keys: ["stalled-threshold"], type: "number" },
  executor: { keys: ["executor", "e"], type: "string" },
  entrypoint: { keys: ["entrypoint"], type: "string" },
  projectDir: { keys: ["project-dir"], type: "string" },
  debug: { keys: ["debug"], type: "boolean" },
});

export async function handleWorkerCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseWorkerArgs, "worker", args);
  const { workerCommand } = await import("./command.ts");
  await workerCommand(opts);
}
