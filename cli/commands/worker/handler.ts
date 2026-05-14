import { defineSchema, lazySchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getWorkerArgsSchema = defineSchema((v) =>
  v.object({
    redisUrl: v.string().default("redis://localhost:6379"),
    concurrency: v.number().default(3),
    pollInterval: v.number().default(5000),
    stalledThreshold: v.number().default(60000),
    executor: v.enum(["process", "k8s"]).default("process"),
    entrypoint: v.string().optional(),
    debug: v.boolean().default(false),
  })
);

const WorkerArgsSchema = lazySchema(getWorkerArgsSchema);

export type WorkerArgs = InferSchema<ReturnType<typeof getWorkerArgsSchema>>;

export const parseWorkerArgs = createArgParser(WorkerArgsSchema, {
  redisUrl: { keys: ["redis-url", "redis"], type: "string" },
  concurrency: { keys: ["concurrency", "c"], type: "number" },
  pollInterval: { keys: ["poll-interval"], type: "number" },
  stalledThreshold: { keys: ["stalled-threshold"], type: "number" },
  executor: { keys: ["executor", "e"], type: "string" },
  entrypoint: { keys: ["entrypoint"], type: "string" },
  debug: { keys: ["debug"], type: "boolean" },
});

export async function handleWorkerCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseWorkerArgs, "worker", args);
  const { workerCommand } = await import("./command.ts");
  await workerCommand(opts);
}
