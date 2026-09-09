import { PERMISSION_DENIED } from "#veryfront/errors";
import type { HostToolSet, RemoteToolSource, ToolExecutionContext } from "#veryfront/tool";
import type { AgentMcpToolPolicy } from "./types.ts";

const ReflectApply = Reflect.apply;
const ArrayIncludes = Array.prototype.includes;

function includesName(
  names: readonly string[],
  toolName: string,
  identity?: { canonicalName: string; referenceName: string },
): boolean {
  return ReflectApply(ArrayIncludes, names, [toolName]) ||
    (identity !== undefined &&
      (ReflectApply(ArrayIncludes, names, [identity.canonicalName]) ||
        ReflectApply(ArrayIncludes, names, [identity.referenceName])));
}

export type McpToolPolicyGate = {
  allows(toolName: string, identity?: { canonicalName: string; referenceName: string }): boolean;
  filterDefinitions<T extends { name: string }>(definitions: readonly T[]): T[];
  assertAllowed(
    toolName: string,
    identity?: { canonicalName: string; referenceName: string },
  ): void;
};

function isPolicyEmpty(policy: AgentMcpToolPolicy | undefined): boolean {
  return policy?.allow === undefined && policy?.deny === undefined;
}

function defaultDeniedDetail(toolName: string): string {
  return `Tool "${toolName}" is not allowed for this run`;
}

export function createMcpToolPolicyGate(
  policy: AgentMcpToolPolicy | undefined,
  options?: { deniedDetail?: (toolName: string) => string },
): McpToolPolicyGate {
  const deniedDetail = options?.deniedDetail ?? defaultDeniedDetail;

  const allows = (
    toolName: string,
    identity?: { canonicalName: string; referenceName: string },
  ): boolean => {
    const deny = policy?.deny;
    if (deny !== undefined && includesName(deny, toolName, identity)) return false;

    const allow = policy?.allow;
    if (allow !== undefined) return includesName(allow, toolName, identity);

    return true;
  };

  const filterDefinitions = <T extends { name: string }>(definitions: readonly T[]): T[] => {
    const filtered: T[] = [];
    for (let index = 0; index < definitions.length; index++) {
      const definition = definitions[index];
      if (
        definition !== undefined && allows(
          definition.name,
          "identity" in definition && definition.identity !== undefined
            ? definition.identity as { canonicalName: string; referenceName: string }
            : undefined,
        )
      ) {
        filtered[filtered.length] = definition;
      }
    }
    return filtered;
  };

  const assertAllowed = (
    toolName: string,
    identity?: { canonicalName: string; referenceName: string },
  ): void => {
    if (allows(toolName, identity)) return;

    throw PERMISSION_DENIED.create({ detail: deniedDetail(toolName) });
  };

  return { allows, filterDefinitions, assertAllowed };
}

export function wrapRemoteToolSourceWithMcpPolicy(
  source: RemoteToolSource,
  policy: AgentMcpToolPolicy | undefined,
  options?: { deniedDetail?: (toolName: string, sourceId: string) => string },
): RemoteToolSource {
  if (isPolicyEmpty(policy)) return source;

  const gate = createMcpToolPolicyGate(policy, {
    deniedDetail: (toolName) =>
      options?.deniedDetail?.(toolName, source.id) ??
        defaultDeniedDetail(toolName),
  });
  const identities = new Map<string, { canonicalName: string; referenceName: string }>();

  return {
    ...source,
    id: source.id,
    listTools: async (context) => {
      const definitions = await source.listTools(context);
      identities.clear();
      for (const definition of definitions) {
        if (definition.identity) identities.set(definition.name, definition.identity);
      }
      return gate.filterDefinitions(definitions);
    },
    executeTool: (toolName, args, context) => {
      gate.assertAllowed(toolName, identities.get(toolName));
      return source.executeTool(toolName, args, context);
    },
  };
}

export function wrapHostToolSetWithMcpPolicy(
  tools: HostToolSet,
  policy: AgentMcpToolPolicy | undefined,
  options?: { deniedDetail?: (toolName: string) => string },
): HostToolSet {
  if (isPolicyEmpty(policy)) return tools;

  const gate = createMcpToolPolicyGate(policy, options);
  const wrapped: HostToolSet = {};

  for (const [toolName, definition] of Object.entries(tools)) {
    if (!gate.allows(toolName)) continue;

    if (definition.execute === undefined) {
      wrapped[toolName] = { ...definition };
      continue;
    }

    const execute = definition.execute;
    wrapped[toolName] = {
      ...definition,
      execute: (toolInput: unknown, execOptions?: ToolExecutionContext) => {
        gate.assertAllowed(toolName);
        return execute(toolInput, execOptions);
      },
    };
  }

  return wrapped;
}
