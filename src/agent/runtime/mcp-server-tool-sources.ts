import {
  createProjectScopedRemoteToolCatalog,
  createRemoteMCPToolSource,
  isToolVisibleTo,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  toolRegistry,
} from "#veryfront/tool";
import { PERMISSION_DENIED } from "#veryfront/errors";
import type {
  AgentConfig,
  AgentHttpMcpServerConfig,
  AgentMcpServerAuth,
  AgentMcpServerConfig,
  AgentVeryfrontMcpServerConfig,
} from "../types.ts";
import type { ToolDefinition, ToolExecutionContext } from "#veryfront/tool";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import {
  getVeryfrontCloudHostBootstrap,
  type VeryfrontCloudBootstrap,
} from "#veryfront/platform/cloud/resolver.ts";
import { createAgentServiceRemoteMcpConfig } from "../service/mcp-server-config.ts";

export type RuntimeRemoteToolConfig = {
  __vfRemoteToolSources?: RemoteToolSource[];
  __vfAllowedRemoteTools?: string[];
  __vfSourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
};

/** Canonical source id for the Veryfront API MCP server. */
export const VERYFRONT_API_MCP_SOURCE_ID = "veryfront-platform-mcp";

const LOCAL_RUNTIME_BOOLEAN_TOOL_NAMES = new Set(["bash", "invoke_agent"]);

const VERYFRONT_API_PROJECT_TOOL_DEFINITIONS: Record<string, ToolDefinition> = {
  get_file: {
    name: "get_file",
    description: "Read a file from the active Veryfront project.",
    parameters: {
      type: "object",
      properties: {
        project_reference: { type: "string" },
        path: { type: "string", description: "Project-relative file path." },
      },
      required: ["project_reference", "path"],
    },
  },
  list_files: {
    name: "list_files",
    description: "List files in the active Veryfront project.",
    parameters: {
      type: "object",
      properties: {
        project_reference: { type: "string" },
        path: { type: "string", description: "Optional project-relative directory path." },
      },
      required: ["project_reference"],
    },
  },
  create_file: {
    name: "create_file",
    description: "Create a file in the active Veryfront project.",
    parameters: {
      type: "object",
      properties: {
        project_reference: { type: "string" },
        path: { type: "string", description: "Project-relative file path." },
        content: { type: "string", description: "File contents." },
      },
      required: ["project_reference", "path", "content"],
    },
  },
  update_file: {
    name: "update_file",
    description: "Update a file in the active Veryfront project.",
    parameters: {
      type: "object",
      properties: {
        project_reference: { type: "string" },
        path: { type: "string", description: "Project-relative file path." },
        content: { type: "string", description: "Replacement file contents." },
      },
      required: ["project_reference", "path", "content"],
    },
  },
  delete_file: {
    name: "delete_file",
    description: "Delete a file from the active Veryfront project.",
    parameters: {
      type: "object",
      properties: {
        project_reference: { type: "string" },
        path: { type: "string", description: "Project-relative file path." },
      },
      required: ["project_reference", "path"],
    },
  },
  create_upload_signed_url: {
    name: "create_upload_signed_url",
    description: "Create a signed upload URL for an active Veryfront project file.",
    parameters: {
      type: "object",
      properties: {
        project_reference: { type: "string" },
        path: { type: "string", description: "Project-relative upload destination." },
        content_type: { type: "string", description: "Optional MIME type." },
      },
      required: ["project_reference", "path"],
    },
  },
};

function hasVisibleRegistryTool(toolName: string, agentId?: string): boolean {
  if (agentId !== undefined) {
    for (const tool of toolRegistry.getAll().values()) {
      if (tool.ownerAgentId === agentId && tool.shortName === toolName) {
        return true;
      }
    }
  }
  const tool = toolRegistry.get(toolName);
  return tool !== undefined && isToolVisibleTo(tool, { agentId });
}

/** Return explicitly selected boolean tools that still need a remote provider. */
export function getRequestedUnresolvedBooleanToolNames(input: {
  tools: AgentConfig["tools"];
  agentId?: string;
  availableToolNames?: readonly string[];
}): string[] {
  if (!input.tools || input.tools === true) {
    return [];
  }

  const availableToolNames = new Set(input.availableToolNames ?? []);
  return Object.entries(input.tools)
    .filter(([toolName, entry]) =>
      entry === true &&
      !hasVisibleRegistryTool(toolName, input.agentId) &&
      !availableToolNames.has(toolName) &&
      !LOCAL_RUNTIME_BOOLEAN_TOOL_NAMES.has(toolName)
    )
    .map(([toolName]) => toolName)
    .sort();
}

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

function hydrateAllowedVeryfrontProjectToolDefinitions(
  definitions: ToolDefinition[],
  policy: AgentMcpServerConfig["toolPolicy"],
): ToolDefinition[] {
  const allowed = policy?.allow;
  if (!allowed?.length) {
    return definitions;
  }

  const hydrated = [...definitions];
  const existingNames = new Set(hydrated.map((definition) => definition.name));
  for (const toolName of allowed) {
    if (existingNames.has(toolName) || !isToolAllowed(toolName, policy)) {
      continue;
    }
    const fallbackDefinition = VERYFRONT_API_PROJECT_TOOL_DEFINITIONS[toolName];
    if (!fallbackDefinition) {
      continue;
    }
    hydrated.push(fallbackDefinition);
    existingNames.add(toolName);
  }
  return hydrated;
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
        throw PERMISSION_DENIED.create({
          detail: `Tool "${toolName}" is not allowed for MCP server "${server.id}"`,
        });
      }
      return source.executeTool(toolName, args, context);
    },
  };
}

export type RuntimeMcpServerToolSourceDependencies = {
  createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
  getVeryfrontBootstrap?: () => VeryfrontCloudBootstrap;
};

function withServerProject(
  context: ToolExecutionContext | undefined,
  projectId: string,
): ToolExecutionContext {
  return { ...(context ?? {}), projectId };
}

function withoutProjectReference(args: unknown): Record<string, unknown> {
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    return {};
  }
  const { project_reference: _untrustedProjectReference, ...toolInput } = args as Record<
    string,
    unknown
  >;
  return toolInput;
}

function createVeryfrontApiMcpServerToolSource(
  server: AgentVeryfrontMcpServerConfig,
  dependencies: RuntimeMcpServerToolSourceDependencies,
  requireIdentity: boolean,
): RemoteToolSource | undefined {
  const bootstrap = (dependencies.getVeryfrontBootstrap ?? getVeryfrontCloudHostBootstrap)();
  const authToken = bootstrap.apiToken?.trim();
  const projectId = bootstrap.projectSlug?.trim();
  if (!authToken || !projectId) {
    if (!requireIdentity) {
      return undefined;
    }
    throw new Error(
      "Veryfront API MCP requires server-side VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG.",
    );
  }

  const remoteConfig = createAgentServiceRemoteMcpConfig({
    server,
    authToken,
    apiMcpUrl: `${bootstrap.apiBaseUrl.replace(/\/+$/, "")}/mcp`,
    getProjectId: () => projectId,
    defaultSourceId: VERYFRONT_API_MCP_SOURCE_ID,
  });
  if (!remoteConfig) {
    throw new Error("Veryfront API MCP configuration could not be resolved.");
  }
  const configuredHeaders = remoteConfig.headers;
  const createSource = dependencies.createRemoteToolSource ?? createRemoteMCPToolSource;
  const source = createSource({
    ...remoteConfig,
    // Direct application routes use the server bootstrap identity. Request
    // payloads must not replace the MCP credential through tool context.
    ...(configuredHeaders
      ? {
        headers: typeof configuredHeaders === "function"
          ? () => configuredHeaders()
          : configuredHeaders,
      }
      : {}),
  });
  const policySource: RemoteToolSource = {
    id: source.id,
    async listTools(context) {
      return filterToolDefinitions(
        hydrateAllowedVeryfrontProjectToolDefinitions(
          await source.listTools(context),
          server.toolPolicy,
        ),
        server.toolPolicy,
      );
    },
    executeTool(toolName, args, context) {
      if (!isToolAllowed(toolName, server.toolPolicy)) {
        throw PERMISSION_DENIED.create({
          detail: `Tool "${toolName}" is not allowed for MCP server "${source.id}"`,
        });
      }
      return source.executeTool(toolName, args, context);
    },
  };
  const catalog = createProjectScopedRemoteToolCatalog({
    source: policySource,
    defaultProjectId: projectId,
  });

  return {
    id: policySource.id,
    listTools: (context) => catalog.listTools(withServerProject(context, projectId)),
    async executeTool(toolName, args, context) {
      const execution = await catalog.prepareExecution({
        toolName,
        toolInput: withoutProjectReference(args),
        context: withServerProject(context, projectId),
      });
      return await policySource.executeTool(
        toolName,
        execution.toolInput,
        execution.executeContext,
      );
    },
  };
}

/** Return remote tool sources for direct agent runtime config. */
export function getRuntimeRemoteToolSources(
  config: AgentConfig,
  dependencies: RuntimeMcpServerToolSourceDependencies = {},
  agentId = config.id,
): RemoteToolSource[] | undefined {
  const runtimeConfig = config as AgentConfig & RuntimeRemoteToolConfig;
  const injectedSources = runtimeConfig.__vfRemoteToolSources ?? [];
  const hasInjectedVeryfrontApi = injectedSources.some((source) =>
    source.id === VERYFRONT_API_MCP_SOURCE_ID
  );
  const hasExplicitMcpServers = config.mcpServers !== undefined;
  const implicitToolNames = hasExplicitMcpServers
    ? []
    : getRequestedUnresolvedBooleanToolNames({ tools: config.tools, agentId });
  const configuredServers: AgentMcpServerConfig[] = config.mcpServers ??
    (implicitToolNames.length > 0
      ? [{ kind: "veryfront-api", toolPolicy: { allow: implicitToolNames } }]
      : []);
  const configuredSources = configuredServers.flatMap((server) => {
    if (isHttpMcpServerConfig(server)) {
      return [createMcpServerToolSource(server)];
    }
    if (server.kind === "veryfront-api") {
      if (hasInjectedVeryfrontApi) {
        return [];
      }
      const source = createVeryfrontApiMcpServerToolSource(
        server,
        dependencies,
        hasExplicitMcpServers,
      );
      return source ? [source] : [];
    }
    return [];
  });
  const remoteToolSources = [
    ...injectedSources,
    ...configuredSources,
  ];

  return remoteToolSources.length > 0 ? remoteToolSources : undefined;
}
