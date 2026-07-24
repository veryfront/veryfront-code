import {
  createProjectScopedRemoteToolCatalog,
  createRemoteMCPToolSource,
  isToolVisibleTo,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  toolRegistry,
} from "#veryfront/tool";
import { CONFIG_INVALID } from "#veryfront/errors";
import type {
  AgentConfig,
  AgentHttpMcpServerConfig,
  AgentMcpServerAuth,
  AgentMcpServerConfig,
  AgentVeryfrontMcpServerConfig,
} from "../types.ts";
import type { ToolExecutionContext } from "#veryfront/tool";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import {
  getVeryfrontCloudHostBootstrap,
  type VeryfrontCloudBootstrap,
} from "#veryfront/platform/cloud/resolver.ts";
import { createAgentServiceRemoteMcpConfig } from "../service/mcp-server-config.ts";
import { wrapRemoteToolSourceWithMcpPolicy } from "../mcp-tool-policy.ts";
import { getActiveRuntimeRemoteToolSources } from "./remote-tool-source-context.ts";

export type RuntimeRemoteToolConfig = {
  __vfRemoteToolSources?: RemoteToolSource[];
  __vfAllowedRemoteTools?: string[];
  __vfSourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
};

/** Canonical source id for the Veryfront API MCP server. */
export const VERYFRONT_API_MCP_SOURCE_ID = "veryfront-platform-mcp";
/** Canonical source id for the Veryfront Studio MCP server. */
export const VERYFRONT_STUDIO_MCP_SOURCE_ID = "studio-mcp";

const LOCAL_RUNTIME_BOOLEAN_TOOL_NAMES = new Set(["bash", "invoke_agent"]);

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

  return wrapRemoteToolSourceWithMcpPolicy(source, server.toolPolicy, {
    deniedDetail: (toolName) => `Tool "${toolName}" is not allowed for MCP server "${server.id}"`,
  });
}

function createMcpToolPolicySource(
  source: RemoteToolSource,
  policy: AgentMcpServerConfig["toolPolicy"],
): RemoteToolSource {
  return wrapRemoteToolSourceWithMcpPolicy(source, policy, {
    deniedDetail: (toolName, sourceId) =>
      `Tool "${toolName}" is not allowed for MCP server "${sourceId}"`,
  });
}

/** Carry an explicit remote-tool ceiling into nested execution. */
export function constrainRuntimeRemoteToolSources(
  sources: RemoteToolSource[] | undefined,
  allowedToolNames: string[] | undefined,
): RemoteToolSource[] | undefined {
  if (allowedToolNames === undefined) {
    return sources;
  }

  const policy = { allow: [...new Set(allowedToolNames)] };
  const sourcesToConstrain = sources ?? getActiveRuntimeRemoteToolSources() ?? [];
  return sourcesToConstrain.map((source) => createMcpToolPolicySource(source, policy));
}

const REMOTE_TOOL_CREDENTIAL_CONTEXT_KEYS = ["authToken", "runId", "agentId"] as const;

function withBoundRemoteToolContext(
  context: ToolExecutionContext | undefined,
  boundContext: ToolExecutionContext,
  keys: readonly (typeof REMOTE_TOOL_CREDENTIAL_CONTEXT_KEYS)[number][],
): ToolExecutionContext {
  const mergedContext = { ...(context ?? {}) };
  for (const key of keys) {
    if (boundContext[key] !== undefined) {
      mergedContext[key] = boundContext[key];
    }
  }
  return mergedContext;
}

/**
 * Keep inherited remote sources attached to the credential owner that
 * introduced them while preserving nested call-local context.
 *
 * Remote authorization and nested runtime telemetry are intentionally
 * separate: the remote call is attributed to the run-scoped credential
 * owner, while the delegate continues to emit its own child-run lifecycle
 * and tool-call events.
 */
export function bindRuntimeRemoteToolSourcesToCredentialOwner(
  sources: RemoteToolSource[] | undefined,
  context: ToolExecutionContext,
): RemoteToolSource[] | undefined {
  if (sources === undefined) {
    return undefined;
  }

  return sources.map((source) => ({
    id: source.id,
    listTools: (nestedContext) =>
      source.listTools(withBoundRemoteToolContext(nestedContext, context, ["authToken"])),
    executeTool: (toolName, args, nestedContext) =>
      source.executeTool(
        toolName,
        args,
        withBoundRemoteToolContext(
          nestedContext,
          context,
          REMOTE_TOOL_CREDENTIAL_CONTEXT_KEYS,
        ),
      ),
  }));
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

/** Bind a remote tool source to one server-selected project identity. */
export function bindRemoteToolSourceToProject(
  source: RemoteToolSource,
  projectId: string,
): RemoteToolSource {
  const catalog = createProjectScopedRemoteToolCatalog({
    source,
    defaultProjectId: projectId,
  });

  return {
    id: source.id,
    listTools: (context) => catalog.listTools(withServerProject(context, projectId)),
    async executeTool(toolName, args, context) {
      const execution = await catalog.prepareExecution({
        toolName,
        toolInput: withoutProjectReference(args),
        context: withServerProject(context, projectId),
      });
      return await source.executeTool(
        toolName,
        execution.toolInput,
        execution.executeContext,
      );
    },
  };
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
    throw CONFIG_INVALID.create({
      detail:
        "Veryfront API MCP requires server-side VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG.",
    });
  }

  const remoteConfig = createAgentServiceRemoteMcpConfig({
    server,
    authToken,
    apiMcpUrl: `${bootstrap.apiBaseUrl.replace(/\/+$/, "")}/mcp`,
    getProjectId: () => projectId,
    defaultSourceId: VERYFRONT_API_MCP_SOURCE_ID,
  });
  if (!remoteConfig) {
    throw CONFIG_INVALID.create({
      detail: "Veryfront API MCP configuration could not be resolved.",
    });
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
  const policySource = createMcpToolPolicySource(source, server.toolPolicy);
  return bindRemoteToolSourceToProject(policySource, projectId);
}

function requiresInjectedStudioMcpServerToolSource(server: AgentVeryfrontMcpServerConfig): never {
  throw CONFIG_INVALID.create({
    detail:
      `Veryfront Studio MCP server "${
        server.id ?? VERYFRONT_STUDIO_MCP_SOURCE_ID
      }" requires a trusted host-injected control-plane source. ` +
      'Use the hosted/control-plane runtime or inject the Studio MCP remote tool source before declaring { kind: "veryfront-studio" }.',
  });
}

function getFirstPartyMcpSourceId(server: AgentVeryfrontMcpServerConfig): string {
  return server.id ??
    (server.kind === "veryfront-api"
      ? VERYFRONT_API_MCP_SOURCE_ID
      : VERYFRONT_STUDIO_MCP_SOURCE_ID);
}

/** Return remote tool sources for direct agent runtime config. */
export function getRuntimeRemoteToolSources(
  config: AgentConfig,
  dependencies: RuntimeMcpServerToolSourceDependencies = {},
  agentId = config.id,
): RemoteToolSource[] | undefined {
  const runtimeConfig = config as AgentConfig & RuntimeRemoteToolConfig;
  const configuredInjectedSources = Object.hasOwn(runtimeConfig, "__vfRemoteToolSources")
    ? runtimeConfig.__vfRemoteToolSources ?? []
    : undefined;
  const hasExplicitMcpServers = config.mcpServers !== undefined;
  const implicitToolNames = hasExplicitMcpServers
    ? []
    : getRequestedUnresolvedBooleanToolNames({ tools: config.tools, agentId });
  const inheritedSources = hasExplicitMcpServers || implicitToolNames.length > 0
    ? getActiveRuntimeRemoteToolSources() ?? []
    : [];
  const injectedSources = configuredInjectedSources ?? inheritedSources;
  const configuredServers: AgentMcpServerConfig[] = config.mcpServers ??
    (implicitToolNames.length > 0 && configuredInjectedSources === undefined
      ? [{ kind: "veryfront-api", toolPolicy: { allow: implicitToolNames } }]
      : []);
  const configuredFirstPartyServersBySourceId = new Map<string, AgentVeryfrontMcpServerConfig>();
  for (const server of configuredServers) {
    if (!isHttpMcpServerConfig(server)) {
      configuredFirstPartyServersBySourceId.set(getFirstPartyMcpSourceId(server), server);
    }
  }
  const selectedInjectedSources = hasExplicitMcpServers
    ? injectedSources.filter((source) => configuredFirstPartyServersBySourceId.has(source.id))
    : injectedSources;
  const policyWrappedInjectedSources = selectedInjectedSources.map((source) => {
    const server = configuredFirstPartyServersBySourceId.get(source.id);
    const policy = server?.toolPolicy ??
      (implicitToolNames.length > 0 ? { allow: implicitToolNames } : undefined);
    return createMcpToolPolicySource(source, policy);
  });
  const configuredSources = configuredServers.flatMap((server) => {
    if (isHttpMcpServerConfig(server)) {
      return [createMcpServerToolSource(server)];
    }
    if (server.kind === "veryfront-api") {
      if (injectedSources.some((source) => source.id === getFirstPartyMcpSourceId(server))) {
        return [];
      }
      const source = createVeryfrontApiMcpServerToolSource(
        server,
        dependencies,
        hasExplicitMcpServers,
      );
      return source ? [source] : [];
    }
    if (server.kind === "veryfront-studio") {
      if (injectedSources.some((source) => source.id === getFirstPartyMcpSourceId(server))) {
        return [];
      }
      requiresInjectedStudioMcpServerToolSource(server);
    }
    return [];
  });
  const remoteToolSources = [
    ...policyWrappedInjectedSources,
    ...configuredSources,
  ];

  if (remoteToolSources.length > 0) {
    return remoteToolSources;
  }

  return configuredInjectedSources !== undefined || hasExplicitMcpServers ? [] : undefined;
}
