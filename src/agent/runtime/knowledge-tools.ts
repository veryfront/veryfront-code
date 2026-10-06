import {
  createSearchKnowledgeTool,
  normalizedProjectKnowledgeScopeGrantsAnyPath,
  normalizeProjectKnowledgeScopeSelector,
} from "#veryfront/knowledge/index.ts";
import type { AgentConfig } from "../types.ts";
import type { RemoteToolSource, Tool } from "#veryfront/tool";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

const agentKnowledgeSources = createPrivateWeakStore<RemoteToolSource, true>();
const agentKnowledgeTools = createPrivateWeakStore<object, true>();

/** @internal Mark a source as the framework-owned scoped knowledge capability. */
function markAgentKnowledgeSource(source: RemoteToolSource): RemoteToolSource {
  agentKnowledgeSources.set(source, true);
  return source;
}

/** @internal Mark a tool as the framework-owned scoped knowledge capability. */
function markAgentKnowledgeTool(tool: Tool): Tool {
  agentKnowledgeTools.set(tool, true);
  return tool;
}

/** @internal Check framework knowledge ownership without trusting a source id. */
export function isAgentKnowledgeSource(source: RemoteToolSource): boolean {
  return agentKnowledgeSources.get(source) === true;
}

/** @internal Check framework knowledge tool ownership without trusting a tool id. */
export function isAgentKnowledgeTool(tool: unknown): boolean {
  return typeof tool === "object" && tool !== null &&
    agentKnowledgeTools.get(tool) === true;
}

/** @internal Preserve framework knowledge ownership through host-created wrappers. */
export function inheritAgentKnowledgeSource(
  source: RemoteToolSource,
  wrapper: RemoteToolSource,
): RemoteToolSource {
  return isAgentKnowledgeSource(source) ? markAgentKnowledgeSource(wrapper) : wrapper;
}

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
  return markAgentKnowledgeTool(createSearchKnowledgeTool({ scope: config.knowledge }));
}

/** Preserve tools:true discovery while adding the agent's own knowledge capability. */
export function createAgentKnowledgeSource(config: AgentConfig): RemoteToolSource | undefined {
  if (config.tools !== true) return undefined;
  const knowledgeTool = createAgentKnowledgeTool(config);
  if (!knowledgeTool) return undefined;
  return markAgentKnowledgeSource({
    id: "framework-knowledge",
    async listTools() {
      return [toolToProviderDefinition(knowledgeTool)];
    },
    executeTool(name, input, context) {
      if (name !== knowledgeTool.id) throw new Error("Unknown framework knowledge tool");
      return Promise.resolve(knowledgeTool.execute(input, context));
    },
  });
}
