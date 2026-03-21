import { z } from "zod";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const WorkflowArgsSchema = z.object({
  action: z.enum(["run"]),
  name: z.string(),
  input: z.string().optional(),
  debug: z.boolean().default(false),
});

export type WorkflowArgs = z.infer<typeof WorkflowArgsSchema>;

export const parseWorkflowArgs = createArgParser(WorkflowArgsSchema, {
  action: { keys: ["action"], type: "string", positional: 0 },
  name: { keys: ["name"], type: "string", positional: 1 },
  input: { keys: ["input"], type: "string" },
  debug: { keys: ["debug"], type: "boolean" },
});

export async function handleWorkflowCommand(args: ParsedArgs): Promise<void> {
  const opts = parseArgsOrThrow(parseWorkflowArgs, "workflow", args);
  const { workflowCommand } = await import("./command.ts");
  await workflowCommand(opts);
}
