import { z } from "zod";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const WorkerArgsSchema = z.object({
  redisUrl: z.string().default("redis://localhost:6379"),
  concurrency: z.number().default(3),
  pollInterval: z.number().default(5000),
  stalledThreshold: z.number().default(60000),
  executor: z.enum(["process", "k8s"]).default("process"),
  entrypoint: z.string().optional(),
  debug: z.boolean().default(false),
});

export type WorkerArgs = z.infer<typeof WorkerArgsSchema>;

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
