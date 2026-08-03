import type { RemoteMCPToolSourceConfig, RemoteToolSource } from "#veryfront/tool";
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

export type AgentServiceFirstPartyMcpServerKind =
  | "veryfront-api"
  | "veryfront-studio";

export type ResolvedAgentServiceRemoteMcpConfig = {
  config: RemoteMCPToolSourceConfig | null;
  trustedKind?: AgentServiceFirstPartyMcpServerKind;
};

/** Creates a remote source with stable first-party provenance resolved by host code. */
export type AgentServiceRemoteMcpSourceFactory = (
  config: RemoteMCPToolSourceConfig,
  trustedKind?: AgentServiceFirstPartyMcpServerKind,
) => RemoteToolSource;

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

const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;

function readOwnFirstPartyServerKind(
  server: AgentServiceMcpServerConfig,
): AgentServiceFirstPartyMcpServerKind | undefined {
  const descriptor = getOwnPropertyDescriptor(server, "kind");
  if (!descriptor || !hasOwn(descriptor, "value")) return undefined;
  return descriptor.value === "veryfront-api" || descriptor.value === "veryfront-studio"
    ? descriptor.value
    : undefined;
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

export function resolveAgentServiceRemoteMcpConfig(
  input: CreateAgentServiceRemoteMcpConfigInput,
): ResolvedAgentServiceRemoteMcpConfig {
  const trustedKind = readOwnFirstPartyServerKind(input.server);
  if (trustedKind === "veryfront-api") {
    return {
      config: createVeryfrontApiRemoteMcpConfig(
        input,
        input.server as AgentServiceVeryfrontApiMcpServerConfig,
      ),
      trustedKind,
    };
  }

  if (trustedKind === "veryfront-studio") {
    const config = createVeryfrontStudioRemoteMcpConfig(
      input,
      input.server as AgentServiceVeryfrontStudioMcpServerConfig,
    );
    return { config, trustedKind };
  }

  return {
    config: createGenericRemoteMcpConfig(input.server as AgentServiceGenericMcpServerConfig),
  };
}

export function createAgentServiceRemoteMcpConfig(
  input: CreateAgentServiceRemoteMcpConfigInput,
): RemoteMCPToolSourceConfig | null {
  return resolveAgentServiceRemoteMcpConfig(input).config;
}
