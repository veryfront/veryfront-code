import { PERMISSION_DENIED } from "#veryfront/errors/index.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { forEachPrivateArray } from "#veryfront/security/private-array.ts";
import type { RemoteToolSource, ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import {
  hasAdaptedPlatformSource,
  markAdaptedPlatformSource,
} from "#veryfront/tool/platform-source-provenance.ts";
import type { AgentMcpToolPolicy } from "./types.ts";

/** Adapt an authenticated, access-filtered platform catalog. */
export function createPlatformMcpCatalogSource(
  source: RemoteToolSource,
  definitions: readonly ToolDefinition[],
): {
  source: RemoteToolSource;
  definitions: ToolDefinition[];
  aliases: ReadonlyMap<string, string>;
} {
  const aliases = createPrivateMap<string, string>();
  const catalog: ToolDefinition[] = [];
  const names = createPrivateSet<string>();
  // Prefer an explicitly published canonical definition over a bare wire name.
  const canonicalNames = createPrivateSet(definitions.map(({ name }) => name));
  for (const definition of definitions) {
    if (!definition.name.includes("__") && canonicalNames.has(`veryfront__${definition.name}`)) {
      continue;
    }
    const name = definition.name.includes("__") ? definition.name : `veryfront__${definition.name}`;
    if (names.has(name)) continue;
    names.add(name);
    if (name !== definition.name) aliases.set(name, definition.name);
    catalog.push({ ...definition, name });
  }
  return {
    definitions: catalog,
    aliases,
    source: markAdaptedPlatformSource({
      id: source.id,
      listTools: async () => [...catalog],
      executeTool: (name, args, context) => {
        if (!names.has(name)) {
          throw PERMISSION_DENIED.create({
            detail: `Tool "${name}" is not in the platform catalog`,
          });
        }
        return source.executeTool(aliases.get(name) ?? name, args, context);
      },
    }),
  };
}

/** Apply platform MCP policy entries to both catalog spellings. */
export function withPlatformMcpPolicyAliases(
  policy: AgentMcpToolPolicy | undefined,
): AgentMcpToolPolicy | undefined {
  if (!policy) return policy;
  return {
    ...policy,
    get allow() {
      return policy.allow === undefined ? undefined : withPlatformMcpToolNameAliases(policy.allow);
    },
    get deny() {
      return policy.deny === undefined ? undefined : withPlatformMcpToolNameAliases(policy.deny);
    },
  };
}

/** Expand platform tool selectors to their accepted bare and canonical spellings. */
export function withPlatformMcpToolNameAliases(names: readonly string[]): string[] {
  const expanded = createPrivateSet<string>();
  forEachPrivateArray(names, (name) => {
    expanded.add(name);
    const legacyName = platformMcpLegacyName(name);
    if (!legacyName || legacyName.includes("__")) return;
    expanded.add(legacyName);
    expanded.add(`veryfront__${legacyName}`);
  });
  return [...expanded];
}

/** Translate a platform selector at the authenticated API boundary. */
export function platformMcpLegacyName(name: string): string {
  if (!name.startsWith("veryfront__")) return name;
  const legacyName = name.slice("veryfront__".length);
  return legacyName && !legacyName.includes("__") ? legacyName : name;
}

/** Adapt a live platform catalog without retaining project or credential state. */
export function createLivePlatformMcpSource(source: RemoteToolSource): RemoteToolSource {
  if (hasAdaptedPlatformSource(source)) return source;
  // Keep only wire-name translations. The wrapped source still checks the
  // current project, credentials, access profile, and policy during execution.
  let wireNames = createPrivateMap<string, string>();
  const listTools = async (context?: ToolExecutionContext): Promise<ToolDefinition[]> => {
    const catalog = createPlatformMcpCatalogSource(source, await source.listTools(context));
    wireNames = createPrivateMap<string, string>();
    for (const { name } of catalog.definitions) {
      wireNames.set(name, catalog.aliases.get(name) ?? name);
    }
    return catalog.definitions;
  };
  return markAdaptedPlatformSource({
    id: source.id,
    listTools,
    executeTool: async (name, args, context) => {
      if (!wireNames.has(name)) await listTools(context);
      const wireName = wireNames.get(name);
      if (!wireName) {
        throw PERMISSION_DENIED.create({ detail: `Tool "${name}" is not in the platform catalog` });
      }
      return source.executeTool(wireName, args, context);
    },
  });
}
