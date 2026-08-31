import type { Agent } from "#veryfront/agent";
import type { AgentMcpServerConfig } from "#veryfront/agent/types.ts";
import {
  createRemoteMCPToolSource,
  type RemoteToolSource,
  type ToolDefinition,
} from "#veryfront/tool";
import { getRemoteToolProvenance } from "#veryfront/tool/remote-tool-provenance.ts";
import { defaultChannelInvokeDeps } from "#veryfront/channels/invoke.ts";
import { type RuntimeAgentDiscoveryDeps } from "#veryfront/channels/control-plane.ts";
import { getDiscoveredHostTools } from "#veryfront/agent/hosted/veryfront-cloud-agent-service.ts";
import {
  runWithVerifiedCacheApiCredential,
  withoutVerifiedCacheApiCredential,
} from "#veryfront/cache/verified-api-credential-context.ts";
import {
  createRuntimeAgentStreamResponse,
  registerRuntimeInferenceCredential,
  type RuntimeAgentStreamExecutionDeps,
} from "#veryfront/internal-agents/run-stream.ts";
import { createRuntimeAgentFromMarkdownDefinition } from "#veryfront/agent/runtime/agent-markdown-adapter.ts";
import {
  bindRemoteToolSourceToProject,
  getRequestedUnresolvedBooleanToolNames,
  type RuntimeRemoteToolConfig,
  VERYFRONT_API_MCP_SOURCE_ID,
  VERYFRONT_STUDIO_MCP_SOURCE_ID,
} from "#veryfront/agent/runtime/mcp-server-tool-sources.ts";
import {
  type AgentServiceVeryfrontStudioMcpServerConfig,
  createAgentServiceRemoteMcpConfig,
} from "#veryfront/agent/service/mcp-server-config.ts";
import { createMcpToolPolicyGate } from "#veryfront/agent/mcp-tool-policy.ts";
import {
  clientAllowsStudioMcp,
  resolveRuntimeClientProfile,
} from "#veryfront/agent/runtime/client-profile.ts";
import {
  resolveRuntimeOwnerInvokeUrl,
  RUNTIME_OWNER_INVOKE_URL_HEADER,
} from "#veryfront/internal-agents/runtime-owner.ts";
import {
  ControlPlaneRequestError,
  verifyControlPlaneRequest,
} from "#veryfront/internal-agents/control-plane-auth.ts";
import {
  INTERNAL_AGENT_STREAM_MAX_BODY_BYTES,
  InternalAgentRequestBodyTooLargeError,
  readInternalAgentRequestBody,
} from "#veryfront/internal-agents/request-body.ts";
import {
  AgentRunAlreadyExistsError,
  agentRunSessionManager,
} from "#veryfront/internal-agents/session-manager.ts";
import {
  buildRuntimeAgentControlPlaneStreamRequestFromInvocation,
  RuntimeAgentRunInvocationSchema,
} from "#veryfront/agent/runtime/agent-invocation-contract.ts";
import {
  getInternalAgentStreamRequestSchema,
  type InternalAgentStreamRequest,
  type RuntimeAgentSourceContext,
  type RuntimeRunAgentInput,
  toRuntimeRunAgentInput,
} from "#veryfront/internal-agents/schema.ts";
import {
  AUTHENTICATION_REQUIRED,
  errorToResponse,
  INVALID_ARGUMENT,
  isVeryfrontError,
  PERMISSION_DENIED,
  SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE,
} from "#veryfront/errors";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  PRIORITY_MEDIUM_API,
} from "#veryfront/utils/constants/index.ts";
import { reportHandlerFailure } from "./report-handler-failure.ts";
import { buildRuntimeShuttingDownResponse } from "./runtime-shutdown-response.ts";
import { isServerShuttingDown } from "../../shutdown-state.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { resolveVeryfrontApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";
import { serverLogger } from "#veryfront/utils";
import {
  EnvironmentVariableCache,
  fetchProjectEnvVars,
  filterRuntimeProjectEnv,
  ProjectEnvironmentIdentityResolver,
  runWithProjectEnv,
  unwrapReplayedProjectEnvironmentFailure,
} from "../../project-env/index.ts";
import { getHostedConfig, type VeryfrontConfig } from "#veryfront/config/loader.ts";
import { prepareDeclarativeConfigContext } from "#veryfront/config/declarative-evaluator.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { isProviderReplayCheckpointEmissionEnabled } from "#veryfront/agent/hosted/chat-preparation.ts";
import { getServerResolvedProviderReplayCheckpoints } from "#veryfront/agent/hosted/runtime-request-config.ts";
import { RUN_EVENT_APPEND_TOKEN_HEADER } from "#veryfront/agent/hosted/chat-request-parser.ts";
import { FSAdapterWrapper } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { MultiProjectFSAdapter } from "#veryfront/platform/adapters/fs/veryfront/multi-project-adapter.ts";
import { runWithoutRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import type { SourceSnapshotFreshnessOptions } from "#veryfront/platform/adapters/base.ts";
import { createRunScopedProviderReplayCheckpointPersister } from "#veryfront/internal-agents/provider-replay-checkpoint-persister.ts";

export interface AgentStreamHandlerDeps
  extends RuntimeAgentDiscoveryDeps, RuntimeAgentStreamExecutionDeps {
  resolveRuntimeOwnerInvokeUrl?: typeof resolveRuntimeOwnerInvokeUrl;
  getLocalTools?: (agentId: string) => RuntimeAgentStreamExecutionDeps["localTools"];
  loadAgentSourceEnvironment?: AgentSourceEnvironmentLoader;
  normalizeSourceIntegrationPolicy?: typeof normalizeSourceIntegrationPolicy;
  createRunScopedProviderReplayCheckpointPersister?:
    typeof createRunScopedProviderReplayCheckpointPersister;
}

type AgentSourceTargetIdentity = Pick<
  InternalAgentStreamRequest,
  "runtimeTargetKind" | "runtimeTargetEnvironmentId" | "runtimeTargetBranchId"
>;

export type AgentSourceEnvironmentLoader = (
  ctx: HandlerContext,
  sourceContext: RuntimeAgentSourceContext,
  targetIdentity: AgentSourceTargetIdentity,
  apiAuthToken: string,
  signal?: AbortSignal,
) => Promise<Record<string, string>>;

const defaultDeps: AgentStreamHandlerDeps = {
  ...defaultChannelInvokeDeps,
  sessionManager: agentRunSessionManager,
  resolveRuntimeOwnerInvokeUrl,
  loadAgentSourceEnvironment: resolveAgentSourceEnvironment,
  getLocalTools: (agentId) =>
    getDiscoveredHostTools({ agentId }) as RuntimeAgentStreamExecutionDeps["localTools"],
  providerReplayCheckpointEmissionEnabled: isProviderReplayCheckpointEmissionEnabled(),
  createRunScopedProviderReplayCheckpointPersister,
};
const logger = serverLogger.component("agent-stream-handler");
const IntrinsicReflectApply = Reflect.apply;
const ObjectPrototypeIsPrototypeOf = Object.prototype.isPrototypeOf;
const FSAdapterWrapperPrototype = FSAdapterWrapper.prototype;
const FSAdapterWrapperRunWithContext = FSAdapterWrapperPrototype.runWithContext;
const MultiProjectFSAdapterPrototype = MultiProjectFSAdapter.prototype;
const MultiProjectFSAdapterRunWithContext = MultiProjectFSAdapterPrototype.runWithContext;

/** VeryfrontError.cause is `unknown` and is often a plain string. */
function describeErrorCause(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) return cause.message;
  return typeof cause === "string" ? cause : String(cause);
}
const RUN_STREAM_PATH_REGEX = /^\/api\/control-plane\/runs\/([^/]+)\/stream$/;
const STUDIO_RUNTIME_REMOTE_TOOL_NAMES = new Set<string>(
  [
    "studio_suggestions",
    "studio_todo_write",
    "studio_panel_control",
    "studio_open_project",
    "studio_display_media",
    "studio_capture_screenshot",
  ] as const,
);

// Per-environment env var cache shared across all agent stream requests (60s TTL)
const _agentEnvVarCache = new EnvironmentVariableCache(
  ({ environmentId, token, projectSlug }, signal) => {
    return fetchProjectEnvVars(
      resolveVeryfrontApiBaseUrlFromHostEnv(),
      projectSlug,
      environmentId,
      token,
      signal,
    );
  },
  60_000,
  100,
  { markFailureReplays: true },
);

const _environmentIdentityResolver = new ProjectEnvironmentIdentityResolver();

function mergeAllowedRemoteTools(
  current: RuntimeRemoteToolConfig["__vfAllowedRemoteTools"],
  requestedToolNames: string[],
): string[] {
  const allowed = new Set(
    Array.isArray(current) && current.every((toolName) => typeof toolName === "string")
      ? current
      : [],
  );
  for (const toolName of requestedToolNames) {
    allowed.add(toolName);
  }
  return [...allowed].sort(compareStrings);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeForwardedRuntimeAllowedTools(input: {
  forwardedProps?: Record<string, unknown>;
  availableToolNames: string[];
  sourceAuthorizesAllTools: boolean;
  sourceAuthorizedToolNames: ReadonlySet<string>;
  aliasedCanonicalToolNames: ReadonlySet<string>;
  allowedStudioRuntimeToolNames: ReadonlySet<string>;
}): Record<string, unknown> | undefined {
  const forwardedProps = input.forwardedProps;
  if (!isRecord(forwardedProps)) {
    return forwardedProps;
  }

  const runtimeOverrides = isRecord(forwardedProps.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides) {
    return forwardedProps;
  }

  const nextRuntimeOverrides: Record<string, unknown> = { ...runtimeOverrides };
  let sanitized = false;

  const allowedTools = runtimeOverrides.allowedTools;
  if (
    Object.hasOwn(runtimeOverrides, "allowedTools") &&
    Array.isArray(allowedTools) &&
    allowedTools.every((toolName) => typeof toolName === "string")
  ) {
    const availableToolNames = new Set(input.availableToolNames);
    // Platform remote tools are gated separately by the child agent config in
    // withVeryfrontPlatformRemoteTools. Studio-only runtime tool names are
    // preserved only when the resolved agent config itself declares the tool for
    // a Studio-capable client; self-asserted Studio client metadata alone never
    // widens the forwarded allowlist. Every other forwarded name must be covered
    // by the source-resolved agent configuration: a `tools: true` selector
    // authorizes the scoped catalog (still bounded downstream by the source
    // integration policy), while explicit tool maps authorize their non-disabled
    // entries under both local and canonical remote names.
    const sanitizedAllowedTools = allowedTools.filter((toolName) => {
      if (STUDIO_RUNTIME_REMOTE_TOOL_NAMES.has(toolName)) {
        return availableToolNames.has(toolName) ||
          input.allowedStudioRuntimeToolNames.has(toolName);
      }
      return availableToolNames.has(toolName) ||
        input.sourceAuthorizesAllTools ||
        input.sourceAuthorizedToolNames.has(toolName);
    });
    if (sanitizedAllowedTools.length !== allowedTools.length) {
      nextRuntimeOverrides.allowedTools = sanitizedAllowedTools;
      sanitized = true;
    }
  }

  // An aliased source tool is only callable through its local alias: the
  // canonical remote name stays authorized so the runtime's canonical
  // allowlist keeps the materialized alias, but the forwarded fallback
  // definition for that canonical name must not be exposed as a second
  // callable tool that would bypass the configured alias.
  const forwardedDefinitions = runtimeOverrides.integrationToolDefinitions;
  if (Array.isArray(forwardedDefinitions) && input.aliasedCanonicalToolNames.size > 0) {
    const sanitizedDefinitions = forwardedDefinitions.filter((definition) =>
      !(isRecord(definition) && typeof definition.name === "string" &&
        input.aliasedCanonicalToolNames.has(definition.name))
    );
    if (sanitizedDefinitions.length !== forwardedDefinitions.length) {
      nextRuntimeOverrides.integrationToolDefinitions = sanitizedDefinitions;
      sanitized = true;
    }
  }

  if (!sanitized) {
    return forwardedProps;
  }

  const nextForwardedProps: Record<string, unknown> = {
    ...forwardedProps,
    runtimeOverrides: nextRuntimeOverrides,
  };
  if (Object.keys(nextRuntimeOverrides).length === 0) {
    delete nextForwardedProps.runtimeOverrides;
  }

  return Object.keys(nextForwardedProps).length > 0 ? nextForwardedProps : undefined;
}

function getAgentDeclaredToolNames(agent: Agent): {
  declaredToolNames: Set<string>;
  aliasedCanonicalToolNames: Set<string>;
} {
  const declaredToolNames = new Set<string>();
  const aliasedCanonicalToolNames = new Set<string>();
  const tools = agent.config.tools;
  if (!isRecord(tools)) {
    return { declaredToolNames, aliasedCanonicalToolNames };
  }
  for (const [toolName, entry] of Object.entries(tools)) {
    // `false` disables the tool explicitly; a disabled entry never authorizes
    // a forwarded allowlist name.
    if (entry === false) {
      continue;
    }
    declaredToolNames.add(toolName);
    // Aliased source tools are keyed by their local alias while forwarded
    // allowlists and remote execution use the canonical remote name carried by
    // trusted provenance; authorize both spellings of the same declared tool,
    // but record canonical names that only exist behind an alias so their
    // forwarded fallback definitions can be suppressed.
    const canonicalRemoteToolName = getRemoteToolProvenance(entry);
    if (canonicalRemoteToolName !== undefined) {
      declaredToolNames.add(canonicalRemoteToolName);
      if (
        canonicalRemoteToolName !== toolName &&
        !(Object.hasOwn(tools, canonicalRemoteToolName) &&
          tools[canonicalRemoteToolName] !== false)
      ) {
        aliasedCanonicalToolNames.add(canonicalRemoteToolName);
      }
    }
  }
  return { declaredToolNames, aliasedCanonicalToolNames };
}

function sanitizeRuntimeRunAgentInput(
  input: RuntimeRunAgentInput,
  agent: Agent,
): RuntimeRunAgentInput {
  const clientProfile = resolveRuntimeClientProfile(input.forwardedProps);
  const { declaredToolNames, aliasedCanonicalToolNames } = getAgentDeclaredToolNames(agent);

  return {
    ...input,
    forwardedProps: sanitizeForwardedRuntimeAllowedTools({
      forwardedProps: input.forwardedProps,
      availableToolNames: input.tools.map((tool) => tool.name),
      sourceAuthorizesAllTools: agent.config.tools === true,
      sourceAuthorizedToolNames: declaredToolNames,
      aliasedCanonicalToolNames,
      allowedStudioRuntimeToolNames: clientAllowsStudioMcp(clientProfile)
        ? declaredToolNames
        : new Set(),
    }),
  };
}

function getVeryfrontApiMcpPolicy(agent: Agent): {
  allowAll: boolean;
  requestedToolNames: string[];
  deniedToolNames: Set<string>;
} {
  const requestedToolNames = new Set<string>();
  const deniedToolNames = new Set<string>();
  let allowAll = false;

  for (const server of agent.config.mcpServers ?? []) {
    if (!("kind" in server) || server.kind !== "veryfront-api") {
      continue;
    }
    for (const toolName of server.toolPolicy?.deny ?? []) {
      deniedToolNames.add(toolName);
    }
    if (server.toolPolicy?.allow) {
      for (const toolName of server.toolPolicy.allow) {
        requestedToolNames.add(toolName);
      }
    } else {
      allowAll = true;
    }
  }

  return { allowAll, requestedToolNames: [...requestedToolNames], deniedToolNames };
}

function hasVeryfrontPlatformRemoteToolSource(
  remoteTools: RemoteToolSource[] | undefined,
): boolean {
  return remoteTools?.some((source) => source.id === VERYFRONT_API_MCP_SOURCE_ID) ??
    false;
}

function createStaticRemoteToolSource(
  source: RemoteToolSource,
  toolDefinitions: ToolDefinition[],
): RemoteToolSource {
  return {
    id: source.id,
    listTools: async () => toolDefinitions,
    executeTool: (toolName, args, context) => source.executeTool(toolName, args, context),
  };
}

/**
 * Environment label bound to one agent source.
 *
 * A bare release carries no authoritative environment identity, so it is
 * evaluated under the `release` label against an empty environment and never
 * inherits production secrets by convention.
 */
function buildAgentSourceEnvironmentName(sourceContext: RuntimeAgentSourceContext): string {
  switch (sourceContext.type) {
    case "branch":
      return "preview";
    case "environment":
      return sourceContext.environmentName;
    case "release":
      return "release";
  }
}

/**
 * Load the project environment this agent source may read.
 *
 * Branch and bare-release sources do not carry an authoritative environment
 * identity, so they receive no project environment variables. Named sources
 * must carry an exact signed environment target, which is revalidated against
 * project metadata before any secrets are fetched.
 * Main-branch runs may omit a target environment pin and use the request-scoped
 * production fallback path.
 */
async function resolveAgentSourceEnvironment(
  ctx: HandlerContext,
  sourceContext: RuntimeAgentSourceContext,
  targetIdentity: AgentSourceTargetIdentity,
  apiAuthToken: string,
  signal?: AbortSignal,
): Promise<Record<string, string>> {
  if (sourceContext.type !== "environment") return {};
  if (!ctx.projectSlug) {
    throw INVALID_ARGUMENT.create({
      detail: "Agent source environment requires a canonical project identity",
    });
  }
  if (
    targetIdentity.runtimeTargetKind !== "environment" ||
    !targetIdentity.runtimeTargetEnvironmentId ||
    targetIdentity.runtimeTargetBranchId
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Named agent source requires an exact signed environment target",
    });
  }

  const environmentId = await _environmentIdentityResolver.resolveNamedForActiveRelease(
    {
      apiBaseUrl: resolveVeryfrontApiBaseUrlFromHostEnv(),
      projectSlug: ctx.projectSlug,
      projectId: ctx.projectId,
      token: apiAuthToken,
      environmentName: sourceContext.environmentName,
      expectedEnvironmentId: targetIdentity.runtimeTargetEnvironmentId,
      expectedReleaseId: sourceContext.releaseId,
    },
    signal,
  );

  return await _agentEnvVarCache.get({
    environmentId,
    token: apiAuthToken,
    projectSlug: ctx.projectSlug,
    projectId: ctx.projectId,
  });
}

/**
 * Load config for an exact agent source.
 *
 * This runs only on a shared multi-project runtime (see
 * {@link AgentStreamHandler.withAgentSourceContext}), so the source is
 * untrusted and is evaluated declaratively, bound to the same source and
 * environment the run itself will use.
 */
async function resolveAgentSourceConfig(
  ctx: HandlerContext,
  sourceContext: RuntimeAgentSourceContext,
  environment: Record<string, string>,
): Promise<VeryfrontConfig> {
  const cacheKey = ctx.projectId ?? ctx.projectSlug;
  if (!cacheKey) {
    throw new Error("Explicit agent source requires a project identity");
  }
  await refreshAgentSourceSnapshot(
    ctx.adapter.fs as SourceContextFsWrapper,
    "agent-source-config",
  );
  return await getHostedConfig(ctx.projectDir, ctx.adapter, {
    cacheKey,
    sourceContext: buildAgentSourceRunOptions(sourceContext),
    preparedContext: await prepareDeclarativeConfigContext({
      environmentName: buildAgentSourceEnvironmentName(sourceContext),
      environment,
    }),
    validationBoundary: (validate) =>
      runWithoutRequestContext(withoutVerifiedCacheApiCredential(validate)),
  });
}

async function withVeryfrontPlatformRemoteTools(input: {
  agent: Agent;
  token?: string | null;
  projectId?: string | null;
  availableToolNames?: string[];
}): Promise<Agent> {
  const veryfrontApiMcpPolicy = getVeryfrontApiMcpPolicy(input.agent);
  const implicitlyRequestedToolNames = input.agent.config.mcpServers === undefined
    ? getRequestedUnresolvedBooleanToolNames({
      tools: input.agent.config.tools,
      agentId: input.agent.id,
      availableToolNames: input.availableToolNames,
    })
    : [];
  const requestedToolNames = implicitlyRequestedToolNames.concat(
    veryfrontApiMcpPolicy.requestedToolNames,
  );
  if (
    (!veryfrontApiMcpPolicy.allowAll && requestedToolNames.length === 0) ||
    !input.token ||
    !input.projectId
  ) {
    return input.agent;
  }

  const apiUrl = resolveVeryfrontApiBaseUrlFromHostEnv();
  const platformRemoteToolSource = createRemoteMCPToolSource({
    id: VERYFRONT_API_MCP_SOURCE_ID,
    endpoint: `${apiUrl}/mcp`,
    headers: { Authorization: `Bearer ${input.token}` },
  });
  let platformToolDefinitions: ToolDefinition[] | null = null;
  try {
    platformToolDefinitions = await platformRemoteToolSource.listTools({
      ...(input.projectId ? { projectId: input.projectId } : {}),
    });
  } catch (error) {
    logger.warn("Unable to discover Veryfront platform MCP tools", {
      projectId: input.projectId ?? undefined,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (!platformToolDefinitions) {
    return input.agent;
  }

  const platformToolNames = new Set(platformToolDefinitions.map((tool) => tool.name));
  const requestedPlatformToolNames =
    (veryfrontApiMcpPolicy.allowAll ? [...platformToolNames] : requestedToolNames).filter((
      toolName,
    ) => platformToolNames.has(toolName) && !veryfrontApiMcpPolicy.deniedToolNames.has(toolName));
  if (requestedPlatformToolNames.length === 0) {
    return input.agent;
  }

  const runtimeRemoteToolConfig = input.agent.config as Agent["config"] & RuntimeRemoteToolConfig;
  const remoteTools = runtimeRemoteToolConfig.__vfRemoteToolSources ?? [];
  const platformRemoteToolSources = hasVeryfrontPlatformRemoteToolSource(remoteTools) ? [] : [
    bindRemoteToolSourceToProject(
      createStaticRemoteToolSource(platformRemoteToolSource, platformToolDefinitions),
      input.projectId,
    ),
  ];

  const runtimeConfig: Agent["config"] & RuntimeRemoteToolConfig = {
    ...input.agent.config,
    __vfAllowedRemoteTools: mergeAllowedRemoteTools(
      runtimeRemoteToolConfig.__vfAllowedRemoteTools,
      requestedPlatformToolNames,
    ),
    __vfRemoteToolSources: [...remoteTools, ...platformRemoteToolSources],
  };

  return {
    ...input.agent,
    config: runtimeConfig,
  };
}

function isExplicitStudioMcpServer(
  server: AgentMcpServerConfig,
): server is AgentMcpServerConfig & AgentServiceVeryfrontStudioMcpServerConfig {
  return server.kind === "veryfront-studio";
}

async function withExplicitVeryfrontStudioRemoteTools(input: {
  agent: Agent;
  token?: string | null;
  projectId?: string | null;
  forwardedProps?: Record<string, unknown>;
  conversationId?: string;
  availableToolNames?: string[];
}): Promise<Agent> {
  const configuredServers = input.agent.config.mcpServers?.filter(isExplicitStudioMcpServer) ?? [];
  if (configuredServers.length === 0) return input.agent;

  const clientProfile = resolveRuntimeClientProfile(input.forwardedProps);
  if (!clientAllowsStudioMcp(clientProfile)) {
    throw PERMISSION_DENIED.create({
      detail: "Studio MCP tools require an authorized Studio client profile.",
    });
  }
  if (!input.token) {
    throw AUTHENTICATION_REQUIRED.create({
      detail: "Studio MCP tools require a request-scoped API token.",
    });
  }

  let requestedStudioToolNames = getRequestedUnresolvedBooleanToolNames({
    tools: input.agent.config.tools,
    agentId: input.agent.id,
    availableToolNames: input.availableToolNames,
  }).filter((toolName) =>
    configuredServers.some((server) => createMcpToolPolicyGate(server.toolPolicy).allows(toolName))
  );

  const studioMcpUrl = getHostEnv("VERYFRONT_STUDIO_MCP_URL")?.trim();
  if (!studioMcpUrl) return input.agent;

  const runtimeConfig = input.agent.config as Agent["config"] & RuntimeRemoteToolConfig;
  const remoteTools = runtimeConfig.__vfRemoteToolSources ?? [];
  const studioRemoteToolSources: RemoteToolSource[] = [];
  const broadStudioToolNames = new Set<string>();
  const resolvedStudioSources: Array<{
    policy: ReturnType<typeof createMcpToolPolicyGate>;
    remoteConfig: NonNullable<ReturnType<typeof createAgentServiceRemoteMcpConfig>>;
    source: RemoteToolSource;
  }> = [];
  for (const server of configuredServers) {
    const remoteConfig = createAgentServiceRemoteMcpConfig({
      server,
      authToken: input.token,
      apiMcpUrl: "",
      studioMcpUrl,
      clientProfile,
      getProjectId: () => input.projectId ?? null,
      conversationId: input.conversationId,
      defaultSourceId: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    });
    if (!remoteConfig) continue;
    resolvedStudioSources.push({
      policy: createMcpToolPolicyGate(server.toolPolicy),
      remoteConfig,
      source: createRemoteMCPToolSource(remoteConfig),
    });
  }
  if (resolvedStudioSources.length === 0) return input.agent;

  if (input.agent.config.tools === true) {
    const discoveries = resolvedStudioSources.map(async ({ source }) => {
      try {
        return await source.listTools({
          ...(input.projectId ? { projectId: input.projectId } : {}),
        });
      } catch (error) {
        logger.warn("Unable to discover Veryfront Studio MCP tools", {
          projectId: input.projectId ?? undefined,
          error: error instanceof Error ? error.message : String(error),
        });
        return [];
      }
    });
    const definitionsBySource = await Promise.all(discoveries);
    for (let index = 0; index < resolvedStudioSources.length; index++) {
      const policy = resolvedStudioSources[index]!.policy;
      const definitions = definitionsBySource[index]!;
      for (const definition of definitions) {
        if (policy.allows(definition.name)) broadStudioToolNames.add(definition.name);
      }
    }
  }

  for (const { remoteConfig, source } of resolvedStudioSources) {
    if (
      !remoteTools.some((source) => source.id === remoteConfig.id) &&
      !studioRemoteToolSources.some((source) => source.id === remoteConfig.id)
    ) {
      studioRemoteToolSources.push(source);
    }
  }
  if (input.agent.config.tools === true) {
    requestedStudioToolNames = [...broadStudioToolNames].sort(compareStrings);
  }

  const shouldSetAllowedRemoteTools = requestedStudioToolNames.length > 0 ||
    runtimeConfig.__vfAllowedRemoteTools !== undefined || input.agent.config.tools === true;

  return {
    ...input.agent,
    config: {
      ...input.agent.config,
      ...(shouldSetAllowedRemoteTools
        ? {
          __vfAllowedRemoteTools: mergeAllowedRemoteTools(
            runtimeConfig.__vfAllowedRemoteTools,
            requestedStudioToolNames,
          ),
        }
        : {}),
      __vfRemoteToolSources: [...remoteTools, ...studioRemoteToolSources],
    } as Agent["config"],
  };
}

function buildAgentStreamEnv(input: {
  envVars: Record<string, string>;
  proxyToken?: string | null;
  projectSlug?: string | null;
}): Record<string, string> {
  const apiUrl = resolveVeryfrontApiBaseUrlFromHostEnv();
  return {
    ...filterRuntimeProjectEnv(input.envVars),
    // Framework-owned values must override project env to keep request-scoped
    // credentials bound to trusted Veryfront endpoints and the current project.
    ...(input.proxyToken ? { VERYFRONT_API_TOKEN: input.proxyToken } : {}),
    VERYFRONT_API_URL: apiUrl,
    ...(input.projectSlug ? { VERYFRONT_PROJECT_SLUG: input.projectSlug } : {}),
  };
}

type SourceContextFsWrapper = {
  isMultiProjectMode?: () => boolean;
  runWithContext?: <R>(
    slug: string,
    token: string,
    fn: () => Promise<R>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ) => Promise<R>;
  ensureSourceSnapshotFresh?: (
    reason?: string,
    options?: SourceSnapshotFreshnessOptions,
  ) => Promise<void>;
  sourceSnapshotFreshnessOptionsVersion?: 1;
  refreshSourceSnapshot?: (reason?: string) => Promise<void>;
  getSourceSnapshotFingerprint?: () =>
    | string
    | undefined
    | Promise<string | undefined>;
};

async function refreshAgentSourceSnapshot(
  fs: SourceContextFsWrapper,
  reason: string,
): Promise<boolean> {
  const ensureSourceSnapshotFresh = fs.ensureSourceSnapshotFresh;
  if (typeof ensureSourceSnapshotFresh === "function") {
    if (fs.sourceSnapshotFreshnessOptionsVersion === 1) {
      await IntrinsicReflectApply(ensureSourceSnapshotFresh, fs, [reason, { maxAgeMs: 0 }]);
      return true;
    }
    const refreshSourceSnapshot = fs.refreshSourceSnapshot;
    if (typeof refreshSourceSnapshot === "function") {
      await IntrinsicReflectApply(refreshSourceSnapshot, fs, [reason]);
      return true;
    }
    return false;
  }
  const refreshSourceSnapshot = fs.refreshSourceSnapshot;
  if (typeof refreshSourceSnapshot !== "function") return false;
  await IntrinsicReflectApply(refreshSourceSnapshot, fs, [reason]);
  return true;
}

function isPrototypeInstance(
  prototype: FSAdapterWrapper | MultiProjectFSAdapter,
  value: unknown,
): boolean {
  return typeof value === "object" && value !== null &&
    IntrinsicReflectApply(ObjectPrototypeIsPrototypeOf, prototype, [value]) as boolean;
}

function runWithCapturedSourceContext<T>(
  fsWrapper: SourceContextFsWrapper,
  projectSlug: string,
  token: string,
  fn: () => Promise<T>,
  projectId: string | undefined,
  options: ReturnType<typeof buildAgentSourceRunOptions>,
): Promise<T> {
  const args = [projectSlug, token, fn, projectId, options] as const;

  if (isPrototypeInstance(FSAdapterWrapperPrototype, fsWrapper)) {
    return IntrinsicReflectApply(
      FSAdapterWrapperRunWithContext,
      fsWrapper,
      args,
    ) as Promise<T>;
  }

  if (isPrototypeInstance(MultiProjectFSAdapterPrototype, fsWrapper)) {
    return IntrinsicReflectApply(
      MultiProjectFSAdapterRunWithContext,
      fsWrapper,
      args,
    ) as Promise<T>;
  }

  const isMultiProjectMode = fsWrapper.isMultiProjectMode;
  const runWithContext = fsWrapper.runWithContext;
  if (
    typeof isMultiProjectMode !== "function" ||
    IntrinsicReflectApply(isMultiProjectMode, fsWrapper, []) !== true ||
    typeof runWithContext !== "function"
  ) {
    throw INVALID_ARGUMENT.create({
      detail: "Alternate agent source requires a multi-project runtime context",
    });
  }
  return IntrinsicReflectApply(runWithContext, fsWrapper, args) as Promise<T>;
}

async function requireAgentSourceSnapshotFingerprint(
  ctx: HandlerContext,
  reason: string,
): Promise<string> {
  const fs = ctx.adapter.fs as SourceContextFsWrapper;
  const getSourceSnapshotFingerprint = fs.getSourceSnapshotFingerprint;
  if (
    typeof getSourceSnapshotFingerprint !== "function" ||
    !await refreshAgentSourceSnapshot(fs, reason)
  ) {
    throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
      detail: "The project filesystem cannot verify the branch source snapshot identity",
    });
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const fingerprint = await IntrinsicReflectApply(getSourceSnapshotFingerprint, fs, []);
    if (fingerprint) return fingerprint;
  }
  throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
    detail: "The project filesystem did not provide a branch source snapshot identity",
  });
}

function assertAgentSourceMatchesHostedTarget(
  ctx: HandlerContext,
  payload: InternalAgentStreamRequest,
): void {
  const fsWrapper = ctx.adapter.fs as SourceContextFsWrapper;
  if (!fsWrapper.isMultiProjectMode?.()) return;
  if (payload.runtimeTargetKind === "preview_branch") {
    if (
      payload.agentSource.type !== "branch" ||
      !ctx.branchId ||
      !ctx.branchName ||
      payload.runtimeTargetBranchId !== ctx.branchId ||
      payload.agentSource.branch !== ctx.branchName
    ) {
      throw PERMISSION_DENIED.create({
        detail: "Signed agent source does not match the trusted preview branch target",
      });
    }
    return;
  }

  if (
    payload.runtimeTargetKind === "main_branch" &&
    payload.agentSource.type === "branch" &&
    (!ctx.defaultBranchName || payload.agentSource.branch !== ctx.defaultBranchName)
  ) {
    throw PERMISSION_DENIED.create({
      detail: "Signed agent source does not match the trusted default branch target",
    });
  }
}

function buildAgentSourceRunOptions(sourceContext: RuntimeAgentSourceContext): {
  productionMode: boolean;
  releaseId?: string | null;
  branch?: string | null;
  environmentName?: string | null;
} {
  switch (sourceContext.type) {
    case "branch":
      return {
        productionMode: false,
        branch: sourceContext.branch,
      };
    case "environment":
      return {
        productionMode: true,
        environmentName: sourceContext.environmentName,
        releaseId: sourceContext.releaseId,
      };
    case "release":
      return {
        productionMode: true,
        releaseId: sourceContext.releaseId,
      };
  }
}

function applyBuilderHeaders(target: Response, source: Headers): Response {
  const headers = new Headers(target.headers);
  for (const [key, value] of source.entries()) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }

  return new Response(target.body, {
    status: target.status,
    statusText: target.statusText,
    headers,
  });
}

function setResponseHeader(target: Response, key: string, value: string): Response {
  const headers = new Headers(target.headers);
  headers.set(key, value);
  return new Response(target.body, {
    status: target.status,
    statusText: target.statusText,
    headers,
  });
}

function parseAgentStreamPayload(rawPayload: unknown): InternalAgentStreamRequest {
  const internalAgentStreamRequestSchema = getInternalAgentStreamRequestSchema();
  const invocation = RuntimeAgentRunInvocationSchema.parse(rawPayload);
  return internalAgentStreamRequestSchema.parse(
    buildRuntimeAgentControlPlaneStreamRequestFromInvocation(invocation),
  );
}

function getPathRunId(pathname: string): string | null {
  const match = RUN_STREAM_PATH_REGEX.exec(pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

/** getPathRunId decodes, which throws on a malformed escape; reporting must not. */
function safeRunId(req: Request): string | null {
  try {
    return getPathRunId(new URL(req.url).pathname);
  } catch {
    return null;
  }
}

export class AgentStreamHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AgentStreamHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [
      { pattern: RUN_STREAM_PATH_REGEX, method: "POST" },
    ],
  };

  constructor(private readonly deps: AgentStreamHandlerDeps = defaultDeps) {
    super();
  }

  private withAgentSourceContext<T>(
    ctx: HandlerContext,
    sourceContext: RuntimeAgentSourceContext,
    fn: () => Promise<T>,
  ): Promise<T> {
    const fsWrapper = ctx.adapter.fs as SourceContextFsWrapper;
    if (!ctx.projectSlug) {
      throw INVALID_ARGUMENT.create({
        detail: "Alternate agent source requires a multi-project runtime context",
      });
    }

    const token = ctx.proxyToken || "";
    return runWithCapturedSourceContext(
      fsWrapper,
      ctx.projectSlug,
      token,
      fn,
      ctx.projectId,
      buildAgentSourceRunOptions(sourceContext),
    );
  }

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    if (!this.shouldHandle(req, ctx)) {
      return this.continue();
    }

    // Lame-duck: reject NEW agent streams during graceful shutdown before any
    // control-plane verification, discovery, or runtime-owner resolution, so the
    // API gets a clean pre-side-effect failure (without the runtime-owner header
    // that would otherwise re-pin the run to this terminating pod) and can retry
    // against another instance. In-flight streams are unaffected.
    if (isServerShuttingDown()) {
      return this.respond(buildRuntimeShuttingDownResponse(this.createResponseBuilder(ctx)));
    }

    const builder = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req);

    try {
      const pathRunId = getPathRunId(new URL(req.url).pathname);
      const rawBody = await readInternalAgentRequestBody(
        req,
        INTERNAL_AGENT_STREAM_MAX_BODY_BYTES,
      );
      const payload = parseAgentStreamPayload(JSON.parse(rawBody));
      if (!pathRunId || pathRunId !== payload.runId) {
        return this.respond(builder.json({ error: "CONTROL_PLANE_RUN_ID_MISMATCH" }, 400));
      }
      const verifiedClaims = await verifyControlPlaneRequest(req, ctx, rawBody, {
        expectedSubject: payload.runId,
        expectedSurface: "studio",
      });
      const runEventAppendToken = req.headers.get(RUN_EVENT_APPEND_TOKEN_HEADER);
      assertAgentSourceMatchesHostedTarget(ctx, payload);
      const apiAuthToken = payload.credentials?.authToken || ctx.proxyToken || "";
      if (payload.agentSource.type === "environment" && !apiAuthToken) {
        throw AUTHENTICATION_REQUIRED.create({
          detail: "Named agent source environment requires a request-scoped API token",
        });
      }
      // Keep request-scoped user credentials within framework-owned API calls.
      // Project code and sandbox-backed tools may only receive the runtime's
      // existing project credential, never the credential supplied by the user.
      // The process host token is never combined with request-selected tenant
      // identity, so it is not a fallback here either.
      const projectRuntimeToken = ctx.proxyToken || "";
      const requestScopedContext: HandlerContext = {
        ...ctx,
        proxyToken: apiAuthToken || undefined,
        // The signed invocation is authoritative. Never promote an unrelated
        // request header into the environment used for hosted evaluation.
        environmentId: payload.runtimeTargetEnvironmentId ?? undefined,
        requestContext: ctx.requestContext
          ? { ...ctx.requestContext, token: apiAuthToken }
          : ctx.requestContext,
      };
      logger.info("Accepted internal agent stream request", {
        runId: payload.runId,
        threadId: payload.threadId,
        agentId: payload.agentId,
        projectId: requestScopedContext.projectId,
        projectSlug: requestScopedContext.projectSlug,
        messageCount: payload.messages.length,
        toolCount: payload.tools.length,
        agentSourceType: payload.agentSource.type,
        hasAgentConfig: Boolean(payload.agentConfig),
      });

      const runWithAgentSourceContext = () =>
        this.withAgentSourceContext(
          requestScopedContext,
          payload.agentSource,
          () =>
            runWithVerifiedCacheApiCredential(verifiedClaims, async () => {
              // Resolved before the config load because hosted evaluation binds
              // config to the same environment the run will execute with.
              const envVarsForAgent = await (
                this.deps.loadAgentSourceEnvironment ?? resolveAgentSourceEnvironment
              )(
                requestScopedContext,
                payload.agentSource,
                {
                  runtimeTargetKind: payload.runtimeTargetKind,
                  runtimeTargetEnvironmentId: payload.runtimeTargetEnvironmentId,
                  runtimeTargetBranchId: payload.runtimeTargetBranchId,
                },
                apiAuthToken,
                req.signal,
              );
              const requestSourceFingerprint = payload.agentSource.type === "branch"
                ? await requireAgentSourceSnapshotFingerprint(
                  requestScopedContext,
                  "agent-source-config-start",
                )
                : undefined;
              const sourceConfig = await resolveAgentSourceConfig(
                requestScopedContext,
                payload.agentSource,
                envVarsForAgent,
              );
              if (requestSourceFingerprint !== undefined) {
                const configSourceFingerprint = await requireAgentSourceSnapshotFingerprint(
                  requestScopedContext,
                  "agent-source-config-identity",
                );
                if (configSourceFingerprint !== requestSourceFingerprint) {
                  throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
                    detail: "The branch source changed while its agent configuration was evaluated",
                  });
                }
              }
              const sourceScopedContext: HandlerContext = {
                ...requestScopedContext,
                config: sourceConfig,
              };
              // Source selection and config loading are framework-owned and may
              // use the signed user credential. Re-enter the same source with the
              // runtime credential before discovery or any project-authored agent
              // code can execute.
              const projectScopedContext: HandlerContext = {
                ...sourceScopedContext,
                proxyToken: projectRuntimeToken || undefined,
                requestContext: sourceScopedContext.requestContext
                  ? { ...sourceScopedContext.requestContext, token: projectRuntimeToken }
                  : sourceScopedContext.requestContext,
              };
              return await withoutVerifiedCacheApiCredential(() =>
                this.withAgentSourceContext(
                  projectScopedContext,
                  payload.agentSource,
                  async () => {
                    const sourceIntegrationPolicy = (
                      this.deps.normalizeSourceIntegrationPolicy ?? normalizeSourceIntegrationPolicy
                    )(sourceConfig.integrations);
                    if (requestSourceFingerprint !== undefined) {
                      const runtimeSourceFingerprint = await requireAgentSourceSnapshotFingerprint(
                        projectScopedContext,
                        "agent-source-credential-handoff",
                      );
                      if (runtimeSourceFingerprint !== requestSourceFingerprint) {
                        throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
                          detail:
                            "The branch source changed while credentials were isolated for agent execution",
                        });
                      }
                    }

                    return await runWithExactSourceIntegrationPolicy(
                      sourceIntegrationPolicy,
                      async () => {
                        await this.deps.ensureProjectDiscovery(projectScopedContext);
                        if (requestSourceFingerprint !== undefined) {
                          const discoverySourceFingerprint =
                            await requireAgentSourceSnapshotFingerprint(
                              projectScopedContext,
                              "agent-source-discovery-identity",
                            );
                          if (discoverySourceFingerprint !== requestSourceFingerprint) {
                            throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
                              detail:
                                "The branch source changed while project agents were discovered",
                            });
                          }
                        }

                        const agent = this.deps.getAgent(payload.agentId);
                        if (!agent) {
                          logger.warn("Internal agent stream request referenced unknown agent", {
                            runId: payload.runId,
                            agentId: payload.agentId,
                            projectId: projectScopedContext.projectId,
                            projectSlug: projectScopedContext.projectSlug,
                          });
                          return this.respond(builder.json({ error: "Agent not found" }, 404));
                        }

                        // veryfront-api is the trusted control-plane caller; it resolves
                        // authorization before attaching request-scoped project-agent config.
                        const runtimeBaseAgent = payload.agentConfig
                          ? createRuntimeAgentFromMarkdownDefinition(payload.agentConfig)
                          : agent;
                        const runtimeInput = sanitizeRuntimeRunAgentInput(
                          toRuntimeRunAgentInput(payload),
                          runtimeBaseAgent as Agent,
                        );
                        const providerReplayCheckpoints =
                          getServerResolvedProviderReplayCheckpoints({
                            forwardedProps: runtimeInput.forwardedProps,
                            ...(runtimeInput.serverResolvedProviderReplayCheckpoints !== undefined
                              ? {
                                serverResolvedProviderReplayCheckpoints:
                                  runtimeInput.serverResolvedProviderReplayCheckpoints,
                              }
                              : {}),
                            serverEnvelopeVerified: true,
                          });
                        const veryfrontApiUrl = resolveVeryfrontApiBaseUrlFromHostEnv();
                        const persistProviderReplayCheckpoint = this.deps
                          .createRunScopedProviderReplayCheckpointPersister?.({
                            apiUrl: veryfrontApiUrl,
                            runId: runtimeInput.runId,
                            runEventAppendToken,
                          });
                        const localTools = this.deps.getLocalTools?.(runtimeBaseAgent.id);
                        const platformRuntimeAgent = await withVeryfrontPlatformRemoteTools({
                          agent: runtimeBaseAgent as Agent,
                          token: projectRuntimeToken || null,
                          projectId: projectScopedContext.projectId ?? null,
                          availableToolNames: runtimeInput.tools.map((tool) => tool.name),
                        });
                        const runtimeAgent = await withExplicitVeryfrontStudioRemoteTools({
                          agent: platformRuntimeAgent,
                          token: projectRuntimeToken || null,
                          projectId: projectScopedContext.projectId ?? null,
                          forwardedProps: runtimeInput.forwardedProps,
                          availableToolNames: runtimeInput.tools.map((tool) => tool.name),
                          conversationId: runtimeInput.threadId,
                        });

                        // Source-defined MCP tool headers resolve these via
                        // _getProjectEnv(); they are the same variables the source
                        // config was evaluated against.
                        logger.debug("Agent stream env vars loaded", {
                          runId: payload.runId,
                          projectSlug: projectScopedContext.projectSlug,
                          count: Object.keys(envVarsForAgent).length,
                        });

                        // verifyControlPlaneRequest above authenticates the raw envelope before
                        // this verified credential can be bound to the runtime input.
                        const inferenceAuthToken = payload.credentials?.inferenceAuthToken;
                        if (inferenceAuthToken) {
                          registerRuntimeInferenceCredential(runtimeInput, inferenceAuthToken);
                        }
                        const runAgentStream = () =>
                          createRuntimeAgentStreamResponse(runtimeInput, runtimeAgent, {
                            ...this.deps,
                            localTools,
                            providerReplayCheckpoints,
                            persistProviderReplayCheckpoint,
                            projectAgentSandbox: {
                              apiUrl: veryfrontApiUrl,
                              authToken: projectRuntimeToken || undefined,
                              branchId: payload.runtimeTargetBranchId,
                              projectId: projectScopedContext.projectId ?? null,
                            },
                          });
                        const shouldIsolateEnv = apiAuthToken.length > 0;
                        const response = shouldIsolateEnv
                          ? await runWithProjectEnv(
                            buildAgentStreamEnv({
                              envVars: envVarsForAgent,
                              proxyToken: projectRuntimeToken,
                              projectSlug: projectScopedContext.projectSlug,
                            }),
                            runAgentStream,
                          )
                          : await runAgentStream();
                        logger.info("Internal agent stream response created", {
                          runId: payload.runId,
                          threadId: payload.threadId,
                          agentId: payload.agentId,
                          projectId: projectScopedContext.projectId,
                          projectSlug: projectScopedContext.projectSlug,
                        });
                        const runtimeOwnerInvokeUrl =
                          await this.deps.resolveRuntimeOwnerInvokeUrl?.(req) ??
                            null;
                        const responseWithOwner = runtimeOwnerInvokeUrl
                          ? setResponseHeader(
                            response,
                            RUNTIME_OWNER_INVOKE_URL_HEADER,
                            runtimeOwnerInvokeUrl,
                          )
                          : response;
                        return this.respond(
                          applyBuilderHeaders(responseWithOwner, builder.headers),
                        );
                      },
                    );
                  },
                )
              )();
            }),
        );
      return await runWithAgentSourceContext();
    } catch (caught) {
      // The first negative-cache failure owns diagnostics. Replays retain the
      // original error for response construction but must not repeat reports.
      const { error, replayed } = unwrapReplayedProjectEnvironmentFailure(caught);
      if (error instanceof InternalAgentRequestBodyTooLargeError) {
        return this.respond(builder.json({ error: error.message }, error.status));
      }

      if (error instanceof ControlPlaneRequestError) {
        return this.respond(builder.json({ error: error.message }, error.status));
      }

      if (error instanceof SyntaxError) {
        return this.respond(
          builder.json({ error: "Invalid internal agent stream request" }, 400),
        );
      }

      if (error instanceof AgentRunAlreadyExistsError) {
        return this.respond(builder.json({ error: error.message }, 409));
      }

      if (error instanceof Error && error.name === "ZodError") {
        return this.respond(
          builder.json({ error: "Invalid internal agent stream request" }, 400),
        );
      }

      if (isVeryfrontError(error)) {
        const response = errorToResponse(error, new URL(req.url).pathname);
        // errorToResponse strips `detail` from 5xx bodies, so the log and the
        // reported event are the only places it survives.
        if (response.status >= 500 && !replayed) {
          const cause = describeErrorCause(error.cause);
          logger.error("Internal agent stream request failed", {
            projectId: ctx.projectId,
            projectSlug: ctx.projectSlug,
            status: response.status,
            slug: error.slug,
            category: error.category,
            detail: error.detail,
            error: error.message,
            cause,
          });
          reportHandlerFailure(error, {
            boundary: "agent.stream.request",
            method: req.method,
            status: response.status,
            runId: safeRunId(req),
            projectId: ctx.projectId,
            projectSlug: ctx.projectSlug,
            slug: error.slug,
            category: error.category,
            detail: error.detail,
            cause,
          });
        }
        return this.respond(applyBuilderHeaders(response, builder.headers));
      }

      if (!replayed) {
        this.logWarn("Internal agent stream request failed", {
          error: error instanceof Error ? error.message : String(error),
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
        });
        logger.error("Internal agent stream handler failed", {
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
          error: error instanceof Error ? error.message : String(error),
        });
        // Unexpected failures have no slug or detail, so the captured stack is
        // the only real diagnostic.
        reportHandlerFailure(error, {
          boundary: "agent.stream.handler",
          method: req.method,
          status: HTTP_INTERNAL_SERVER_ERROR,
          runId: safeRunId(req),
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
        });
      }
      return this.respond(builder.json({ error: "Internal agent stream failed" }, 500));
    }
  }
}
