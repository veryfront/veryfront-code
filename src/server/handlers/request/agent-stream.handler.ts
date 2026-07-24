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
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { buildRuntimeShuttingDownResponse } from "./runtime-shutdown-response.ts";
import { isServerShuttingDown } from "../../shutdown-state.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { getRequestTokenProvenance } from "../../context/request-context.ts";
import { resolveVeryfrontApiBaseUrlFromHostEnv } from "#veryfront/platform/cloud/resolver.ts";
import { serverLogger } from "#veryfront/utils";
import { LRUCacheAdapter } from "#veryfront/utils/cache/stores/memory/lru-cache-adapter.ts";
import {
  EnvironmentVariableCache,
  fetchProjectEnvVars,
  filterRuntimeProjectEnv,
  runWithProjectEnv,
} from "../../project-env/index.ts";
import { getConfig, type VeryfrontConfig } from "#veryfront/config/loader.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";

export interface AgentStreamHandlerDeps
  extends RuntimeAgentDiscoveryDeps, RuntimeAgentStreamExecutionDeps {
  resolveRuntimeOwnerInvokeUrl?: typeof resolveRuntimeOwnerInvokeUrl;
  getLocalTools?: (agentId: string) => RuntimeAgentStreamExecutionDeps["localTools"];
  /** Explicit HTTP capability used only for project environment discovery. */
  projectEnvFetch?: typeof globalThis.fetch;
}

const defaultProjectEnvFetch = globalThis.fetch;
const defaultDeps: AgentStreamHandlerDeps = {
  ...defaultChannelInvokeDeps,
  sessionManager: agentRunSessionManager,
  resolveRuntimeOwnerInvokeUrl,
  projectEnvFetch: defaultProjectEnvFetch,
  getLocalTools: (agentId) =>
    getDiscoveredHostTools({ agentId }) as RuntimeAgentStreamExecutionDeps["localTools"],
};
const logger = serverLogger.component("agent-stream-handler");
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

async function resolveProductionEnvironmentId(
  projectSlug: string,
  token: string,
  cache: LRUCacheAdapter,
  fetchImpl: typeof globalThis.fetch,
): Promise<string | null> {
  const cached = cache.get<string>(projectSlug);
  if (cached) return cached;
  const apiBaseUrl = resolveVeryfrontApiBaseUrlFromHostEnv();
  try {
    const res = await fetchImpl(
      `${apiBaseUrl}/projects/${encodeURIComponent(projectSlug)}/environments`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    if (!res.ok) {
      await res.body?.cancel();
      logger.warn("Unable to resolve production environment for agent stream", {
        projectSlug,
        apiBaseUrl,
        status: res.status,
      });
      return null;
    }
    const body = await res.json() as { data?: Array<{ id: string; name?: string }> };
    const env = body.data?.find((e) => e.name === "production") ?? body.data?.[0];
    if (!env?.id) {
      logger.warn("Production environment missing for agent stream", {
        projectSlug,
        apiBaseUrl,
      });
      return null;
    }
    cache.set(projectSlug, env.id);
    return env.id;
  } catch (error) {
    logger.warn("Unable to resolve production environment for agent stream", {
      projectSlug,
      apiBaseUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

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
  return [...allowed].sort();
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
    .sort();
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

async function resolveAgentSourceConfig(
  ctx: HandlerContext,
  sourceContext: RuntimeAgentSourceContext,
): Promise<VeryfrontConfig> {
  const cacheKey = ctx.projectId ?? ctx.projectSlug;
  if (!cacheKey) {
    throw new Error("Explicit agent source requires a project identity");
  }
  return await getConfig(ctx.projectDir, ctx.adapter, {
    cacheKey,
    sourceContext: buildAgentSourceRunOptions(sourceContext),
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
      tokenProvenance?: "project-bound" | "untrusted";
    },
  ) => Promise<R>;
};

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

export class AgentStreamHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AgentStreamHandler",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
    patterns: [
      { pattern: RUN_STREAM_PATH_REGEX, method: "POST" },
    ],
  };

  private readonly deps: AgentStreamHandlerDeps;
  private readonly projectEnvFetch: typeof globalThis.fetch;
  private readonly agentEnvVarCache: EnvironmentVariableCache;
  private readonly productionEnvIdCache = new LRUCacheAdapter({ maxEntries: 1000 });

  constructor(deps: AgentStreamHandlerDeps = defaultDeps) {
    super();
    this.deps = deps;
    this.projectEnvFetch = deps.projectEnvFetch ?? defaultProjectEnvFetch;
    this.agentEnvVarCache = new EnvironmentVariableCache(
      (environmentId, token, projectSlug, signal) =>
        fetchProjectEnvVars(
          resolveVeryfrontApiBaseUrlFromHostEnv(),
          projectSlug,
          environmentId,
          token,
          { signal, fetch: this.projectEnvFetch },
        ),
    );
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

    const token = ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || "";
    return fsWrapper.runWithContext(
      ctx.projectSlug,
      token,
      fn,
      ctx.projectId,
      {
        ...buildAgentSourceRunOptions(sourceContext),
        tokenProvenance: getRequestTokenProvenance(ctx.requestContext, token),
      },
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
      const apiAuthToken = payload.credentials?.authToken || ctx.proxyToken ||
        getHostEnv("VERYFRONT_API_TOKEN") || "";
      const requestScopedContext: HandlerContext = {
        ...ctx,
        proxyToken: apiAuthToken || undefined,
        requestContext: ctx.requestContext
          ? {
            ...ctx.requestContext,
            token: apiAuthToken,
            tokenProvenance: "untrusted" as const,
          }
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
            const sourceConfig = await resolveAgentSourceConfig(
              requestScopedContext,
              payload.agentSource,
            );
            const sourceScopedContext: HandlerContext = {
              ...requestScopedContext,
              config: sourceConfig,
            };
            const sourceIntegrationPolicy = normalizeSourceIntegrationPolicy(
              sourceConfig.integrations,
            );

            return await runWithExactSourceIntegrationPolicy(
              sourceIntegrationPolicy,
              async () => {
                await this.deps.ensureProjectDiscovery(sourceScopedContext);

                const agent = this.deps.getAgent(payload.agentId);
                if (!agent) {
                  logger.warn("Internal agent stream request referenced unknown agent", {
                    runId: payload.runId,
                    agentId: payload.agentId,
                    projectId: sourceScopedContext.projectId,
                    projectSlug: sourceScopedContext.projectSlug,
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
                  projectId: sourceScopedContext.projectId ?? null,
                  availableToolNames: runtimeInput.tools.map((tool) => tool.name),
                });
                const runtimeAgent = withVeryfrontStudioRemoteTools({
                  agent: platformRuntimeAgent,
                  token: apiAuthToken || null,
                  projectId: sourceScopedContext.projectId ?? null,
                  forwardedProps: runtimeInput.forwardedProps,
                  availableToolNames: runtimeInput.tools.map((tool) => tool.name),
                  conversationId: runtimeInput.threadId,
                });

                // Load project env vars so source-defined MCP tool headers resolve
                // via _getProjectEnv(). Control-plane requests don't go through the proxy and
                // therefore don't carry x-environment-id, so we discover the production env ID
                // from the API (one fetch per project per server lifetime, then cached).
                let envVarsForAgent: Record<string, string> = {};
                if (sourceScopedContext.projectSlug && apiAuthToken) {
                  const environmentId = sourceScopedContext.environmentId ??
                    await resolveProductionEnvironmentId(
                      sourceScopedContext.projectSlug,
                      apiAuthToken,
                      this.productionEnvIdCache,
                      this.projectEnvFetch,
                    );
                  if (environmentId) {
                    envVarsForAgent = await this.agentEnvVarCache.get(
                      environmentId,
                      apiAuthToken,
                      sourceScopedContext.projectSlug,
                    );
                    logger.debug("Agent stream env vars loaded", {
                      runId: payload.runId,
                      projectSlug: sourceScopedContext.projectSlug,
                      environmentId,
                      count: Object.keys(envVarsForAgent).length,
                    });
                  }
                }

                const runAgentStream = () =>
                  createRuntimeAgentStreamResponse(runtimeInput, runtimeAgent, {
                    ...this.deps,
                    localTools,
                    projectAgentSandbox: {
                      apiUrl: resolveVeryfrontApiBaseUrlFromHostEnv(),
                      authToken: apiAuthToken || undefined,
                      branchId: payload.runtimeTargetBranchId,
                      projectId: sourceScopedContext.projectId ?? null,
                    },
                  });
                const shouldIsolateEnv = apiAuthToken.length > 0;
                const response = shouldIsolateEnv
                  ? await runWithProjectEnv(
                    buildAgentStreamEnv({
                      envVars: envVarsForAgent,
                      proxyToken: apiAuthToken,
                      projectSlug: sourceScopedContext.projectSlug,
                    }),
                    runAgentStream,
                  )
                  : await runAgentStream();
                logger.info("Internal agent stream response created", {
                  runId: payload.runId,
                  threadId: payload.threadId,
                  agentId: payload.agentId,
                  projectId: sourceScopedContext.projectId,
                  projectSlug: sourceScopedContext.projectSlug,
                });
                const runtimeOwnerInvokeUrl = await this.deps.resolveRuntimeOwnerInvokeUrl?.(req) ??
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
      return await runWithVerifiedCacheApiCredential(
        verifiedClaims,
        runWithAgentSourceContext,
      );
    } catch (error) {
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
      return this.respond(builder.json({ error: "Internal agent stream failed" }, 500));
    }
  }
}
