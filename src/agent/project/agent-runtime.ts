import type { DiscoveryResult } from "#veryfront/discovery/types.ts";
import { discoverAll } from "#veryfront/discovery/discovery-engine.ts";
import { clearTrackedAgents } from "#veryfront/discovery/discovery-utils.ts";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";
import { clearTranspileCache } from "#veryfront/discovery/transpiler.ts";
import { getConfig, type VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import { clearMCPRegistry } from "#veryfront/mcp";
import { workflowRegistry } from "#veryfront/workflow/registry.ts";
import { agentRegistry } from "../composition/index.ts";
import type {
  RuntimeAgentMarkdownDefinition,
  RuntimeAgentMcpServerConfig,
} from "../runtime/agent-definition.ts";
import {
  getRuntimeAgentMarkdownDefinition,
  isRuntimeAgentMarkdownAgent,
} from "../runtime/agent-markdown-adapter.ts";
import type { Agent, AgentConfig } from "../types.ts";
import {
  normalizeSourceIntegrationPolicy,
  type SourceIntegrationPolicyManifest,
} from "#veryfront/integrations/source-policy.ts";
import {
  getActiveSourceIntegrationPolicy,
  runWithEffectiveSourceIntegrationPolicy,
} from "#veryfront/integrations/source-policy-context.ts";
import { CONFIG_INVALID } from "#veryfront/errors";

/** Public API contract for project agent runtime agent source. */
export type ProjectAgentRuntimeAgentSource = "auto" | "code" | "markdown";

/** Public API contract for project agent runtime agent ID candidates. */
export type ProjectAgentRuntimeAgentIdCandidates = {
  codeAgentIds: string[];
  markdownAgentIds: string[];
};

/** Input payload for discover project agent runtime. */
export type DiscoverProjectAgentRuntimeInput = {
  projectDir: string;
  adapter?: RuntimeAdapter;
  config?: VeryfrontConfig | null;
  fsAdapter?: FileSystemAdapter;
  cacheKey?: string;
  verbose?: boolean;
  /** Immutable outer restriction to preserve while loading and discovering this source. */
  sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
};

/** Project discovery plus the normalized policy owned by that exact source. */
export type ProjectAgentRuntimeDiscovery = DiscoveryResult & {
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
};

/** Execute a project-runtime lifetime without allowing an outer policy to widen. */
export function runWithProjectAgentRuntime<T>(
  runtime: Pick<ProjectAgentRuntimeDiscovery, "sourceIntegrationPolicy">,
  fn: () => T,
): T {
  return runWithEffectiveSourceIntegrationPolicy(runtime.sourceIntegrationPolicy, fn);
}

function resolveAgentSystem(system: AgentConfig["system"]): Promise<string> | string {
  return typeof system === "function" ? system() : system;
}

function resolveAgentToolNames(tools: AgentConfig["tools"]): true | string[] | undefined {
  if (tools === true) {
    return true;
  }

  if (!tools) {
    return undefined;
  }

  const names = Object.entries(tools)
    .flatMap(([name, value]) => value === false ? [] : [name])
    .sort();

  return names.length > 0 ? names : undefined;
}

function resolveSerializableMcpServers(
  mcpServers: AgentConfig["mcpServers"],
): RuntimeAgentMcpServerConfig[] | undefined {
  if (mcpServers === undefined) {
    return undefined;
  }

  return mcpServers.map((server) => {
    if ("transport" in server) {
      throw CONFIG_INVALID.create({
        detail:
          `HTTP MCP server "${server.id}" cannot be serialized into a hosted agent definition. ` +
          "Configure it on the hosted agent service, or use a first-party MCP preset.",
      });
    }

    return {
      kind: server.kind,
      ...(server.id === undefined ? {} : { id: server.id }),
      ...(server.toolPolicy === undefined ? {} : { toolPolicy: server.toolPolicy }),
    };
  });
}

/** Clear project agent runtime registries. */
export function clearProjectAgentRuntimeRegistries(): void {
  clearTrackedAgents();
  clearTranspileCache();
  agentRegistry.clear();
  clearMCPRegistry();
  workflowRegistry.clear();
}

/** Discover project agent runtime helper. */
export async function discoverProjectAgentRuntime(
  input: DiscoverProjectAgentRuntimeInput,
): Promise<ProjectAgentRuntimeDiscovery> {
  return await runWithEffectiveSourceIntegrationPolicy(
    input.sourceIntegrationPolicy,
    async () => {
      clearProjectAgentRuntimeRegistries();

      const config = input.config ??
        await getConfig(
          input.projectDir,
          input.adapter ?? await getLocalAdapter(),
          input.cacheKey ? { cacheKey: input.cacheKey } : undefined,
        );
      const discoveryOptions = createProjectDiscoveryConfig({
        projectDir: input.projectDir,
        config,
        fsAdapter: input.fsAdapter,
        verbose: input.verbose,
      });

      const currentSourcePolicy = normalizeSourceIntegrationPolicy(config.integrations);
      return await runWithEffectiveSourceIntegrationPolicy(
        currentSourcePolicy,
        async () => {
          const sourceIntegrationPolicy = getActiveSourceIntegrationPolicy() ??
            currentSourcePolicy;
          const discovery = await discoverAll(discoveryOptions);
          return { ...discovery, sourceIntegrationPolicy };
        },
      );
    },
  );
}

/** Does project agent runtime agent match source helper. */
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

/** Create runtime agent definition from agent. */
export async function createRuntimeAgentDefinitionFromAgent(
  runtimeAgent: Agent,
): Promise<RuntimeAgentMarkdownDefinition> {
  const markdownDefinition = getRuntimeAgentMarkdownDefinition(runtimeAgent);
  if (markdownDefinition) {
    return markdownDefinition;
  }
  const toolNames = resolveAgentToolNames(runtimeAgent.config.tools);
  const mcpServers = resolveSerializableMcpServers(runtimeAgent.config.mcpServers);

  return {
    id: runtimeAgent.id,
    name: runtimeAgent.config.name ?? runtimeAgent.id,
    description: runtimeAgent.config.description ?? "",
    ...(runtimeAgent.config.avatarUrl ?? runtimeAgent.config.avatar_url
      ? { avatarUrl: runtimeAgent.config.avatarUrl ?? runtimeAgent.config.avatar_url }
      : {}),
    instructions: await resolveAgentSystem(runtimeAgent.config.system),
    model: runtimeAgent.config.model,
    ...(runtimeAgent.config.temperature === undefined
      ? {}
      : { temperature: runtimeAgent.config.temperature }),
    ...(runtimeAgent.config.thinking === undefined
      ? {}
      : { thinking: runtimeAgent.config.thinking }),
    maxSteps: runtimeAgent.config.maxSteps,
    ...(runtimeAgent.config.providerTools
      ? { providerTools: runtimeAgent.config.providerTools }
      : {}),
    ...(runtimeAgent.config.skills === undefined ? {} : { skills: runtimeAgent.config.skills }),
    ...(toolNames === undefined ? {} : { tools: toolNames }),
    ...(runtimeAgent.config.delegates === undefined
      ? {}
      : { delegates: runtimeAgent.config.delegates }),
    ...(mcpServers === undefined ? {} : { mcpServers }),
  };
}

/** Return project agent runtime agent ID candidates. */
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

/** Describe project agent runtime agent ID candidates helper. */
export function describeProjectAgentRuntimeAgentIdCandidates(
  input: ProjectAgentRuntimeAgentIdCandidates,
): string {
  const ids = [...new Set([...input.codeAgentIds, ...input.markdownAgentIds])]
    .sort((left, right) => left.localeCompare(right));

  return ids.length > 0 ? ids.join(", ") : "none";
}

/** Resolves single project agent runtime agent ID. */
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
