/**
 * Agent Discovery Handler
 */

import type { Agent } from "#veryfront/agent/types.ts";
import { isRuntimeLocalTool } from "#veryfront/agent/runtime/local-tool.ts";
import { registerAgent } from "#veryfront/agent/composition/index.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { registerTool } from "#veryfront/mcp";
import type { Tool } from "#veryfront/tool";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId, trackAgentPath } from "../discovery-utils.ts";

function registerConfiguredAgentTools(agent: Agent): void {
  const configuredTools = agent.config.tools;
  if (!configuredTools || configuredTools === true) return;

  for (const [name, entry] of Object.entries(configuredTools)) {
    if (!entry || typeof entry !== "object") continue;
    const configuredTool = entry as Tool;
    if (isRuntimeLocalTool(configuredTool)) continue;
    registerTool(
      name,
      configuredTool.id === name ? configuredTool : { ...configuredTool, id: name },
    );
  }
}

export const agentHandler: DiscoveryHandler<Agent> = {
  typeName: "agent",
  validate: (item): item is Agent =>
    item !== null && typeof item === "object" && typeof (item as Agent).generate === "function",
  getId: (agent, file) => {
    const configuredId = agent.config.id;
    return typeof configuredId === "string" && configuredId.trim().length > 0
      ? configuredId
      : filenameToId(file);
  },
  register: (id, agent, file) => {
    registerConfiguredAgentTools(agent);
    if (agent.id !== id) {
      agentRegistry.delete(agent.id);
    }
    registerAgent(id, agent);
    trackAgentPath(id, file);
    return agent;
  },
  getResultMap: (result) => result.agents,
};
