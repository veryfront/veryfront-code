import { defineSchema } from "#veryfront/schemas/index.ts";
import { AGENT_ERROR, INVALID_ARGUMENT } from "#veryfront/errors";
import type { Schema } from "#veryfront/extensions/schema/index.ts";
import { toolRegistry } from "#veryfront/tool/registry.ts";
import { isToolVisibleTo } from "#veryfront/tool/executor.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import type { RunResumeSessionManager } from "../runtime/index.ts";
import type { Agent } from "../types.ts";
import { createAgentKnowledgeTool } from "../runtime/knowledge-tools.ts";
import { markRuntimeLocalTool } from "../runtime/local-tool.ts";

/** Public API contract for AG-UI resume value. */
export type AgUiResumeValue = { result: unknown; isError: boolean };

const getAnyObjectSchema = defineSchema((v) => v.record(v.string(), v.unknown()));

export interface AgUiInjectedToolLike {
  name: string;
  description?: string;
  parameters?: unknown;
}

/** Resolve a source agent's authored selection to its current owner-visible catalog. */
export function buildExplicitAgUiSourceTools(
  agent: Agent,
): Exclude<Agent["config"]["tools"], true> {
  if (!agent.config.tools) return undefined;
  if (agent.config.tools !== true) return { ...agent.config.tools };

  const tools: Record<string, Tool | boolean> = {};
  for (const [toolId, registryTool] of toolRegistry.getAll()) {
    if (isToolVisibleTo(registryTool, { agentId: agent.id })) tools[toolId] = true;
  }
  const knowledgeTool = createAgentKnowledgeTool(agent.config);
  if (knowledgeTool) tools[knowledgeTool.id] = knowledgeTool;
  return tools;
}

export function createInjectedAgUiTool(
  runId: string,
  tool: AgUiInjectedToolLike,
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
): Tool {
  return markRuntimeLocalTool({
    id: tool.name,
    type: "function",
    description: tool.description ?? tool.name,
    inputSchema: getAnyObjectSchema() as Schema<Record<string, unknown>>,
    inputSchemaJson: (tool.parameters ??
      { type: "object", properties: {}, additionalProperties: true }) as Tool["inputSchemaJson"],
    execute: async (_input, context) => {
      const toolCallId = typeof context?.toolCallId === "string" ? context.toolCallId : null;
      if (!toolCallId) {
        throw INVALID_ARGUMENT.create({
          detail: `Missing toolCallId for injected tool "${tool.name}"`,
        });
      }

      sessionManager.prepareForSignal(runId, toolCallId);
      const submitted = await sessionManager.waitForSignal(runId, toolCallId);
      if (submitted.isError) {
        throw AGENT_ERROR.create({
          detail: typeof submitted.result === "string"
            ? submitted.result
            : JSON.stringify(submitted.result),
        });
      }
      return submitted.result;
    },
  });
}

export function buildMergedAgUiTools(
  agent: Agent,
  runId: string,
  tools: AgUiInjectedToolLike[],
  sessionManager: RunResumeSessionManager<AgUiResumeValue>,
): Agent["config"]["tools"] {
  const sourceTools = buildExplicitAgUiSourceTools(agent);
  const sourceToolNames = new Set(Object.keys(sourceTools ?? {}));
  const injectedTools = Object.fromEntries(
    tools
      .filter((tool) => !sourceToolNames.has(tool.name))
      .map((tool) => [
        tool.name,
        createInjectedAgUiTool(runId, tool, sessionManager),
      ]),
  );

  if (!sourceTools) {
    return Object.keys(injectedTools).length > 0 ? injectedTools : undefined;
  }
  return { ...sourceTools, ...injectedTools };
}
