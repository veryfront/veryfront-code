/**
 * Model Tool Converter
 *
 * Converts veryfront ToolDefinition[] to AI SDK ToolSet format.
 * Uses jsonSchema() to pass JSON Schema parameters directly to the AI SDK.
 *
 * @module ai/agent/runtime/model-tool-converter
 */

import { jsonSchema, tool } from "ai";
import type { ToolSet } from "ai";
import type { ToolDefinition } from "#veryfront/tool";

/**
 * Convert veryfront tool definitions to AI SDK ToolSet.
 *
 * The AI SDK tool() function wraps each tool with its schema.
 * We don't provide `execute` — the agent runtime handles execution.
 */
export function convertToolsToAISDK(
  tools: ToolDefinition[],
): ToolSet | undefined {
  if (!tools.length) return undefined;

  const toolSet: ToolSet = {};

  for (const def of tools) {
    toolSet[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.parameters),
    });
  }

  return toolSet;
}
