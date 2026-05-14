import type { DiscoveryResult } from "#veryfront/discovery";
import {
  clearTrackedAgents,
  clearTranspileCache,
  createProjectDiscoveryConfig,
  discoverAll,
} from "#veryfront/discovery";
import { getConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { clearMCPRegistry } from "#veryfront/mcp";
import { workflowRegistry } from "#veryfront/workflow/registry.ts";
import { agentRegistry } from "./composition/index.ts";
import type { RuntimeAgentMarkdownDefinition } from "./runtime/agent-definition.ts";
import {
  getRuntimeAgentMarkdownDefinition,
  isRuntimeAgentMarkdownAgent,
} from "./runtime/agent-markdown-adapter.ts";
import type { Agent, AgentConfig } from "./types.ts";

export type ProjectAgentRuntimeAgentSource = "auto" | "code" | "markdown";

export type ProjectAgentRuntimeAgentIdCandidates = {
  codeAgentIds: string[];
  markdownAgentIds: string[];
};

export type DiscoverProjectAgentRuntimeInput = {
  projectDir: string;
  adapter: RuntimeAdapter;
  verbose?: boolean;
};

function resolveAgentSystem(system: AgentConfig["system"]): Promise<string> | string {
  return typeof system === "function" ? system() : system;
}

export function clearProjectAgentRuntimeRegistries(): void {
  clearTrackedAgents();
  clearTranspileCache();
  agentRegistry.clear();
  clearMCPRegistry();
  workflowRegistry.clear();
}

export async function discoverProjectAgentRuntime(
  input: DiscoverProjectAgentRuntimeInput,
): Promise<DiscoveryResult> {
  clearProjectAgentRuntimeRegistries();

  const config = await getConfig(input.projectDir, input.adapter);
  const discoveryOptions = createProjectDiscoveryConfig({
    projectDir: input.projectDir,
    config,
    verbose: input.verbose,
  });

  return await discoverAll(discoveryOptions);
}

export function doesProjectAgentRuntimeAgentMatchSource(
  runtimeAgent: Agent,
  source: ProjectAgentRuntimeAgentSource,
): boolean {
  if (source === "auto") {
    return true;
  }

  const markdownAgent = isRuntimeAgentMarkdownAgent(runtimeAgent);
  return source === "markdown" ? markdownAgent : !markdownAgent;
}

export async function createRuntimeAgentDefinitionFromAgent(
  runtimeAgent: Agent,
): Promise<RuntimeAgentMarkdownDefinition> {
  const markdownDefinition = getRuntimeAgentMarkdownDefinition(runtimeAgent);
  if (markdownDefinition) {
    return markdownDefinition;
  }

  return {
    id: runtimeAgent.id,
    name: runtimeAgent.config.name ?? runtimeAgent.id,
    description: runtimeAgent.config.description ?? "",
    instructions: await resolveAgentSystem(runtimeAgent.config.system),
    model: runtimeAgent.config.model,
    maxSteps: runtimeAgent.config.maxSteps,
  };
}

export function getProjectAgentRuntimeAgentIdCandidates(
  discoveryResult: Pick<DiscoveryResult, "agents"> | null | undefined,
): ProjectAgentRuntimeAgentIdCandidates {
  const codeAgentIds: string[] = [];
  const markdownAgentIds: string[] = [];

  for (const [agentId, runtimeAgent] of discoveryResult?.agents.entries() ?? []) {
    if (isRuntimeAgentMarkdownAgent(runtimeAgent)) {
      markdownAgentIds.push(agentId);
    } else {
      codeAgentIds.push(agentId);
    }
  }

  return {
    codeAgentIds: codeAgentIds.sort((left, right) => left.localeCompare(right)),
    markdownAgentIds: markdownAgentIds.sort((left, right) => left.localeCompare(right)),
  };
}

export function describeProjectAgentRuntimeAgentIdCandidates(
  input: ProjectAgentRuntimeAgentIdCandidates,
): string {
  const ids = [...new Set([...input.codeAgentIds, ...input.markdownAgentIds])]
    .sort((left, right) => left.localeCompare(right));

  return ids.length > 0 ? ids.join(", ") : "none";
}

export function resolveSingleProjectAgentRuntimeAgentId(input: {
  candidates: ProjectAgentRuntimeAgentIdCandidates;
  source: ProjectAgentRuntimeAgentSource;
}): string | null {
  if (input.source === "code") {
    return input.candidates.codeAgentIds.length === 1
      ? input.candidates.codeAgentIds[0] ?? null
      : null;
  }

  if (input.source === "markdown") {
    return input.candidates.markdownAgentIds.length === 1
      ? input.candidates.markdownAgentIds[0] ?? null
      : null;
  }

  const candidateIds = [
    ...new Set([...input.candidates.codeAgentIds, ...input.candidates.markdownAgentIds]),
  ];
  return candidateIds.length === 1 ? candidateIds[0] ?? null : null;
}
