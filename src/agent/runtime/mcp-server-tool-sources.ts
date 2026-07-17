import { createRemoteMCPToolSource, type RemoteToolSource } from "#veryfront/tool";
import type {
  AgentConfig,
  AgentHttpMcpServerConfig,
  AgentMcpServerAuth,
  AgentMcpServerConfig,
} from "../types.ts";
import type { ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";

export type RuntimeRemoteToolConfig = {
  __vfRemoteToolSources?: RemoteToolSource[];
  __vfAllowedRemoteTools?: string[];
  __vfSourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
};

async function resolveValue<T>(
  value: T | ((context?: ToolExecutionContext) => T | Promise<T>),
  context?: ToolExecutionContext,
): Promise<T> {
  return typeof value === "function"
    ? await (value as (context?: ToolExecutionContext) => T | Promise<T>)(context)
    : value;
}

async function resolveHeaders(
  auth: AgentMcpServerAuth | undefined,
  context?: ToolExecutionContext,
): Promise<HeadersInit | undefined> {
  if (!auth) {
    return undefined;
  }

  if (auth.type === "bearer") {
    return { Authorization: `Bearer ${await resolveValue(auth.token, context)}` };
  }

  return await resolveValue(auth.headers, context);
}

function isToolAllowed(
  toolName: string,
  policy: AgentMcpServerConfig["toolPolicy"],
): boolean {
  if (policy?.allow && !policy.allow.includes(toolName)) {
    return false;
  }
  if (policy?.deny?.includes(toolName)) {
    return false;
  }
  return true;
}

function filterToolDefinitions(
  definitions: ToolDefinition[],
  policy: AgentMcpServerConfig["toolPolicy"],
): ToolDefinition[] {
  return definitions.filter((definition) => isToolAllowed(definition.name, policy));
}

function isHttpMcpServerConfig(server: AgentMcpServerConfig): server is AgentHttpMcpServerConfig {
  return "transport" in server;
}

function createMcpServerToolSource(server: AgentHttpMcpServerConfig): RemoteToolSource {
  const source = createRemoteMCPToolSource({
    id: server.id,
    endpoint: (context) => resolveValue(server.transport.url, context),
    headers: (context) => resolveHeaders(server.auth, context),
    ...(server.fetch ? { fetch: server.fetch } : {}),
  });

  return {
    id: source.id,
    async listTools(context) {
      return filterToolDefinitions(await source.listTools(context), server.toolPolicy);
    },
    executeTool(toolName, args, context) {
      if (!isToolAllowed(toolName, server.toolPolicy)) {
        throw new Error(`Tool "${toolName}" is not allowed for MCP server "${server.id}"`);
      }
      return source.executeTool(toolName, args, context);
    },
  };
}

/** Return remote tool sources for direct agent runtime config. */
export function getRuntimeRemoteToolSources(config: AgentConfig): RemoteToolSource[] | undefined {
  const runtimeConfig = config as AgentConfig & RuntimeRemoteToolConfig;
  const remoteToolSources = [
    ...(runtimeConfig.__vfRemoteToolSources ?? []),
    ...(config.mcpServers ?? []).filter(isHttpMcpServerConfig).map(createMcpServerToolSource),
  ];

  return remoteToolSources.length > 0 ? remoteToolSources : undefined;
}
