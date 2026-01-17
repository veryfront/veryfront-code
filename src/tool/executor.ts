import type { ToolExecutionContext } from "./types.ts";
import { toolRegistry } from "./registry.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";

/**
 * Execute a tool by ID
 */
export async function executeTool(
  toolId: string,
  input: unknown,
  context?: ToolExecutionContext,
): Promise<unknown> {
  const tool = toolRegistry.get(toolId);

  if (!tool) {
    throw toError(createError({
      type: "agent",
      message: `Tool "${toolId}" not found`,
    }));
  }

  return await tool.execute(input, context);
}
