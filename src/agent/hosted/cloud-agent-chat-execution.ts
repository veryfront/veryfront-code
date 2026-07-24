/** Chat execution preparation and runtime wiring for the cloud agent service. */
import { createRemoteMCPToolSource, type HostToolSet, sleepTool } from "#veryfront/tool";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  buildAgentRunTraceAttributes,
  buildExecuteToolTraceAttributes,
  buildProjectServiceTraceAttributes,
  buildScheduleTraceAttributes,
} from "./trace-attributes.ts";
import { createHostedFormInputTool } from "./form-input-tool.ts";
import { createHostedWebFetchTool } from "./web-fetch-tool.ts";
import { type HostedChatRuntimeCreationResult } from "./chat-runtime-contract.ts";
import type { HostedConversationRootRunContext } from "../conversation/root-run-lifecycle.ts";
import { type AgentRuntimeMessage } from "../runtime/message-adapter.ts";
import {
  createDefaultHostedChatRuntime,
  type DefaultHostedChatRuntimeCreationOptions,
  type DefaultHostedChatRuntimeTaskContext,
} from "./default-chat-runtime.ts";
import { createHostedRootLocalToolRuntime } from "./root-sandbox-tool-source.ts";
import { createVeryfrontCloudContextSummaryGenerator } from "./context-summary-generator.ts";
import { createDefaultHostedProjectSteeringRefresh } from "./default-project-steering-refresh.ts";
import type { HostedChatContextBudgetOptions } from "./chat-preparation.ts";
import { applyAgentProjectContextChange } from "../project/context.ts";
import { runWithProjectAgentRuntime } from "../project/agent-runtime.ts";
import { buildVeryfrontCloudRuntimeInstructions } from "./cloud-runtime-system-messages.ts";
import {
  type AgentServiceRuntimeConfig,
  type CreateAgentServiceRuntimeOptions,
} from "../service/runtime.ts";
import type { AgentServiceServerLifecycle } from "../service/server.ts";
import {
  createAgentServiceRegistrationLifecycle,
  resolveAgentServiceRegistrationInput,
} from "../service/registration.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import type { PreparedHostedChatExecution } from "./prepared-chat-execution.ts";
import {
  runPreparedHostedChatExecutionDetached,
  streamPreparedHostedChatExecutionToAgUiResponse,
} from "./prepared-chat-execution.ts";
import {
  createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions,
} from "./cloud-prepared-chat-execution-runtime.ts";
import { prepareVeryfrontCloudHostedChatExecution } from "./cloud-chat-execution-preparation.ts";
import {
  getDefaultAgentId,
  getProjectAgentRuntime,
  getResolvedAgentConfig,
  type NodeVeryfrontCloudAgentServiceContext,
  resolveAgentConfig,
} from "./cloud-agent-config.ts";
import {
  buildHostedDelegateTools,
  createInvokeAgentTool,
  createLoadSkillTool,
  fetchProjectSteering,
  getDiscoveredHostTools,
  getProjectInstructions,
  getSkillsConfig,
  refreshProjectSkillIds,
  resolveHostedDelegationBinding,
  resolveMcpServers,
  setFilteredTraceAttributes,
} from "./cloud-agent-child-tools.ts";

const DEFAULT_FORWARDED_CONFIG_NAMESPACE = "veryfront";
const DEFAULT_PROJECT_NAVIGATION_TOOL_NAMES = ["studio_open_project"];

/** Full type of a prepared cloud agent chat execution, ready to stream or detach. */
export type NodeVeryfrontCloudAgentServicePreparedExecution = PreparedHostedChatExecution & {
  config: AgentServiceRuntimeConfig;
  agent: HostedChatRuntimeCreationResult["agent"];
  runtimeKind: "framework";
  finalMessages: AgentRuntimeMessage[];
  messages: PreparedHostedChatExecution["messages"];
  rootRunContext: HostedConversationRootRunContext;
};

/** Builds the local tool set for a root chat runtime task context. */
export function buildLocalTools(
  context: NodeVeryfrontCloudAgentServiceContext,
  options: DefaultHostedChatRuntimeCreationOptions,
  taskContext: DefaultHostedChatRuntimeTaskContext,
): HostToolSet {
  const config = context.infrastructure.getConfig();
  const tools: HostToolSet = {
    ...getDiscoveredHostTools({ agentId: taskContext.agentId }),
    form_input: createHostedFormInputTool(taskContext, config.VERYFRONT_API_URL),
    load_skill: createLoadSkillTool(context, taskContext),
    sleep: sleepTool,
    web_fetch: createHostedWebFetchTool(),
  };

  if (options.allowDelegation !== false) {
    const agentConfig = options.liveProjectSteering?.agent;
    const binding = resolveHostedDelegationBinding(agentConfig);
    if (binding.kind === "scoped") {
      Object.assign(
        tools,
        buildHostedDelegateTools(context, {
          delegates: binding.delegateIds,
          selfId: agentConfig?.id ?? taskContext.agentId ?? "veryfront",
          taskContext,
        }),
      );
    } else {
      // Agents authored before declarative delegates retain the legacy hosted
      // child-fork tool. Explicit scoped delegate bindings opt out.
      tools.invoke_agent = createInvokeAgentTool(
        context,
        taskContext,
      );
    }
  }

  return tools;
}

/** Creates the project steering refresh object for the chat runtime. */
export function createProjectSteeringRefresh(context: NodeVeryfrontCloudAgentServiceContext) {
  return createDefaultHostedProjectSteeringRefresh({
    fetchProjectInstructions: (lookup) => getProjectInstructions(context, lookup),
    fetchSkills: (lookup) => getSkillsConfig(context, lookup),
    buildInstructions: buildVeryfrontCloudRuntimeInstructions,
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: DEFAULT_PROJECT_NAVIGATION_TOOL_NAMES,
    },
    logger: context.infrastructure.logger,
  });
}

/** Creates the hosted chat runtime for the given options. */
export function createAgentRuntime(
  context: NodeVeryfrontCloudAgentServiceContext,
  options: DefaultHostedChatRuntimeCreationOptions,
): Promise<HostedChatRuntimeCreationResult> {
  const config = context.infrastructure.getConfig();
  const projectRuntime = getProjectAgentRuntime(context);
  const refreshSystem = createProjectSteeringRefresh(context);
  const localToolRuntime = createHostedRootLocalToolRuntime({
    allowedToolNames: options.allowedTools,
    apiUrl: config.VERYFRONT_API_URL,
    authToken: options.authToken,
    createBashTool: context.options.createBashTool,
    buildBaseTools: (taskContext) => buildLocalTools(context, options, taskContext),
  });

  return createDefaultHostedChatRuntime({
    options,
    sourceIntegrationPolicy: projectRuntime.sourceIntegrationPolicy,
    config: {
      apiUrl: config.VERYFRONT_API_URL,
      apiMcpUrl: config.VERYFRONT_MCP_URL,
      studioMcpUrl: config.VERYFRONT_STUDIO_MCP_URL,
      mcpServers: resolveMcpServers(
        context.options,
        options.liveProjectSteering?.agent,
      ),
    },
    buildLocalTools: localToolRuntime.buildLocalTools,
    cleanup: localToolRuntime.cleanup,
    refreshSystem,
    onSteeringMutation: async ({ mutation, taskContext }) => {
      if (mutation.skillsChanged) {
        // Pass the live task context (not a spread copy) so the refreshed
        // owner-scoped skill ids and source paths actually land on the run.
        await refreshProjectSkillIds(context, taskContext);
      }
    },
    onStudioProjectSwitch: async ({ projectId, taskContext }) => {
      if (!applyAgentProjectContextChange(taskContext, projectId)) {
        return false;
      }

      await refreshProjectSkillIds(context, taskContext);
      return true;
    },
    projectScopedRemoteToolOptions: {
      projectNavigationToolNames: DEFAULT_PROJECT_NAVIGATION_TOOL_NAMES,
    },
    createRemoteToolSource: createRemoteMCPToolSource,
    traceLocalTools: {
      trace: (spanName, operation) => context.infrastructure.tracer.trace(spanName, operation),
      buildAttributes: ({ toolName, toolCallId }) =>
        buildExecuteToolTraceAttributes({
          toolName,
          toolCallId,
        }),
      setAttributes: (attributes) => setFilteredTraceAttributes(context, attributes),
    },
    logger: context.infrastructure.logger,
  });
}

function setPrepareChatExecutionStartAttributes(
  context: NodeVeryfrontCloudAgentServiceContext,
  input: { projectId: string | null; userId: string },
): void {
  const span = context.infrastructure.tracer.scope().active();
  span?.setAttributes({
    "chat.projectId": input.projectId ?? "none",
    "chat.userId": input.userId,
  });
}

function setPrepareChatExecutionResultAttributes(
  context: NodeVeryfrontCloudAgentServiceContext,
  input: {
    conversationId?: string;
    projectId: string | null;
    userId: string;
    agentId: string;
    agentName?: string;
    modelId?: string;
    runId?: string;
    upstreamParentConversationId?: string;
    upstreamParentRunId?: string;
    spawnedFromToolCallId?: string;
    runtimeKind: "framework";
    forwardedProps?: Record<string, unknown>;
    projectServiceTraceAttributes?: ReturnType<typeof buildProjectServiceTraceAttributes>;
  },
): void {
  const scheduleTraceAttributes = buildScheduleTraceAttributes(input.forwardedProps);
  const span = context.infrastructure.tracer.scope().active();
  span?.setAttributes(
    buildAgentRunTraceAttributes({
      operationName: "invoke_agent",
      conversationId: input.conversationId,
      projectId: input.projectId,
      userId: input.userId,
      agentId: input.agentId,
      agentName: input.agentName,
      modelId: input.modelId,
      runId: input.runId,
      parentConversationId: input.upstreamParentConversationId,
      parentRunId: input.upstreamParentRunId,
      toolCallId: input.spawnedFromToolCallId,
      scheduleId: typeof scheduleTraceAttributes["schedule.id"] === "string"
        ? scheduleTraceAttributes["schedule.id"]
        : null,
      scheduleName: typeof scheduleTraceAttributes["schedule.name"] === "string"
        ? scheduleTraceAttributes["schedule.name"]
        : null,
    }),
  );
  span?.setAttributes({
    "agent.runtime.kind": input.runtimeKind,
    ...input.projectServiceTraceAttributes,
    ...scheduleTraceAttributes,
  });
}

function createHostedChatContextBudgetOptions(
  context: NodeVeryfrontCloudAgentServiceContext,
  req: ParsedHostedChatRequest,
  agentConfig: { model?: string },
  abortSignal: AbortSignal,
): HostedChatContextBudgetOptions | undefined {
  const config = context.infrastructure.getConfig();
  if (!config.VERYFRONT_CONTEXT_COMPACTION_ENABLED || !req.durableRootRun) {
    return undefined;
  }

  return {
    tokenBudget: config.VERYFRONT_CONTEXT_COMPACTION_TOKEN_BUDGET,
    reserveTokens: config.VERYFRONT_CONTEXT_COMPACTION_RESERVE_TOKENS,
    recentTailTokens: config.VERYFRONT_CONTEXT_COMPACTION_RECENT_TAIL_TOKENS,
    minimumRecentTurns: config.VERYFRONT_CONTEXT_COMPACTION_MINIMUM_RECENT_TURNS,
    maxSummaryTokens: config.VERYFRONT_CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
    summaryGenerator: createVeryfrontCloudContextSummaryGenerator({
      apiUrl: config.VERYFRONT_API_URL,
      authToken: req.authToken,
      projectSlug: req.projectSlug,
      model: config.VERYFRONT_CONTEXT_COMPACTION_SUMMARY_MODEL ?? agentConfig.model,
      maxOutputTokens: config.VERYFRONT_CONTEXT_COMPACTION_MAX_SUMMARY_TOKENS,
      maxInputTokens: config.VERYFRONT_CONTEXT_COMPACTION_SUMMARY_INPUT_TOKENS,
      abortSignal,
    }),
    logger: {
      debug: (message, metadata) => context.infrastructure.logger.debug(message, metadata),
      error: (message, metadata) => context.infrastructure.logger.error(message, metadata),
    },
  };
}

/** Prepares the chat execution within the project agent runtime scope. */
export async function prepareChatExecutionWithinProjectRuntime(
  context: NodeVeryfrontCloudAgentServiceContext,
  req: ParsedHostedChatRequest,
): Promise<NodeVeryfrontCloudAgentServicePreparedExecution> {
  const {
    userId,
    authToken,
    projectId,
    conversationId,
    upstreamParentConversationId,
    upstreamParentRunId,
    spawnedFromToolCallId,
  } = req;
  const config = context.infrastructure.getConfig();
  const projectServiceTraceAttributes = buildProjectServiceTraceAttributes({
    projectSlug: req.projectSlug,
    readEnv: getEnv,
  });

  setPrepareChatExecutionStartAttributes(context, { projectId, userId });

  const requestedAgentId = req.agentId ?? getDefaultAgentId(context);
  // veryfront-api is the trusted caller for request-scoped project-agent config.
  const agentConfig = req.agentConfig ?? await resolveAgentConfig(context, requestedAgentId);
  const abortController = new AbortController();
  const {
    effectiveMessages,
    rootRunContext,
    runtime: { agent, runtimeKind, modelId, cleanup },
    finalMessages,
  } = await prepareVeryfrontCloudHostedChatExecution({
    request: req,
    agentConfig,
    apiUrl: config.VERYFRONT_API_URL,
    abortSignal: abortController.signal,
    logger: context.infrastructure.logger,
    rootRun: {
      instrumentation: {
        trace: context.trace,
        setTraceAttributes: context.infrastructure.setActiveSpanAttributes,
        debug: (message, metadata) => context.infrastructure.logger.debug(message, metadata),
        warn: (message, metadata) => context.infrastructure.logger.warn(message, metadata),
        error: (message, metadata) => context.infrastructure.logger.error(message, metadata),
      },
    },
    fetchSteering: (steeringInput) => fetchProjectSteering(context, steeringInput),
    buildInstructions: buildVeryfrontCloudRuntimeInstructions,
    contextBudget: createHostedChatContextBudgetOptions(
      context,
      req,
      agentConfig,
      abortController.signal,
    ),
    createRuntime: (creationOptions) =>
      context.trace("chat.createRuntime", () =>
        createAgentRuntime(context, {
          ...creationOptions,
          userId: req.userId,
        })),
  });

  setPrepareChatExecutionResultAttributes(context, {
    conversationId,
    projectId,
    userId,
    agentId: agentConfig.id,
    agentName: agentConfig.name,
    modelId,
    runId: rootRunContext.durableRootRun?.runId,
    upstreamParentConversationId,
    upstreamParentRunId,
    spawnedFromToolCallId,
    runtimeKind,
    forwardedProps: req.forwardedProps,
    projectServiceTraceAttributes,
  });

  return {
    config,
    agent,
    agentId: agentConfig.id,
    runtimeKind,
    modelId,
    cleanup,
    messages: effectiveMessages,
    finalMessages,
    conversationId,
    authToken,
    projectId,
    userId,
    rootRunContext,
    upstreamParentConversationId,
    upstreamParentRunId,
    spawnedFromToolCallId,
    traceAttributes: {
      ...projectServiceTraceAttributes,
      ...buildScheduleTraceAttributes(req.forwardedProps),
    },
  };
}

/** Prepares the chat execution, running within the project agent runtime. */
export async function prepareChatExecution(
  context: NodeVeryfrontCloudAgentServiceContext,
  req: ParsedHostedChatRequest,
): Promise<NodeVeryfrontCloudAgentServicePreparedExecution> {
  return await runWithProjectAgentRuntime(
    getProjectAgentRuntime(context),
    () => prepareChatExecutionWithinProjectRuntime(context, req),
  );
}

/** Creates the prepared execution runtime options for streaming and detached runs. */
export function createPreparedExecutionRuntimeOptions(
  context: NodeVeryfrontCloudAgentServiceContext,
  config: AgentServiceRuntimeConfig,
) {
  return createVeryfrontCloudPreparedHostedChatExecutionRuntimeOptions({
    apiUrl: config.VERYFRONT_API_URL,
    tracer: context.infrastructure.tracer,
    trace: context.trace,
    traceStream: (operation) => context.infrastructure.tracer.trace("chat.stream", operation),
    logger: context.infrastructure.logger,
    setActiveSpanAttributes: context.infrastructure.setActiveSpanAttributes,
  });
}

function resolveAgentServiceRuntimeName(): string {
  if (Reflect.get(globalThis, "Bun")) {
    return "bun";
  }
  if (Reflect.get(globalThis, "Deno")) {
    return "deno";
  }
  return "node";
}

function getAgentServiceVersion(
  context: NodeVeryfrontCloudAgentServiceContext,
): string | undefined {
  return context.options.env?.npm_package_version;
}

/** Creates and starts the control plane registration lifecycle if enabled. */
export async function createControlPlaneRegistrationLifecycle(
  context: NodeVeryfrontCloudAgentServiceContext,
): Promise<AgentServiceServerLifecycle | undefined> {
  const config = context.infrastructure.getConfig();
  const registrationInput = await resolveAgentServiceRegistrationInput({
    config,
    serviceName: context.options.serviceName,
    agentId: getDefaultAgentId(context),
    version: getAgentServiceVersion(context),
    runtime: resolveAgentServiceRuntimeName(),
  });

  if (!registrationInput) {
    return undefined;
  }

  if (!context.options.runtimeSource) {
    throw new Error(
      "runtimeSource is required when agent service control-plane registration is enabled.",
    );
  }

  try {
    const lifecycle = await createAgentServiceRegistrationLifecycle({
      ...registrationInput,
      logger: context.infrastructure.logger,
    });
    return {
      stop: () => lifecycle.stop(),
    };
  } catch (error) {
    if (config.VERYFRONT_AGENT_SERVICE_REGISTRATION === "enabled") {
      throw error;
    }

    context.infrastructure.logger.warn("Agent service registration skipped", {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
}

/** Builds the full CreateAgentServiceRuntimeOptions for the cloud agent service. */
export function createNodeVeryfrontCloudAgentServiceRuntimeOptions(
  context: NodeVeryfrontCloudAgentServiceContext,
): CreateAgentServiceRuntimeOptions<NodeVeryfrontCloudAgentServicePreparedExecution> {
  return {
    serviceName: context.options.serviceName,
    runtimeSource: context.options.runtimeSource,
    forwardedConfigNamespace: context.options.forwardedConfigNamespace ??
      DEFAULT_FORWARDED_CONFIG_NAMESPACE,
    getConfig: context.infrastructure.getConfig,
    getAgentConfig: () => getResolvedAgentConfig(context),
    tracker: context.tracker,
    prepareExecution: (request) => prepareChatExecution(context, request),
    streamExecutionToAgUiResponse: (execution) =>
      streamPreparedHostedChatExecutionToAgUiResponse({
        execution,
        runtime: createPreparedExecutionRuntimeOptions(context, execution.config),
      }),
    startDetachedExecution: ({ execution, abortSignal }) =>
      runPreparedHostedChatExecutionDetached({
        execution: {
          ...execution,
          abortSignal,
        },
        runtime: createPreparedExecutionRuntimeOptions(context, execution.config),
      }),
    cleanupExecution: async ({ execution, runId, conversationId }) => {
      await execution.cleanup().catch((error) => {
        context.infrastructure.logger.error(
          "Detached durable run cleanup failed after duplicate start",
          {
            runId,
            conversationId,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      });
    },
    setActiveSpanAttributes: context.infrastructure.setActiveSpanAttributes,
    trace: context.trace,
    logger: context.infrastructure.logger,
    drainTimeoutMs: context.options.drainTimeoutMs ?? 15_000,
  };
}

/** Public type alias for the prepared execution type. */
export type { NodeVeryfrontCloudAgentServicePreparedExecution as PreparedExecution };
