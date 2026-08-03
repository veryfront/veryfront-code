import type { Tool, ToolExecutionContext } from "./types.ts";
import { toolRegistry } from "./registry.ts";
import { createError, toError } from "#veryfront/errors";

/**
 * Whether a registered tool is visible to the caller identified by the
 * execution context. Unowned tools are project/global; owned tools are only
 * visible to their owning agent.
 */
export function isToolVisibleTo(tool: Tool, context?: ToolExecutionContext): boolean {
  return tool.ownerAgentId === undefined || tool.ownerAgentId === context?.agentId;
}

/** Execute a tool definition with validated input. */
export function executeTool(
  toolId: string,
  input: unknown,
  context?: ToolExecutionContext,
): Promise<unknown> {
  const registeredTool = toolRegistry.get(toolId);

  // An owned tool outside its owner's context behaves as if it does not
  // exist — the same error as a missing tool, so callers cannot probe for
  // other agents' owned tools.
  if (!registeredTool || !isToolVisibleTo(registeredTool, context)) {
    throw toError(
      createError({
        type: "agent",
        message: `Tool "${toolId}" not found`,
      }),
    );
  }

  return registeredTool.execute(input, context);
}
