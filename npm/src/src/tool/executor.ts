import type { ToolExecutionContext } from "./types.js";
import { toolRegistry } from "./registry.js";
import { createError, toError } from "../errors/veryfront-error.js";

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
