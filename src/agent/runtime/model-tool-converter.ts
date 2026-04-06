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
import { anthropic } from "@ai-sdk/anthropic";

export interface ConvertToolsToAISDKOptions {
  model?: string;
  allowedToolNames?: string[];
}

function resolveHostedProvider(model?: string): string | undefined {
  if (!model) return undefined;

  const [provider, second] = model.split("/", 3);
  if (!provider) return undefined;
  if (provider === "veryfront-cloud") {
    return second || undefined;
  }

  return provider;
}

function resolveProviderNativeTools(
  options?: ConvertToolsToAISDKOptions,
): ToolSet | undefined {
  if (!options?.allowedToolNames?.includes("web_search")) {
    return undefined;
  }

  if (resolveHostedProvider(options.model) !== "anthropic") {
    return undefined;
  }

  return {
    web_search: anthropic.tools.webSearch_20250305({
      maxUses: 5,
    }),
  };
}

/**
 * Convert veryfront tool definitions to AI SDK ToolSet.
 *
 * The AI SDK tool() function wraps each tool with its schema.
 * We don't provide `execute` — the agent runtime handles execution.
 */
export function convertToolsToAISDK(
  tools: ToolDefinition[],
  options?: ConvertToolsToAISDKOptions,
): ToolSet | undefined {
  const toolSet: ToolSet = {};

  for (const def of tools) {
    toolSet[def.name] = tool({
      description: def.description,
      inputSchema: jsonSchema(def.parameters),
    });
  }

  const providerNativeTools = resolveProviderNativeTools(options);
  if (providerNativeTools) {
    for (const [name, providerTool] of Object.entries(providerNativeTools)) {
      if (!Object.hasOwn(toolSet, name)) {
        toolSet[name] = providerTool;
      }
    }
  }

  return Object.keys(toolSet).length > 0 ? toolSet : undefined;
}
