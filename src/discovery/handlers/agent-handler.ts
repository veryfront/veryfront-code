/**
 * Agent Discovery Handler
 */

import type { Agent } from "#veryfront/agent/types.ts";
import { registerAgent } from "#veryfront/agent/composition/index.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId, getRelativeDiscoveryPath } from "../discovery-utils.ts";

const COLOCATED_CAPABILITY_DIRS = new Set(["skills", "tools"]);

function isAgentDefinitionFile(file: string, dir: string): boolean {
  const segments = getRelativeDiscoveryPath(file, dir).split("/");
  if (segments.length < 3) return true;
  const parentCapabilityDir = segments.at(1);
  return parentCapabilityDir === undefined || !COLOCATED_CAPABILITY_DIRS.has(parentCapabilityDir);
}

export const agentHandler: DiscoveryHandler<Agent> = {
  typeName: "agent",
  shouldDiscover: isAgentDefinitionFile,
  validate: (item): item is Agent =>
    item !== null && typeof item === "object" && typeof (item as Agent).generate === "function",
  getId: (agent, file) => {
    const configuredId = agent.config.id;
    return typeof configuredId === "string" && configuredId.trim().length > 0
      ? configuredId
      : filenameToId(file);
  },
  register: (id, agent) => {
    if (agent.id !== id) {
      agentRegistry.delete(agent.id);
    }
    registerAgent(id, agent);
    return agent;
  },
  getResultMap: (result) => result.agents,
};
