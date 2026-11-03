import { sanitizeTerminalDiagnosticText } from "veryfront/errors";
import type { VeryfrontConfig } from "veryfront/config";
import type { Agent, AgentConfig } from "#veryfront/agent/types.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { createProjectDiscoveryConfig } from "#veryfront/discovery/project-discovery-config.ts";
import { forEachPrivateArray, pushPrivateArray } from "#veryfront/security/private-array.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { getRemoteToolProvenance } from "#veryfront/tool/remote-tool-provenance.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { connectors } from "../../../src/integrations/_data.ts";
import { findUnconnectedIntegrations } from "../../../src/integrations/unconnected.ts";
import { parseIntegrationToolIdentity } from "../../../src/integrations/source-policy.ts";
import {
  getRemoteIntegrationProjectTarget,
  getRemoteIntegrationToolDiscovery,
} from "../../../src/integrations/remote-tools.ts";

const apply = Reflect.apply;
const objectEntries = Object.entries;
const arraySort = Array.prototype.sort;
const mapForEach = Map.prototype.forEach;

export interface AgentTools {
  agentId: string;
  tools?: AgentConfig["tools"];
}

export interface DeclaredIntegration {
  integration: string;
  agentIds: string[];
}

/** Integrations explicitly enabled by the agents the runtime has loaded. */
export function collectDeclaredIntegrations(agents: readonly AgentTools[]): DeclaredIntegration[] {
  const byIntegration = createPrivateMap<string, Set<string>>();
  forEachPrivateArray(agents, ({ agentId, tools }) => {
    if (!tools || tools === true) return;
    const names: string[] = [];
    forEachPrivateArray(objectEntries(tools), (entry) => {
      const name = entry[1] === true ? entry[0] : getRemoteToolProvenance(entry[1]);
      if (name) pushPrivateArray(names, name);
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
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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

/** Warn from runtime-registered agents; failed or disabled discovery produces no advice. */
export async function findUnconnectedIntegrationLines(
  projectDir: string,
  config?: VeryfrontConfig | null,
): Promise<string[]> {
  try {
    if (createProjectDiscoveryConfig({ projectDir, config }).agentDirs.length === 0) return [];
    const agents: AgentTools[] = [];
    apply(mapForEach, agentRegistry.getAll(), [(agent: Agent, agentId: string) => {
      pushPrivateArray(agents, { agentId, tools: agent.config.tools });
    }]);
    const declared = collectDeclaredIntegrations(agents);
    if (declared.length === 0) return [];
    const target = getRemoteIntegrationProjectTarget();
    if (!target) return [];
    const connectedNames: string[] = [];
    const discovery = await getRemoteIntegrationToolDiscovery(undefined, {
      onDiscoveredToolName: (name) => pushPrivateArray(connectedNames, name),
    });
    if (discovery.status !== "ok") return [];
    return unconnectedIntegrationLines(declared, connectedNames, target.projectSlug);
  } catch {
    return [];
  }
}
