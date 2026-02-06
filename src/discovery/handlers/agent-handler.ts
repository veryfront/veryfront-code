/**
 * Agent Discovery Handler
 */

import type { Agent } from "#veryfront/agent";
import { registerAgent } from "#veryfront/agent";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId, trackAgentPath } from "../discovery-utils.ts";

export const agentHandler: DiscoveryHandler<Agent> = {
  typeName: "agent",
  validate: (item): item is Agent =>
    item !== null && typeof item === "object" && typeof (item as Agent).generate === "function",
  getId: (agent, file) => agent.id || filenameToId(file),
  register: (id, agent, file) => {
    registerAgent(id, agent);
    trackAgentPath(id, file);
    return agent;
  },
  getResultMap: (result) => result.agents,
};
