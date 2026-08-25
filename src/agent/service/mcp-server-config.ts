import type { RemoteMCPToolSourceConfig } from "#veryfront/tool";
import type { AgentMcpToolPolicy } from "../types.ts";
import { buildStudioMcpHeaders } from "../project/live-studio-mcp-tools.ts";
import { clientAllowsStudioMcp, type RuntimeClientProfile } from "../runtime/client-profile.ts";

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

/** Build the project-scoped control-plane MCP URL for the active project. */
export function createProjectScopedMcpUrl(
  apiMcpUrl: string,
  projectId: string | null | undefined,
): string {
  const normalizedProjectId = projectId?.trim();
  if (!normalizedProjectId) return apiMcpUrl;

  let url: URL;
  try {
    url = new URL(apiMcpUrl);
  } catch {
    // Let the remote MCP boundary produce its standard configuration error.
    return apiMcpUrl;
  }
  const basePath = url.pathname
    .replace(/\/projects\/[^/]+\/mcp\/?$/, "")
    .replace(/\/mcp\/?$/, "")
    .replace(/\/+$/, "");
  url.pathname = `${basePath}/projects/${encodeURIComponent(normalizedProjectId)}/mcp`;
  return url.toString();
}

function createGenericRemoteMcpConfig(
  server: AgentServiceGenericMcpServerConfig,
): RemoteMCPToolSourceConfig {
  const config: RemoteMCPToolSourceConfig = {
    endpoint: server.endpoint,
  };

  if (server.id !== undefined) config.id = server.id;
  if (server.headers !== undefined) config.headers = server.headers;
  if (server.listMethod !== undefined) config.listMethod = server.listMethod;
  if (server.callMethod !== undefined) config.callMethod = server.callMethod;

  return config;
}

function createVeryfrontApiRemoteMcpConfig(
  input: Pick<
    CreateAgentServiceRemoteMcpConfigInput,
    "apiMcpUrl" | "authToken" | "defaultSourceId" | "getProjectId"
  >,
  server: AgentServiceVeryfrontApiMcpServerConfig,
): RemoteMCPToolSourceConfig {
  return {
    id: server.id ?? input.defaultSourceId ?? "veryfront-mcp",
    endpoint: () => createProjectScopedMcpUrl(input.apiMcpUrl, input.getProjectId?.()),
    headers: () => ({ Authorization: `Bearer ${input.authToken}` }),
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
