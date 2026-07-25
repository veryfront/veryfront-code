import type { RemoteMCPToolSourceConfig, ToolExecutionContext } from "#veryfront/tool";
import type { AgentMcpToolPolicy } from "../types.ts";
import { buildStudioMcpHeaders } from "../project/live-studio-mcp-tools.ts";
import { clientAllowsStudioMcp, type RuntimeClientProfile } from "../runtime/client-profile.ts";
import {
  resolveToolExecutionAuthToken,
  resolveToolExecutionIdentity,
} from "../runtime/tool-execution-identity.ts";

export type AgentServiceVeryfrontApiMcpServerConfig = {
  kind: "veryfront-api";
  id?: string;
  toolPolicy?: AgentMcpToolPolicy;
};

export type AgentServiceVeryfrontStudioMcpServerConfig = {
  kind: "veryfront-studio";
  id?: string;
  toolPolicy?: AgentMcpToolPolicy;
};

export type AgentServiceGenericMcpServerConfig = {
  kind?: "generic";
  id?: string;
  endpoint: RemoteMCPToolSourceConfig["endpoint"];
  headers?: RemoteMCPToolSourceConfig["headers"];
  fetch?: RemoteMCPToolSourceConfig["fetch"];
  listMethod?: RemoteMCPToolSourceConfig["listMethod"];
  callMethod?: RemoteMCPToolSourceConfig["callMethod"];
  toolPolicy?: AgentMcpToolPolicy;
};

export type AgentServiceMcpServerConfig =
  | AgentServiceVeryfrontApiMcpServerConfig
  | AgentServiceVeryfrontStudioMcpServerConfig
  | AgentServiceGenericMcpServerConfig;

export type CreateAgentServiceRemoteMcpConfigInput = {
  server: AgentServiceMcpServerConfig;
  authToken: string;
  apiMcpUrl: string;
  studioMcpUrl?: string | null;
  clientProfile?: RuntimeClientProfile | null;
  getProjectId?: () => string | null | undefined;
  conversationId?: string;
  defaultSourceId?: string;
};

export function defaultAgentServiceMcpServers(): AgentServiceMcpServerConfig[] {
  return [{ kind: "veryfront-api" }, { kind: "veryfront-studio" }];
}

function createGenericRemoteMcpConfig(
  server: AgentServiceGenericMcpServerConfig,
): RemoteMCPToolSourceConfig {
  const config: RemoteMCPToolSourceConfig = {
    endpoint: server.endpoint,
  };

  if (server.id !== undefined) config.id = server.id;
  if (server.headers !== undefined) config.headers = server.headers;
  if (server.fetch !== undefined) config.fetch = server.fetch;
  if (server.listMethod !== undefined) config.listMethod = server.listMethod;
  if (server.callMethod !== undefined) config.callMethod = server.callMethod;

  return config;
}

function resolveExecutionAuthToken(
  context: ToolExecutionContext | undefined,
  fallbackAuthToken: string,
): string {
  return resolveToolExecutionAuthToken(
    context,
    fallbackAuthToken,
    "Execution context",
  ).authToken;
}

function resolveStudioExecutionIdentity(
  context: ToolExecutionContext | undefined,
  input: Pick<CreateAgentServiceRemoteMcpConfigInput, "authToken" | "getProjectId">,
) {
  return resolveToolExecutionIdentity(
    context,
    input.authToken,
    input.getProjectId,
    "Execution context",
  );
}

function createVeryfrontApiRemoteMcpConfig(
  input: Pick<
    CreateAgentServiceRemoteMcpConfigInput,
    "apiMcpUrl" | "authToken" | "defaultSourceId"
  >,
  server: AgentServiceVeryfrontApiMcpServerConfig,
): RemoteMCPToolSourceConfig {
  return {
    id: server.id ?? input.defaultSourceId ?? "veryfront-mcp",
    endpoint: input.apiMcpUrl,
    headers: (context) => {
      const authToken = resolveExecutionAuthToken(context, input.authToken);
      return { Authorization: `Bearer ${authToken}` };
    },
  };
}

function createVeryfrontStudioRemoteMcpConfig(
  input: Pick<
    CreateAgentServiceRemoteMcpConfigInput,
    "authToken" | "clientProfile" | "conversationId" | "getProjectId" | "studioMcpUrl"
  >,
  server: AgentServiceVeryfrontStudioMcpServerConfig,
): RemoteMCPToolSourceConfig | null {
  if (!input.studioMcpUrl || !clientAllowsStudioMcp(input.clientProfile)) {
    return null;
  }

  return {
    id: server.id ?? "studio-mcp",
    endpoint: input.studioMcpUrl,
    headers: (context) => {
      const identity = resolveStudioExecutionIdentity(context, input);
      return buildStudioMcpHeaders(
        identity.authToken,
        identity.projectId,
        input.conversationId,
      );
    },
  };
}

export function createAgentServiceRemoteMcpConfig(
  input: CreateAgentServiceRemoteMcpConfigInput,
): RemoteMCPToolSourceConfig | null {
  if (input.server.kind === "veryfront-api") {
    return createVeryfrontApiRemoteMcpConfig(input, input.server);
  }

  if (input.server.kind === "veryfront-studio") {
    return createVeryfrontStudioRemoteMcpConfig(input, input.server);
  }

  return createGenericRemoteMcpConfig(input.server);
}
