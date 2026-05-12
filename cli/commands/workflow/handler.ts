import { defineSchema } from "veryfront/schemas";
import type { InferSchema } from "veryfront/extensions/schema";
import { createArgParser, parseArgsOrThrow } from "#cli/shared/args";
import type { ParsedArgs } from "#cli/shared/types";

const getWorkflowArgsSchema = defineSchema((v) =>
  v.object({
    action: v.enum(["run"]),
    name: v.string(),
    input: v.string().optional(),
    debug: v.boolean().default(false),
  })
);

const WorkflowArgsSchema = getWorkflowArgsSchema();

export type WorkflowArgs = InferSchema<ReturnType<typeof getWorkflowArgsSchema>>;

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
