import { PERMISSION_DENIED } from "#veryfront/errors";
import type { HostToolSet, RemoteToolSource, ToolExecutionContext } from "#veryfront/tool";
import type { AgentMcpToolPolicy } from "./types.ts";

export type McpToolPolicyGate = {
  allows(toolName: string): boolean;
  filterDefinitions<T extends { name: string }>(definitions: readonly T[]): T[];
  assertAllowed(toolName: string): void;
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

  return {
    allows(toolName: string): boolean {
      const deny = policy?.deny;
      if (deny?.includes(toolName)) return false;

      const allow = policy?.allow;
      if (allow !== undefined) return allow.includes(toolName);

      return true;
    },

    filterDefinitions<T extends { name: string }>(definitions: readonly T[]): T[] {
      return definitions.filter((definition) => this.allows(definition.name));
    },

    assertAllowed(toolName: string): void {
      if (this.allows(toolName)) return;

      throw PERMISSION_DENIED.create({ detail: deniedDetail(toolName) });
    },
  };
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

  return {
    ...source,
    listTools: async (context) => gate.filterDefinitions(await source.listTools(context)),
    executeTool: (toolName, args, context) => {
      gate.assertAllowed(toolName);
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
