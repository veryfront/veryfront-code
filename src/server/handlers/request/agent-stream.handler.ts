import type { Agent } from "#veryfront/agent";
import {
  createRemoteMCPToolSource,
  type RemoteToolSource,
  type ToolDefinition,
} from "#veryfront/tool";
import { defaultChannelInvokeDeps } from "#veryfront/channels/invoke.ts";
import { type RuntimeAgentDiscoveryDeps } from "#veryfront/channels/control-plane.ts";
import { getDiscoveredHostTools } from "#veryfront/agent/hosted/veryfront-cloud-agent-service.ts";
import { runWithVerifiedCacheApiCredential } from "#veryfront/cache/verified-api-credential-context.ts";
import {
  createRuntimeAgentStreamResponse,
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
import { buildStudioMcpHeaders } from "#veryfront/agent/project/live-studio-mcp-tools.ts";
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

export interface AgentStreamHandlerDeps
  extends RuntimeAgentDiscoveryDeps, RuntimeAgentStreamExecutionDeps {
  resolveRuntimeOwnerInvokeUrl?: typeof resolveRuntimeOwnerInvokeUrl;
  getLocalTools?: (agentId: string) => RuntimeAgentStreamExecutionDeps["localTools"];
  loadAgentSourceEnvironment?: AgentSourceEnvironmentLoader;
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
};
const logger = serverLogger.component("agent-stream-handler");

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

function getForwardedAllowedRemoteToolNames(
  forwardedProps: Record<string, unknown> | undefined,
): string[] {
  const runtimeOverrides = isRecord(forwardedProps?.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  const allowedTools = runtimeOverrides?.allowedTools;
  return Array.isArray(allowedTools) &&
      allowedTools.every((toolName) => typeof toolName === "string")
    ? allowedTools
    : [];
}

function getForwardedIntegrationToolNames(
  runtimeOverrides: Record<string, unknown>,
): Set<string> {
  const toolNames = new Set<string>();
  const serverResolvedTools = runtimeOverrides.serverResolvedIntegrationTools;
  if (Array.isArray(serverResolvedTools)) {
    for (const toolName of serverResolvedTools) {
      if (typeof toolName === "string" && toolName.length > 0) {
        toolNames.add(toolName);
      }
    }
  }

  const definitions = runtimeOverrides.integrationToolDefinitions;
  if (Array.isArray(definitions)) {
    for (const definition of definitions) {
      if (
        isRecord(definition) && typeof definition.name === "string" && definition.name.length > 0
      ) {
        toolNames.add(definition.name);
      }
    }
  }

  return toolNames;
}

function getRequestedStudioToolNames(input: {
  forwardedProps?: Record<string, unknown>;
  availableToolNames?: string[];
}): string[] {
  const requestedToolNames = new Set([
    ...getForwardedAllowedRemoteToolNames(input.forwardedProps),
    ...(input.availableToolNames ?? []),
  ]);
  return [...requestedToolNames]
    .filter((toolName) => STUDIO_RUNTIME_REMOTE_TOOL_NAMES.has(toolName))
    .sort(compareStrings);
}

function sanitizeForwardedRuntimeAllowedTools(input: {
  forwardedProps?: Record<string, unknown>;
  availableToolNames: string[];
  allowStudioRuntimeTools: boolean;
}): Record<string, unknown> | undefined {
  const forwardedProps = input.forwardedProps;
  if (!isRecord(forwardedProps)) {
    return forwardedProps;
  }

  const runtimeOverrides = isRecord(forwardedProps.runtimeOverrides)
    ? forwardedProps.runtimeOverrides
    : null;
  if (!runtimeOverrides || !Object.hasOwn(runtimeOverrides, "allowedTools")) {
    return forwardedProps;
  }

  const allowedTools = runtimeOverrides.allowedTools;
  if (
    !Array.isArray(allowedTools) || !allowedTools.every((toolName) => typeof toolName === "string")
  ) {
    return forwardedProps;
  }

  const availableToolNames = new Set(input.availableToolNames);
  const forwardedIntegrationToolNames = getForwardedIntegrationToolNames(runtimeOverrides);
  // Platform remote tools are gated separately by the child agent config in
  // withVeryfrontPlatformRemoteTools. The Studio path is the one that consumes
  // forwarded allowedTools, and Studio-only runtime tools are preserved only
  // for trusted Studio clients that can already attach the Studio MCP surface.
  const sanitizedAllowedTools = allowedTools.filter((toolName) =>
    availableToolNames.has(toolName) ||
    forwardedIntegrationToolNames.has(toolName) ||
    (input.allowStudioRuntimeTools && STUDIO_RUNTIME_REMOTE_TOOL_NAMES.has(toolName))
  );
  if (sanitizedAllowedTools.length === allowedTools.length) {
    return forwardedProps;
  }

  const nextRuntimeOverrides: Record<string, unknown> = {
    ...runtimeOverrides,
    allowedTools: sanitizedAllowedTools,
  };
  if (sanitizedAllowedTools.length === 0) {
    delete nextRuntimeOverrides.allowedTools;
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

function sanitizeRuntimeRunAgentInput(input: RuntimeRunAgentInput): RuntimeRunAgentInput {
  const clientProfile = resolveRuntimeClientProfile(input.forwardedProps);

  return {
    ...input,
    forwardedProps: sanitizeForwardedRuntimeAllowedTools({
      forwardedProps: input.forwardedProps,
      availableToolNames: input.tools.map((tool) => tool.name),
      allowStudioRuntimeTools: clientAllowsStudioMcp(clientProfile),
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

function hasVeryfrontStudioRemoteToolSource(
  remoteTools: RemoteToolSource[] | undefined,
): boolean {
  return remoteTools?.some((source) => source.id === VERYFRONT_STUDIO_MCP_SOURCE_ID) ??
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
  await ctx.adapter.fs.ensureSourceSnapshotFresh?.("agent-source-config");
  return await getHostedConfig(ctx.projectDir, ctx.adapter, {
    cacheKey,
    sourceContext: buildAgentSourceRunOptions(sourceContext),
    preparedContext: await prepareDeclarativeConfigContext({
      environmentName: buildAgentSourceEnvironmentName(sourceContext),
      environment,
    }),
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

function withVeryfrontStudioRemoteTools(input: {
  agent: Agent;
  token?: string | null;
  projectId?: string | null;
  forwardedProps?: Record<string, unknown>;
  availableToolNames?: string[];
  conversationId?: string;
}): Agent {
  const studioMcpUrl = getHostEnv("VERYFRONT_STUDIO_MCP_URL")?.trim();
  const clientProfile = resolveRuntimeClientProfile(input.forwardedProps);
  const requestedStudioToolNames = getRequestedStudioToolNames({
    forwardedProps: input.forwardedProps,
    availableToolNames: input.availableToolNames,
  });
  if (
    input.agent.config.mcpServers !== undefined ||
    !input.token ||
    !studioMcpUrl ||
    !clientAllowsStudioMcp(clientProfile) ||
    requestedStudioToolNames.length === 0
  ) {
    return input.agent;
  }

  const runtimeRemoteToolConfig = input.agent.config as Agent["config"] & RuntimeRemoteToolConfig;
  const remoteTools = runtimeRemoteToolConfig.__vfRemoteToolSources ?? [];
  const studioRemoteToolSources = hasVeryfrontStudioRemoteToolSource(remoteTools) ? [] : [
    createRemoteMCPToolSource({
      id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
      endpoint: studioMcpUrl,
      headers: () =>
        buildStudioMcpHeaders(
          input.token ?? "",
          input.projectId ?? null,
          input.conversationId,
        ),
    }),
  ];

  const runtimeConfig: Agent["config"] & RuntimeRemoteToolConfig = {
    ...input.agent.config,
    __vfAllowedRemoteTools: mergeAllowedRemoteTools(
      runtimeRemoteToolConfig.__vfAllowedRemoteTools,
      requestedStudioToolNames,
    ),
    __vfRemoteToolSources: [...remoteTools, ...studioRemoteToolSources],
  };

  return {
    ...input.agent,
    config: runtimeConfig,
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
  ensureSourceSnapshotFresh?: (reason?: string) => Promise<void>;
  getSourceSnapshotFingerprint?: () =>
    | string
    | undefined
    | Promise<string | undefined>;
};

async function requireAgentSourceSnapshotFingerprint(
  ctx: HandlerContext,
  reason: string,
): Promise<string> {
  const fs = ctx.adapter.fs as SourceContextFsWrapper;
  if (!fs.ensureSourceSnapshotFresh || !fs.getSourceSnapshotFingerprint) {
    throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
      detail: "The project filesystem cannot verify the branch source snapshot identity",
    });
  }

  await fs.ensureSourceSnapshotFresh(reason);
  const fingerprint = await fs.getSourceSnapshotFingerprint();
  if (!fingerprint) {
    throw SOURCE_SNAPSHOT_FRESHNESS_UNAVAILABLE.create({
      detail: "The project filesystem did not provide a branch source snapshot identity",
    });
  }
  return fingerprint;
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
    if (!ctx.projectSlug || !fsWrapper.isMultiProjectMode?.() || !fsWrapper.runWithContext) {
      throw INVALID_ARGUMENT.create({
        detail: "Alternate agent source requires a multi-project runtime context",
      });
    }

    const token = ctx.proxyToken || "";
    return fsWrapper.runWithContext(
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
          async () => {
            // Resolved before the config load because hosted evaluation binds
            // config to the same environment the run will execute with.
            const envVarsForAgent = await (
              this.deps.loadAgentSourceEnvironment ?? resolveAgentSourceEnvironment
            )(
              requestScopedContext,
              payload.agentSource,
              payload,
              apiAuthToken,
              req.signal,
            );
            const sourceConfig = await resolveAgentSourceConfig(
              requestScopedContext,
              payload.agentSource,
              envVarsForAgent,
            );
            const requestSourceFingerprint = payload.agentSource.type === "branch"
              ? await requireAgentSourceSnapshotFingerprint(
                requestScopedContext,
                "agent-source-config-identity",
              )
              : undefined;
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
            const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy(
              sourceConfig.integrations,
            );

            return await this.withAgentSourceContext(
              projectScopedContext,
              payload.agentSource,
              async () => {
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
                    );
                    const localTools = this.deps.getLocalTools?.(runtimeBaseAgent.id);
                    const platformRuntimeAgent = await withVeryfrontPlatformRemoteTools({
                      agent: runtimeBaseAgent as Agent,
                      token: apiAuthToken || null,
                      projectId: projectScopedContext.projectId ?? null,
                      availableToolNames: runtimeInput.tools.map((tool) => tool.name),
                    });
                    const runtimeAgent = withVeryfrontStudioRemoteTools({
                      agent: platformRuntimeAgent,
                      token: apiAuthToken || null,
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

                    const runAgentStream = () =>
                      createRuntimeAgentStreamResponse(runtimeInput, runtimeAgent, {
                        ...this.deps,
                        localTools,
                        projectAgentSandbox: {
                          apiUrl: resolveVeryfrontApiBaseUrlFromHostEnv(),
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
                    return this.respond(applyBuilderHeaders(responseWithOwner, builder.headers));
                  },
                );
              },
            );
          },
        );
      return await runWithVerifiedCacheApiCredential(
        verifiedClaims,
        runWithAgentSourceContext,
      );
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
