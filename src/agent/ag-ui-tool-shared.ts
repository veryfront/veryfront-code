import { defineSchema } from "#veryfront/schemas/index.ts";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { SKILL_TOOL_IDS } from "#veryfront/skill/types.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import type { RunResumeSessionManager } from "./runtime/index.ts";
import type { Agent } from "./types.ts";

export type AgUiResumeValue = { result: unknown; isError: boolean };

const getAnyObjectSchema = defineSchema((v) => v.record(v.string(), v.unknown()));

export interface AgUiInjectedToolLike {
  name: string;
  description?: string;
  parameters?: unknown;
}

export function createInjectedAgUiTool(
  runId: string,
  tool: AgUiInjectedToolLike,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
): Tool {
  return {
    id: tool.name,
    type: "function",
    description: tool.description ?? tool.name,
    inputSchema: getAnyObjectSchema() as Schema<Record<string, unknown>>,
    inputSchemaJson: (tool.parameters ??
      { type: "object", properties: {}, additionalProperties: true }) as Tool["inputSchemaJson"],
    execute: async (_input, context) => {
      const toolCallId = typeof context?.toolCallId === "string" ? context.toolCallId : null;
      if (!toolCallId) {
        throw new Error(`Missing toolCallId for injected tool "${tool.name}"`);
      }

      sessionManager.prepareForSignal(runId, toolCallId);
      const submitted = await sessionManager.waitForSignal(runId, toolCallId);
      if (submitted.isError) {
        throw new Error(
          typeof submitted.result === "string"
            ? submitted.result
            : JSON.stringify(submitted.result),
        );
      }
      return submitted.result;
    },
  };
}

export function buildMergedAgUiTools(
  agent: Agent,
  runId: string,
  tools: AgUiInjectedToolLike[],
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
): Agent["config"]["tools"] {
  const injectedTools = Object.fromEntries(
    tools.map((tool) => [
      tool.name,
      createInjectedAgUiTool(runId, tool, sessionManager),
    ]),
  );

  if (!agent.config.tools) {
    return Object.keys(injectedTools).length > 0 ? injectedTools : undefined;
  }

  if (agent.config.tools === true) {
    const merged: Record<string, Tool | boolean> = {};
    for (const [toolId] of toolRegistry.getAll()) {
      if (!agent.config.skills && SKILL_TOOL_IDS.has(toolId)) {
        continue;
      }
      merged[toolId] = true;
    }
    return { ...merged, ...injectedTools };
  }

  return { ...agent.config.tools, ...injectedTools };
}
