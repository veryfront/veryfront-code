import { defineSchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getTaskArgsSchema = defineSchema((v) =>
  v.object({
    name: v.string(),
    config: v.string().optional(),
    debug: v.boolean().default(false),
  })
);

const TaskArgsSchema = getTaskArgsSchema();

export type TaskArgs = InferSchema<ReturnType<typeof getTaskArgsSchema>>;

export const parseTaskArgs = createArgParser(TaskArgsSchema, {
  name: { keys: ["name"], type: "string", positional: 0 },
  config: { keys: ["config"], type: "string" },
  debug: { keys: ["debug"], type: "boolean" },
});

export async function handleTaskCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseTaskArgs, "task", args);
  const { taskCommand } = await import("./command.ts");
  await taskCommand(opts);
}
