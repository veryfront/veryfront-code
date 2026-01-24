import type { Tool } from "#veryfront/tool";
import type { JsonSchema } from "#veryfront/tool/schema";
import { zodToJsonSchema } from "#veryfront/tool/schema";

const MODEL_BRAND = "ai-sdk-model";

export interface AISDKModelWrapper<Model = unknown> {
  __type: typeof MODEL_BRAND;
  model: Model;
}

export function aiSDKModel<Model = unknown>(model: Model): AISDKModelWrapper<Model> {
  return { __type: MODEL_BRAND, model };
}

export function isAISDKModel(value: unknown): value is AISDKModelWrapper {
  if (!value || typeof value !== "object") return false;
  return (value as AISDKModelWrapper).__type === MODEL_BRAND;
}

export const useAISDK = aiSDKModel;

function getToolSchema(tool: Tool): JsonSchema {
  if (tool.inputSchemaJson) return tool.inputSchemaJson;

  try {
    const schema = tool.inputSchema as { _def?: { typeName?: string } } | undefined;
    if (schema?._def?.typeName) return zodToJsonSchema(tool.inputSchema);
  } catch {
    // fall through to fallback
  }

  return { type: "object", properties: {} };
}

export function toAISDKTool(tool: Tool): {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
} {
  return {
    type: "function",
    function: {
      name: tool.id,
      description: tool.description,
      parameters: getToolSchema(tool),
    },
  };
}

export function toAISDKTools(
  tools: Record<string, Tool>,
): Record<string, { description: string; parameters: JsonSchema; execute: Tool["execute"] }> {
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
