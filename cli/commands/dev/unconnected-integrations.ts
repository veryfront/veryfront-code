import { sanitizeTerminalDiagnosticText } from "veryfront/errors";
import type { VeryfrontConfig } from "veryfront/config";
import type { Agent, AgentConfig } from "#veryfront/agent/types.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { resolveDevAgentDirs } from "#veryfront/discovery/project-discovery-config.ts";
import {
  forEachPrivateArray,
  joinPrivateArray,
  pushPrivateArray,
  slicePrivateArray,
} from "#veryfront/security/private-array.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { connectors } from "../../../src/integrations/_data.ts";
import { findUnconnectedIntegrations } from "../../../src/integrations/unconnected.ts";
import {
  isIntegrationToolAllowedBySourcePolicy,
  normalizeSourceIntegrationPolicy,
  parseIntegrationToolIdentity,
  type SourceIntegrationPolicyManifest,
} from "../../../src/integrations/source-policy.ts";
import { serverLogger } from "veryfront/utils";
import {
  getRemoteIntegrationProjectTarget,
  getRemoteIntegrationToolDiscoveryWithEvidence,
} from "../../../src/integrations/remote-tools.ts";

const apply = Reflect.apply;
const objectEntries = Object.entries;
const arraySort = Array.prototype.sort;
const mapForEach = Map.prototype.forEach;

export interface AgentTools {
  agentId: string;
  tools?: AgentConfig["tools"];
  /** The agent has tool sources of its own, which can supply tools the Cloud catalog lacks. */
  hasToolSources?: boolean;
}

/** Whether the agent configures MCP or injected tool sources that the startup check cannot list. */
export function suppliesToolsFromSources(config: AgentConfig): boolean {
  const injected = (config as AgentConfig & { __vfRemoteToolSources?: readonly unknown[] })
    .__vfRemoteToolSources;
  return (config.mcpServers?.length ?? 0) > 0 || (injected?.length ?? 0) > 0;
}

export interface DeclaredIntegration {
  integration: string;
  agentIds: string[];
}

/** Integrations explicitly enabled by the agents the runtime has loaded. */
export function collectDeclaredIntegrations(
  agents: readonly AgentTools[],
  sourcePolicy?: SourceIntegrationPolicyManifest,
): DeclaredIntegration[] {
  const byIntegration = createPrivateMap<string, Set<string>>();
  forEachPrivateArray(agents, ({ agentId, tools, hasToolSources }) => {
    if (!tools || tools === true || hasToolSources) return;
    const names: string[] = [];
    forEachPrivateArray(objectEntries(tools), (entry) => {
      // A tool a source already materialized exists because that source listed it, whether or
      // not Veryfront holds a connection, so only tools enabled by name can be missing one.
      const name = entry[1] === true ? entry[0] : undefined;
      if (
        name &&
        (sourcePolicy === undefined || isIntegrationToolAllowedBySourcePolicy(name, sourcePolicy))
      ) pushPrivateArray(names, name);
    });
    forEachPrivateArray(findUnconnectedIntegrations(names, []).integrations, (integration) => {
      const agentIds = byIntegration.get(integration) ?? createPrivateSet<string>();
      agentIds.add(agentId);
      byIntegration.set(integration, agentIds);
    });
  });
  const declared: DeclaredIntegration[] = [];
  byIntegration.forEach((agentIds, integration) => {
    const ids = [...agentIds];
    apply(arraySort, ids, [compareStrings]);
    pushPrivateArray(declared, { integration, agentIds: ids });
  });
  apply(arraySort, declared, [
    (a: DeclaredIntegration, b: DeclaredIntegration) =>
      compareStrings(a.integration, b.integration),
  ]);
  return declared;
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return joinPrivateArray(names, "");
  return `${joinPrivateArray(slicePrivateArray(names, 0, -1), ", ")} and ${
    names[names.length - 1]
  }`;
}

function displayName(integration: string): string {
  for (let index = 0; index < connectors.length; index++) {
    const connector = connectors[index]!;
    if (connector.name === integration) return connector.displayName;
  }
  return integration;
}

/** One warning per declared integration that has no connected tool. Empty when all are connected. */
export function unconnectedIntegrationLines(
  declared: readonly DeclaredIntegration[],
  connectedToolNames: readonly string[],
  projectSlug: string,
): string[] {
  const connected = createPrivateSet<string>();
  forEachPrivateArray(connectedToolNames, (name) => {
    const identity = parseIntegrationToolIdentity(name);
    if (identity) connected.add(identity.integration);
  });
  const lines: string[] = [];
  forEachPrivateArray(declared, ({ integration, agentIds }) => {
    if (connected.has(integration)) return;
    pushPrivateArray(
      lines,
      `${displayName(integration)} isn't connected. ` +
        `${agentIds.length === 1 ? "Agent" : "Agents"} ${
          sanitizeTerminalDiagnosticText(joinNames(agentIds))
        } ` +
        `${agentIds.length === 1 ? "needs" : "need"} it.`,
    );
    pushPrivateArray(
      lines,
      `  Connect: npx veryfront integration connect ${integration} --project ${projectSlug}`,
    );
  });
  return lines;
}

/** Normalize source restrictions before loading project agents. */
export function normalizeIntegrationPolicyForDiagnostics(
  integrations: VeryfrontConfig["integrations"],
): SourceIntegrationPolicyManifest {
  return normalizeSourceIntegrationPolicy(integrations);
}

/** Warn from runtime-registered agents when platform discovery succeeds. */
export async function findUnconnectedIntegrationLines(
  config?: VeryfrontConfig | null,
  integrationPolicy?: SourceIntegrationPolicyManifest,
): Promise<string[]> {
  try {
    // Mirror the roots the dev server discovers, not the project-wide discovery settings.
    if (resolveDevAgentDirs(config).length === 0) return [];
    const agents: AgentTools[] = [];
    apply(mapForEach, agentRegistry.getAll(), [(agent: Agent, agentId: string) => {
      pushPrivateArray(agents, {
        agentId,
        tools: agent.config.tools,
        hasToolSources: suppliesToolsFromSources(agent.config),
      });
    }]);
    const declared = collectDeclaredIntegrations(
      agents,
      integrationPolicy ?? normalizeSourceIntegrationPolicy(config?.integrations),
    );
    if (declared.length === 0) return [];
    const target = getRemoteIntegrationProjectTarget();
    if (!target) return [];
    const connectedNames: string[] = [];
    const discovery = await getRemoteIntegrationToolDiscoveryWithEvidence(undefined, {
      onDiscoveredToolName: (name) => pushPrivateArray(connectedNames, name),
    });
    if (discovery.status !== "ok") return [];
    return unconnectedIntegrationLines(declared, connectedNames, target.projectSlug);
  } catch (error) {
    serverLogger.debug("Integration connection check failed", { error });
    return [];
  }
}
