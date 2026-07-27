/**
 * Agent Discovery Handler
 */

import type { Agent } from "#veryfront/agent/types.ts";
import { registerAgent } from "#veryfront/agent/composition/index.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import type { DiscoveryHandler } from "../types.ts";
import { filenameToId, getRelativeDiscoveryPath } from "../discovery-utils.ts";

const COLOCATED_CAPABILITY_DIRS = new Set(["skills", "tools"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isAgentDefinitionFile(file: string, dir: string): boolean {
  const segments = getRelativeDiscoveryPath(file, dir).split("/");
  if (segments.length < 3) return true;
  const parentCapabilityDir = segments.at(1);
  return parentCapabilityDir === undefined || !COLOCATED_CAPABILITY_DIRS.has(parentCapabilityDir);
}

function isDiscoverableAgent(item: unknown): item is Agent {
  if (!isRecord(item) || !isRecord(item.config)) return false;
  if (
    typeof item.id !== "string" ||
    item.id.trim().length === 0 ||
    typeof item.config.model !== "string" ||
    item.config.model.trim().length === 0
  ) {
    return false;
  }

  return [
    "generate",
    "stream",
    "respond",
    "getMemory",
    "getMemoryStats",
    "clearMemory",
  ].every((operation) => typeof item[operation] === "function");
}

export const agentHandler: DiscoveryHandler<Agent> = {
  typeName: "agent",
  shouldDiscover: isAgentDefinitionFile,
  validate: isDiscoverableAgent,
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
