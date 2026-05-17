import type { RemoteMCPToolSourceConfig } from "#veryfront/tool";
import { buildStudioMcpHeaders } from "../project/live-studio-mcp-tools.ts";
import { clientAllowsStudioMcp, type RuntimeClientProfile } from "../runtime/client-profile.ts";

export type AgentServiceVeryfrontApiMcpServerConfig = {
  kind: "veryfront-api";
  id?: string;
};

export type AgentServiceVeryfrontStudioMcpServerConfig = {
  kind: "veryfront-studio";
  id?: string;
};

export type AgentServiceGenericMcpServerConfig = {
  kind?: "generic";
  id?: string;
  endpoint: RemoteMCPToolSourceConfig["endpoint"];
  headers?: RemoteMCPToolSourceConfig["headers"];
  fetch?: RemoteMCPToolSourceConfig["fetch"];
  listMethod?: RemoteMCPToolSourceConfig["listMethod"];
  callMethod?: RemoteMCPToolSourceConfig["callMethod"];
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
  return [{ kind: "veryfront-api" }];
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
    headers: {
      Authorization: `Bearer ${input.authToken}`,
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
    headers: () =>
      buildStudioMcpHeaders(
        input.authToken,
        input.getProjectId?.() ?? null,
        input.conversationId,
      ),
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
