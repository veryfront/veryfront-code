import type { Tool } from "@veryfront/tool";
import type { JsonSchema } from "@veryfront/tool/schema";
import { zodToJsonSchema } from "@veryfront/tool/schema";

const MODEL_BRAND = "ai-sdk-model";

export interface AISDKModelWrapper<Model = unknown> {
  __type: typeof MODEL_BRAND;
  model: Model;
}

export function aiSDKModel<Model = unknown>(model: Model): AISDKModelWrapper<Model> {
  return { __type: MODEL_BRAND, model };
}

export function isAISDKModel(value: unknown): value is AISDKModelWrapper {
  return Boolean(
    value && typeof value === "object" && (value as AISDKModelWrapper).__type === MODEL_BRAND,
  );
}

export const useAISDK = aiSDKModel;

/**
 * Get JSON Schema from a tool, preferring pre-converted schema if available
 */
function getToolSchema(tool: Tool): JsonSchema {
  // Use pre-converted JSON Schema if available (set during tool() creation)
  // This is the preferred path - no zod schema needed at runtime
  if (tool.inputSchemaJson) {
    return tool.inputSchemaJson;
  }

  // Runtime conversion - may fail if zod schema is not properly initialized
  // This can happen when the user's zod instance differs from the bundled one
  try {
    if (tool.inputSchema && typeof tool.inputSchema === "object") {
      // Check for zod schema markers
      const schema = tool.inputSchema as { _def?: { typeName?: string } };
      if (schema._def && schema._def.typeName) {
        return zodToJsonSchema(tool.inputSchema);
      }
    }
  } catch {
    // Schema conversion failed - fall through to fallback
  }

  // Fallback: empty object schema
  return { type: "object", properties: {} };
}

export function toAISDKTool(tool: Tool) {
  return {
    type: "function" as const,
    function: {
      name: tool.id,
      description: tool.description,
      parameters: getToolSchema(tool),
    },
  };
}

export function toAISDKTools(tools: Record<string, Tool>) {
  const aiTools: Record<
    string,
    { description: string; parameters: JsonSchema; execute: Tool["execute"] }
  > = {};

  for (const [name, tool] of Object.entries(tools)) {
    aiTools[name] = {
      description: tool.description,
      parameters: getToolSchema(tool),
      execute: tool.execute,
    };
  }

  return aiTools;
}

export const AI_SDK_ADAPTER_VERSION = "1.0.0";
export const AI_SDK_SUPPORTED_VERSION = "3.x";
