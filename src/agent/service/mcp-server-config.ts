import type { RemoteMCPToolSourceConfig } from "#veryfront/tool";
import type { AgentMcpToolPolicy } from "../types.ts";
import { buildStudioMcpHeaders } from "../project/live-studio-mcp-tools.ts";
import { clientAllowsStudioMcp, type RuntimeClientProfile } from "../runtime/client-profile.ts";

/** Veryfront API MCP server configuration for an agent service. */
export type AgentServiceVeryfrontApiMcpServerConfig = {
  /** Server kind discriminator. */
  kind: "veryfront-api";
  /** Optional stable source identifier. */
  id?: string;
  /** Tool allow, deny, and approval policy. */
  toolPolicy?: AgentMcpToolPolicy;
};

/** Veryfront Studio MCP server configuration for an agent service. */
export type AgentServiceVeryfrontStudioMcpServerConfig = {
  /** Server kind discriminator. */
  kind: "veryfront-studio";
  /** Optional stable source identifier. */
  id?: string;
  /** Tool allow, deny, and approval policy. */
  toolPolicy?: AgentMcpToolPolicy;
};

/** Generic remote MCP server configuration for an agent service. */
export type AgentServiceGenericMcpServerConfig = {
  /** Optional generic server discriminator. */
  kind?: "generic";
  /** Optional stable source identifier. */
  id?: string;
  /** Remote MCP endpoint. */
  endpoint: RemoteMCPToolSourceConfig["endpoint"];
  /** Static or request-derived HTTP headers. */
  headers?: RemoteMCPToolSourceConfig["headers"];
  /** Optional fetch implementation. */
  fetch?: RemoteMCPToolSourceConfig["fetch"];
  /** Optional JSON-RPC method used to list tools. */
  listMethod?: RemoteMCPToolSourceConfig["listMethod"];
  /** Optional JSON-RPC method used to call a tool. */
  callMethod?: RemoteMCPToolSourceConfig["callMethod"];
  /** Tool allow, deny, and approval policy. */
  toolPolicy?: AgentMcpToolPolicy;
};

/** MCP server configurations accepted by an agent service. */
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
      const authToken = typeof context?.authToken === "string" && context.authToken.length > 0
        ? context.authToken
        : input.authToken;
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
