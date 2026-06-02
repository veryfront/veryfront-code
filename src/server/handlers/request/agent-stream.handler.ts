import type { Agent } from "#veryfront/agent";
import {
  createRemoteMCPToolSource,
  type RemoteToolSource,
  type ToolDefinition,
  toolRegistry,
} from "#veryfront/tool";
import { defaultChannelInvokeDeps } from "#veryfront/channels/invoke.ts";
import { type RuntimeAgentDiscoveryDeps } from "#veryfront/channels/control-plane.ts";
import {
  createRuntimeAgentStreamResponse,
  type RuntimeAgentStreamExecutionDeps,
} from "#veryfront/internal-agents/run-stream.ts";
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
  toRuntimeRunAgentInput,
} from "#veryfront/internal-agents/schema.ts";
import { BaseHandler } from "../response/base.ts";
import type { HandlerContext, HandlerMetadata, HandlerPriority, HandlerResult } from "../types.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { serverLogger } from "#veryfront/utils";
import {
  EnvironmentVariableCache,
  fetchProjectEnvVars,
  runWithProjectEnv,
} from "../../project-env/index.ts";

export interface AgentStreamHandlerDeps
  extends RuntimeAgentDiscoveryDeps, RuntimeAgentStreamExecutionDeps {
  resolveRuntimeOwnerInvokeUrl?: typeof resolveRuntimeOwnerInvokeUrl;
}

const defaultDeps: AgentStreamHandlerDeps = {
  ...defaultChannelInvokeDeps,
  sessionManager: agentRunSessionManager,
  resolveRuntimeOwnerInvokeUrl,
};
const logger = serverLogger.component("agent-stream-handler");
const RUN_STREAM_PATH_REGEX = /^\/api\/control-plane\/runs\/([^/]+)\/stream$/;
const VERYFRONT_PLATFORM_REMOTE_TOOL_SOURCE_ID = "veryfront-platform-mcp";
const LOCAL_RUNTIME_BOOLEAN_TOOL_NAMES = new Set(["bash"]);

// Per-environment env var cache shared across all agent stream requests (60s TTL)
const _agentEnvVarCache = new EnvironmentVariableCache(
  (environmentId, token, projectSlug) => {
    const apiBaseUrl = getHostEnv("VERYFRONT_API_URL") ?? "https://api.veryfront.com";
    return fetchProjectEnvVars(apiBaseUrl, projectSlug, environmentId, token);
  },
);

// Cache: projectSlug → production environmentId (stable across restarts)
const _productionEnvIdCache = new Map<string, string>();

async function _resolveProductionEnvironmentId(
  projectSlug: string,
  token: string,
): Promise<string | null> {
  const cached = _productionEnvIdCache.get(projectSlug);
  if (cached) return cached;
  const apiBaseUrl = getHostEnv("VERYFRONT_API_URL") ?? "https://api.veryfront.com";
  try {
    const res = await fetch(
      `${apiBaseUrl}/projects/${encodeURIComponent(projectSlug)}/environments`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    if (!res.ok) {
      await res.body?.cancel();
      return null;
    }
    const body = await res.json() as { data?: Array<{ id: string; name?: string }> };
    const env = body.data?.find((e) => e.name === "production") ?? body.data?.[0];
    if (!env?.id) return null;
    _productionEnvIdCache.set(projectSlug, env.id);
    return env.id;
  } catch {
    return null;
  }
}

function getRequestedUnresolvedBooleanToolNames(input: {
  agent: Agent;
  availableToolNames?: string[];
}): string[] {
  const availableToolNames = new Set(input.availableToolNames ?? []);
  const tools = input.agent.config.tools;
  if (!tools || tools === true) {
    return [];
  }

  return Object.entries(tools)
    .filter(([toolName, entry]) =>
      entry === true &&
      !toolRegistry.get(toolName) &&
      !availableToolNames.has(toolName) &&
      !LOCAL_RUNTIME_BOOLEAN_TOOL_NAMES.has(toolName)
    )
    .map(([toolName]) => toolName)
    .sort();
}

function mergeAllowedRemoteTools(
  current: Agent["config"]["allowedRemoteTools"],
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

function hasVeryfrontPlatformRemoteToolSource(
  remoteTools: RemoteToolSource[] | undefined,
): boolean {
  return remoteTools?.some((source) => source.id === VERYFRONT_PLATFORM_REMOTE_TOOL_SOURCE_ID) ??
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

async function withVeryfrontPlatformRemoteTools(input: {
  agent: Agent;
  token?: string | null;
  projectId?: string | null;
  availableToolNames?: string[];
}): Promise<Agent> {
  const requestedToolNames = getRequestedUnresolvedBooleanToolNames({
    agent: input.agent,
    availableToolNames: input.availableToolNames,
  });
  if (requestedToolNames.length === 0 || !input.token) {
    return input.agent;
  }

  const apiUrl = getHostEnv("VERYFRONT_API_URL") ?? "https://api.veryfront.com";
  const platformRemoteToolSource = createRemoteMCPToolSource({
    id: VERYFRONT_PLATFORM_REMOTE_TOOL_SOURCE_ID,
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

  const platformToolNames = platformToolDefinitions
    ? new Set(platformToolDefinitions.map((tool) => tool.name))
    : null;
  const requestedPlatformToolNames = platformToolNames
    ? requestedToolNames.filter((toolName) => platformToolNames.has(toolName))
    : requestedToolNames;
  if (requestedPlatformToolNames.length === 0) {
    return input.agent;
  }

  const remoteTools = input.agent.config.remoteTools ?? [];
  const platformRemoteToolSources = hasVeryfrontPlatformRemoteToolSource(remoteTools) ? [] : [
    platformToolDefinitions
      ? createStaticRemoteToolSource(platformRemoteToolSource, platformToolDefinitions)
      : platformRemoteToolSource,
  ];

  return {
    ...input.agent,
    config: {
      ...input.agent.config,
      allowedRemoteTools: mergeAllowedRemoteTools(
        input.agent.config.allowedRemoteTools,
        requestedPlatformToolNames,
      ),
      remoteTools: [...remoteTools, ...platformRemoteToolSources],
    },
  };
}

function buildAgentStreamEnv(input: {
  envVars: Record<string, string>;
  proxyToken?: string | null;
  projectSlug?: string | null;
}): Record<string, string> {
  const apiUrl = getHostEnv("VERYFRONT_API_URL") ?? "https://api.veryfront.com";
  return {
    ...input.envVars,
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
        releaseId: sourceContext.releaseId ?? null,
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
  const invocation = RuntimeAgentRunInvocationSchema.safeParse(rawPayload);
  if (invocation.success) {
    return internalAgentStreamRequestSchema.parse(
      buildRuntimeAgentControlPlaneStreamRequestFromInvocation(invocation.data),
    );
  }

  return internalAgentStreamRequestSchema.parse(rawPayload);
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

  constructor(private readonly deps: AgentStreamHandlerDeps = defaultDeps) {
    super();
  }

  private withAgentSourceContext<T>(
    ctx: HandlerContext,
    sourceContext: RuntimeAgentSourceContext | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (!sourceContext) {
      return fn();
    }

    const fsWrapper = ctx.adapter.fs as SourceContextFsWrapper;
    if (!ctx.projectSlug || !fsWrapper.isMultiProjectMode?.() || !fsWrapper.runWithContext) {
      throw new Error("Alternate agent source requires a multi-project runtime context");
    }

    const token = ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || "";
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

    return this.withProxyContext(ctx, async () => {
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
        await verifyControlPlaneRequest(req, ctx, rawBody, {
          expectedSubject: payload.runId,
          expectedSurface: "studio",
        });
        logger.info("Accepted internal agent stream request", {
          runId: payload.runId,
          threadId: payload.threadId,
          agentId: payload.agentId,
          projectId: ctx.projectId,
          projectSlug: ctx.projectSlug,
          messageCount: payload.messages.length,
          toolCount: payload.tools.length,
          hasAgentSource: Boolean(payload.agentSource),
        });

        return await this.withAgentSourceContext(
          ctx,
          payload.agentSource,
          async () => {
            await this.deps.ensureProjectDiscovery(ctx);

            const agent = this.deps.getAgent(payload.agentId);
            if (!agent) {
              logger.warn("Internal agent stream request referenced unknown agent", {
                runId: payload.runId,
                agentId: payload.agentId,
                projectId: ctx.projectId,
                projectSlug: ctx.projectSlug,
              });
              return this.respond(builder.json({ error: "Agent not found" }, 404));
            }

            const runtimeInput = toRuntimeRunAgentInput(payload);
            const runtimeAgent = await withVeryfrontPlatformRemoteTools({
              agent: agent as Agent,
              token: ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || null,
              projectId: ctx.projectId ?? null,
              availableToolNames: runtimeInput.tools.map((tool) => tool.name),
            });

            // Load project env vars so source-defined MCP tool headers resolve
            // via _getProjectEnv(). Control-plane requests don't go through the proxy and
            // therefore don't carry x-environment-id, so we discover the production env ID
            // from the API (one fetch per project per server lifetime, then cached).
            let envVarsForAgent: Record<string, string> = {};
            if (ctx.projectSlug && ctx.proxyToken) {
              const environmentId = ctx.environmentId ??
                await _resolveProductionEnvironmentId(ctx.projectSlug, ctx.proxyToken);
              if (environmentId) {
                envVarsForAgent = await _agentEnvVarCache.get(
                  environmentId,
                  ctx.proxyToken,
                  ctx.projectSlug,
                );
                logger.debug("Agent stream env vars loaded", {
                  runId: payload.runId,
                  projectSlug: ctx.projectSlug,
                  environmentId,
                  count: Object.keys(envVarsForAgent).length,
                });
              }
            }

            const runAgentStream = () =>
              createRuntimeAgentStreamResponse(runtimeInput, runtimeAgent, {
                ...this.deps,
                projectAgentSandbox: {
                  apiUrl: getHostEnv("VERYFRONT_API_URL") ?? "https://api.veryfront.com",
                  authToken: ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || undefined,
                  projectId: ctx.projectId ?? null,
                },
              });
            const shouldIsolateEnv = !!ctx.proxyToken;
            const response = shouldIsolateEnv
              ? await runWithProjectEnv(
                buildAgentStreamEnv({
                  envVars: envVarsForAgent,
                  proxyToken: ctx.proxyToken,
                  projectSlug: ctx.projectSlug,
                }),
                runAgentStream,
              )
              : await runAgentStream();
            logger.info("Internal agent stream response created", {
              runId: payload.runId,
              threadId: payload.threadId,
              agentId: payload.agentId,
              projectId: ctx.projectId,
              projectSlug: ctx.projectSlug,
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
    });
  }
}
