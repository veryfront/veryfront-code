import { exists, readDir, readTextFile } from "#veryfront/platform/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { connectors } from "../../../src/integrations/_data.ts";
import { isDeclaredIntegration } from "../../../src/integrations/feature-flags.ts";
import { parseIntegrationToolIdentity } from "../../../src/integrations/source-policy.ts";
import { getRemoteIntegrationToolDiscovery } from "../../../src/integrations/remote-tools.ts";

export interface AgentSource {
  /** Agent id: the file name, or the directory name of `agents/<id>/…`. */
  agentId: string;
  source: string;
}

export interface DeclaredIntegration {
  integration: string;
  agentIds: string[];
}

const AGENT_SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".md"];
const TOOL_NAME_PATTERN = /[a-z0-9][a-z0-9-]*__[a-z0-9][a-z0-9_-]*/g;

/** Integrations whose `integration__tool` names appear in the agents' sources. */
export function collectDeclaredIntegrations(agents: readonly AgentSource[]): DeclaredIntegration[] {
  const byIntegration = new Map<string, Set<string>>();
  for (const { agentId, source } of agents) {
    for (const match of source.matchAll(TOOL_NAME_PATTERN)) {
      const identity = parseIntegrationToolIdentity(match[0]);
      if (!identity || !isDeclaredIntegration(identity.integration)) continue;
      const agentIds = byIntegration.get(identity.integration) ?? new Set<string>();
      agentIds.add(agentId);
      byIntegration.set(identity.integration, agentIds);
    }
  }
  return [...byIntegration.entries()]
    .map(([integration, agentIds]) => ({ integration, agentIds: [...agentIds].sort() }))
    .sort((a, b) => a.integration.localeCompare(b.integration));
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function displayName(integration: string): string {
  return connectors.find((connector) => connector.name === integration)?.displayName ??
    integration;
}

/** One warning per declared integration that has no connected tool. Empty when all are connected. */
export function unconnectedIntegrationLines(
  declared: readonly DeclaredIntegration[],
  connectedToolNames: readonly string[],
): string[] {
  const connected = new Set<string>();
  for (const name of connectedToolNames) {
    const identity = parseIntegrationToolIdentity(name);
    if (identity) connected.add(identity.integration);
  }

  return declared
    .filter(({ integration }) => !connected.has(integration))
    .flatMap(({ integration, agentIds }) => [
      `${displayName(integration)} isn't connected. ` +
      `${agentIds.length === 1 ? "Agent" : "Agents"} ${joinNames(agentIds)} ` +
      `${agentIds.length === 1 ? "needs" : "need"} it.`,
      `  Connect: npx veryfront integration connect ${integration}`,
    ]);
}

async function collectAgentSources(
  directory: string,
  agentId: string | undefined,
  into: AgentSource[],
): Promise<void> {
  for await (const entry of readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isDirectory) {
      if (entry.name === "node_modules") continue;
      await collectAgentSources(path, agentId ?? entry.name, into);
    } else if (entry.isFile && AGENT_SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      const base = entry.name.replace(/\.[^.]+$/, "");
      into.push({ agentId: agentId ?? base, source: await readTextFile(path) });
    }
  }
}

/** Read every source file under `<projectDir>/agents`. */
export async function readAgentSources(projectDir: string): Promise<AgentSource[]> {
  const agentsDir = join(projectDir, "agents");
  if (!(await exists(agentsDir))) return [];
  const sources: AgentSource[] = [];
  await collectAgentSources(agentsDir, undefined, sources);
  return sources;
}

/**
 * Lines naming each integration the agents declare that the project has not connected.
 * Empty when all are connected, when no agent declares one, or when the lookup fails: a failed
 * lookup says nothing about connections.
 */
export async function findUnconnectedIntegrationLines(projectDir: string): Promise<string[]> {
  try {
    const declared = collectDeclaredIntegrations(await readAgentSources(projectDir));
    if (declared.length === 0) return [];
    const discovery = await getRemoteIntegrationToolDiscovery();
    if (discovery.status !== "ok") return [];
    return unconnectedIntegrationLines(declared, discovery.tools.map((tool) => tool.name));
  } catch {
    return [];
  }
}
