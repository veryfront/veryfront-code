import type { ToolExecutionContext } from "./types.ts";
import { toolRegistry } from "./registry.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export function executeTool(
  toolId: string,
  input: unknown,
  context?: ToolExecutionContext,
): Promise<unknown> {
  const tool = toolRegistry.get(toolId);

  if (!tool) {
    throw toError(
      createError({
        type: "agent",
        message: `Tool "${toolId}" not found`,
      }),
    );
  }

  return tool.execute(input, context);
}
