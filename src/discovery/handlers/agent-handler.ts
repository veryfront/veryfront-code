/**
 * Agent Discovery Handler
 */

import type { Agent } from "#veryfront/agent/types.ts";
import { registerAgent } from "#veryfront/agent/composition/index.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId, trackAgentPath } from "../discovery-utils.ts";

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
    if (agent.id !== id) {
      agentRegistry.delete(agent.id);
    }
    registerAgent(id, agent);
    trackAgentPath(id, file);
    return agent;
  },
  getResultMap: (result) => result.agents,
};
