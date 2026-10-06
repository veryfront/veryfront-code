import {
  createSearchKnowledgeTool,
  normalizedProjectKnowledgeScopeGrantsAnyPath,
  normalizeProjectKnowledgeScopeSelector,
} from "#veryfront/knowledge/index.ts";
import type { AgentConfig } from "../types.ts";
import type { RemoteToolSource } from "#veryfront/tool";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";

/** Whether authored knowledge grants enable the framework retrieval capability. */
export function isKnowledgeEnabled(selector: AgentConfig["knowledge"]): boolean {
  if (selector === undefined) return false;
  return normalizedProjectKnowledgeScopeGrantsAnyPath(
    normalizeProjectKnowledgeScopeSelector(selector),
  );
}

/** Build a run-scoped capability without registering it in a shared catalog. */
export function createAgentKnowledgeTool(config: AgentConfig) {
  if (!isKnowledgeEnabled(config.knowledge)) return undefined;
  return createSearchKnowledgeTool({ scope: config.knowledge });
}

/** Preserve tools:true discovery while adding the agent's own knowledge capability. */
export function createAgentKnowledgeSource(config: AgentConfig): RemoteToolSource | undefined {
  if (config.tools !== true) return undefined;
  const knowledgeTool = createAgentKnowledgeTool(config);
  if (!knowledgeTool) return undefined;
  return {
    id: "framework-knowledge",
    async listTools() {
      return [toolToProviderDefinition(knowledgeTool)];
    },
    executeTool(name, input, context) {
      if (name !== knowledgeTool.id) throw new Error("Unknown framework knowledge tool");
      return Promise.resolve(knowledgeTool.execute(input, context));
    },
  };
}
