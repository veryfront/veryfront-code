import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import { markTrustedPlatformSource } from "#veryfront/tool/platform-source-provenance.ts";
import type { AgentMcpToolPolicy } from "./types.ts";

/** Adapt an authenticated, access-filtered legacy platform catalog. */
export function createPlatformMcpCatalogSource(
  source: RemoteToolSource,
  definitions: readonly ToolDefinition[],
): {
  source: RemoteToolSource;
  definitions: ToolDefinition[];
  aliases: ReadonlyMap<string, string>;
} {
  const aliases = createPrivateMap<string, string>();
  const catalog = [...definitions];
  const names = createPrivateSet(definitions.map((definition) => definition.name));
  for (const definition of definitions) {
    if (definition.name.includes("__")) continue;
    const canonicalName = `veryfront__${definition.name}`;
    if (names.has(canonicalName)) continue;
    aliases.set(canonicalName, definition.name);
    catalog.push({ ...definition, name: canonicalName });
  }
  return {
    definitions: catalog,
    aliases,
    source: markTrustedPlatformSource({
      id: source.id,
      listTools: async () => [...catalog],
      executeTool: (name, args, context) =>
        source.executeTool(aliases.get(name) ?? name, args, context),
    }),
  };
}

/** Apply platform MCP policy entries to both catalog spellings. */
export function withPlatformMcpPolicyAliases(
  policy: AgentMcpToolPolicy | undefined,
): AgentMcpToolPolicy | undefined {
  if (!policy) return policy;
  const expand = (names: readonly string[]): string[] => {
    const expanded = createPrivateSet(names);
    for (const name of names) {
      const legacyName = platformMcpLegacyName(name);
      if (!legacyName || legacyName.includes("__")) continue;
      const canonicalName = `veryfront__${legacyName}`;
      expanded.add(legacyName);
      expanded.add(canonicalName);
    }
    return [...expanded];
  };
  return {
    ...policy,
    get allow() {
      return policy.allow === undefined ? undefined : expand(policy.allow);
    },
    get deny() {
      return policy.deny === undefined ? undefined : expand(policy.deny);
    },
  };
}

/** Translate a platform selector at the authenticated legacy API boundary. */
export function platformMcpLegacyName(name: string): string {
  if (!name.startsWith("veryfront__")) return name;
  const legacyName = name.slice("veryfront__".length);
  return legacyName && !legacyName.includes("__") ? legacyName : name;
}

/** Adapt a live legacy catalog without retaining project or credential state. */
export function createLivePlatformMcpSource(source: RemoteToolSource): RemoteToolSource {
  // Keep only wire-name translations. The wrapped source still checks the
  // current project, credentials, access profile, and policy during execution.
  let wireNames = createPrivateMap<string, string>();
  const listTools = async (context?: ToolExecutionContext): Promise<ToolDefinition[]> => {
    const catalog = createPlatformMcpCatalogSource(source, await source.listTools(context));
    wireNames = createPrivateMap<string, string>();
    for (const { name } of catalog.definitions) {
      if (name.startsWith("veryfront__")) wireNames.set(name, catalog.aliases.get(name) ?? name);
    }
    return catalog.definitions;
  };
  return markTrustedPlatformSource({
    id: source.id,
    listTools,
    executeTool: async (name, args, context) => {
      if (name.startsWith("veryfront__") && !wireNames.has(name)) await listTools(context);
      return source.executeTool(wireNames.get(name) ?? name, args, context);
    },
  });
}
