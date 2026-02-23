import { z } from "zod";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const TaskArgsSchema = z.object({
  name: z.string(),
  config: z.string().optional(),
  debug: z.boolean().default(false),
});

export type TaskArgs = z.infer<typeof TaskArgsSchema>;

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
