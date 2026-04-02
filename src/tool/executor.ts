import type { ToolExecutionContext } from "./types.ts";
import { toolRegistry } from "./registry.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

export function executeTool(
  toolId: string,
  input: unknown,
  context?: ToolExecutionContext,
): Promise<unknown> {
  const registeredTool = toolRegistry.get(toolId);

  if (!registeredTool) {
    throw toError(
      createError({
        type: "agent",
        message: `Tool "${toolId}" not found`,
      }),
    );
  }

  return registeredTool.execute(input, context);
}
