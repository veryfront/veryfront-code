import type {
  AgentServiceSandboxToolsOptions,
  AgentServiceSandboxToolsResult,
} from "#veryfront/sandbox";
import { createAgentServiceSandboxTools } from "#veryfront/sandbox";
import {
  createRemoteMCPToolSource,
  createToolsFromRemoteDefinitions,
  type HostToolSet,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  sleepTool,
  type ToolExecutionContext,
} from "#veryfront/tool";
import { defineSchema, lazySchema } from "#veryfront/schemas/index.ts";
import type { InferSchema, SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { buildExecuteToolTraceAttributes } from "./trace-attributes.ts";
import type {
  ChildRunExecutionResult,
  ChildRunExecutionSnapshot,
} from "../child-run/execution-snapshot.ts";
import { isChildRunAbortError, throwIfChildRunAborted } from "../child-run/execution-support.ts";
import type { ConversationRunEvent } from "../conversation/run-events.ts";
import { createConversationChildLifecycleAdapter } from "../conversation/hosted-lifecycle.ts";
import { bootstrapHostedChildRun } from "./child-bootstrap.ts";
import { createHostedChildExecutionLogWriter } from "./child-execution-logging.ts";
import { startHostedChildForkRuntimeWithHostTools } from "./child-fork-runtime-start.ts";
import { prepareDefaultHostedChildForkSandboxToolSources } from "./child-fork-tool-sources.ts";
import type { AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import { executeHostedChildForkToolInput } from "./child-fork-execution-runner.ts";
import { createHostedChildInvokeTool } from "./child-invoke-tool.ts";
import {
  runHostedChildExecutionLifecycle,
  shouldSkipHostedChildTerminalPersistence,
} from "./child-lifecycle.ts";
import { createLiveStudioMcpTools } from "../project/live-studio-mcp-tools.ts";
import {
  applyAgentProjectContextChange,
  type MutableAgentProjectContext,
} from "../project/context.ts";
import {
  buildHostedDurableChildInvokeFailureResult,
  createHostedDurableChildInvokeTraceRecorder,
  executeHostedDurableChildFork,
  executeHostedLocalChildInvoke,
  type HostedDurableChildExecutionOptions,
  type HostedDurableChildInvokeResult,
} from "./durable-child-fork-execution.ts";
import type { HostedChildRunIdentifiers } from "./child-status.ts";
import {
  getHostedChildForkToolInputSchema,
  type HostedChildForkRuntimeConfig,
  type HostedChildForkToolInput,
  withHostedChildInvocationContext,
} from "./child-tool-input.ts";
import type {
  DefaultHostedChildForkToolAssemblyResult,
  DefaultHostedChildForkToolAssemblySourceResult,
} from "./child-requested-tools.ts";
import { prepareDefaultHostedChildForkToolAssembly } from "./child-requested-tools.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";
import type { RuntimeReasoningOption } from "../types.ts";
import { withRootOwnedChildResultHint } from "../conversation/delegation-policy.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import { getRuntimeSourceIntegrationPolicyFromContext } from "../runtime/runtime-tool-config.ts";
import { buildHostedChildForkInstructions } from "./child-fork-instructions.ts";

/** Context for default hosted invoke agent. */
export type DefaultHostedInvokeAgentContext = MutableAgentProjectContext & {
  authToken: string;
  clientProfile?: RuntimeClientProfile | null;
  model?: string;
  conversationId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  publishParentRunEvents?: (events: ConversationRunEvent[]) => Promise<void> | void;
  availableToolNames?: string[];
  steeringRevision?: number;
};

/** Configuration used by default hosted invoke agent. */
export type DefaultHostedInvokeAgentConfig = {
  apiUrl: string;
  apiMcpUrl: string;
  studioMcpUrl?: string | null;
  mcpServers?: readonly AgentServiceMcpServerConfig[];
  enableDurableInvokeAgent?: boolean;
};

/** Resolved project-agent settings applied to a fixed hosted child run. */
export type DefaultHostedChildAgentExecutionConfig = {
  system: string;
  model?: string;
  maxSteps?: number;
  thinking?: HostedChildForkToolInput["thinking"];
  toolNames?: string[];
  mcpServers?: readonly AgentServiceMcpServerConfig[];
  availableSkillIds?: string[];
};

/** Public API contract for default hosted invoke agent logger. */
export type DefaultHostedInvokeAgentLogger = {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

/** Public API contract for default hosted invoke agent trace attributes. */
export type DefaultHostedInvokeAgentTraceAttributes = Record<
  string,
  string | number | boolean | readonly (string | number | boolean)[] | null | undefined
>;

/** Public API contract for default hosted invoke agent trace. */
export type DefaultHostedInvokeAgentTrace = <TResult>(
  operationName: string,
  operation: () => TResult,
) => TResult;

/** Result returned from default hosted invoke agent tool. */
export type DefaultHostedInvokeAgentToolResult =
  | ChildRunExecutionResult
  | HostedDurableChildInvokeResult;

/** Public API contract for default hosted invoke agent project refresh. */
export type DefaultHostedInvokeAgentProjectRefresh<
  TContext extends DefaultHostedInvokeAgentContext,
> = (
  context: TContext,
) => Promise<void> | void;

/** Options accepted by default hosted invoke agent tool. */
export type DefaultHostedInvokeAgentToolOptions<TContext extends DefaultHostedInvokeAgentContext> =
  {
    context: TContext;
    getConfig: () => DefaultHostedInvokeAgentConfig;
    logger: DefaultHostedInvokeAgentLogger;
    trace: DefaultHostedInvokeAgentTrace;
    setTraceAttributes: (attributes: DefaultHostedInvokeAgentTraceAttributes) => void;
    createBashTool: AgentServiceSandboxToolsOptions["createBashTool"];
    resolveModelId: (model: string) => string;
    resolveProvider: (modelId: string) => string;
    resolveProviderOptions?: (
      forkModel: string,
      thinkingConfig: HostedChildForkRuntimeConfig["thinkingConfig"],
    ) => Record<string, unknown> | undefined;
    resolveReasoning?: (
      forkModel: string,
      thinkingConfig: HostedChildForkRuntimeConfig["thinkingConfig"],
    ) => RuntimeReasoningOption | undefined;
    resolveModelThinking?: (modelId: string) => HostedChildForkRuntimeConfig["thinkingConfig"];
    shouldRethrowError?: (error: unknown) => boolean;
    buildGlobalTools?: (
      context: TContext,
      childAgentId: string,
      childConfig?: DefaultHostedChildAgentExecutionConfig,
    ) => HostToolSet;
    resolveChildAgentExecutionConfig?: (
      childAgentId: string,
    ) => Promise<DefaultHostedChildAgentExecutionConfig | undefined>;
    refreshProjectSkillIds?: DefaultHostedInvokeAgentProjectRefresh<TContext>;
    defaultModel?: string;
    defaultMaxSteps?: number;
    resolveChildAgentId?: (input: DefaultHostedInvokeAgentInput) => string;
    createAgentServiceSandboxTools?: (
      input: AgentServiceSandboxToolsOptions,
    ) => Promise<AgentServiceSandboxToolsResult>;
    createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
    createToolsFromRemoteDefinitions?: typeof createToolsFromRemoteDefinitions;
    createLiveStudioTools?: Parameters<typeof prepareDefaultHostedChildForkSandboxToolSources>[0][
      "createLiveStudioTools"
    ];
  };

const defaultHostedInvokeAgentSelectionFields = (v: SchemaValidator) => ({
  agent_id: v.string()
    .min(1, "agent_id is required")
    .regex(/\S/, "agent_id must not be blank")
    .describe("Built-in child agent type or user-defined agent id."),
});

export const getDefaultHostedInvokeAgentSelectionSchema = defineSchema((v) =>
  v.object(defaultHostedInvokeAgentSelectionFields(v))
);

/** Schema for default hosted invoke agent selection.
 * @deprecated Use getDefaultHostedInvokeAgentSelectionSchema()
 */
export const defaultHostedInvokeAgentSelectionSchema = lazySchema(
  getDefaultHostedInvokeAgentSelectionSchema,
);

export const getDefaultHostedInvokeAgentInputSchema = defineSchema((v) =>
  getHostedChildForkToolInputSchema().extend(defaultHostedInvokeAgentSelectionFields(v))
);

/** Schema for default hosted invoke agent input.
 * @deprecated Use getDefaultHostedInvokeAgentInputSchema()
 */
export const defaultHostedInvokeAgentInputSchema = lazySchema(
  getDefaultHostedInvokeAgentInputSchema,
);

/** Input payload for default hosted invoke agent. */
export type DefaultHostedInvokeAgentInput = InferSchema<
  ReturnType<typeof getDefaultHostedInvokeAgentInputSchema>
>;

const DEFAULT_USER_AGENT_MODEL = "opus";
const DEFAULT_USER_AGENT_MAX_STEPS = 80;
const DURABLE_INVOKE_CONTEXT_UNAVAILABLE = "DURABLE_INVOKE_CONTEXT_UNAVAILABLE";
const DURABLE_INVOKE_SETUP_FAILED = "DURABLE_INVOKE_SETUP_FAILED";

function resolveDefaultChildAgentId(input: DefaultHostedInvokeAgentInput): string {
  return input.agent_id.trim();
}

function resolveChildAgentId(
  options: Pick<
    DefaultHostedInvokeAgentToolOptions<DefaultHostedInvokeAgentContext>,
    "resolveChildAgentId"
  >,
  input: DefaultHostedInvokeAgentInput,
): string {
  return options.resolveChildAgentId?.(input) ?? resolveDefaultChildAgentId(input);
}

async function refreshProjectSkillIds<TContext extends DefaultHostedInvokeAgentContext>(
  options: Pick<
    DefaultHostedInvokeAgentToolOptions<TContext>,
    "context" | "refreshProjectSkillIds"
  >,
): Promise<void> {
  await options.refreshProjectSkillIds?.(options.context);
}

async function applyRequestedProjectId<TContext extends DefaultHostedInvokeAgentContext>(
  options: Pick<
    DefaultHostedInvokeAgentToolOptions<TContext>,
    "context" | "refreshProjectSkillIds"
  >,
  projectId: string,
): Promise<void> {
  if (!applyAgentProjectContextChange(options.context, projectId)) {
    return;
  }

  await refreshProjectSkillIds(options);
}

async function prepareForkToolSources<TContext extends DefaultHostedInvokeAgentContext>(
  options: DefaultHostedInvokeAgentToolOptions<TContext>,
  config: DefaultHostedInvokeAgentConfig,
  childAgentId: string,
  childConfig: DefaultHostedChildAgentExecutionConfig | undefined,
  abortSignal?: AbortSignal,
): Promise<DefaultHostedChildForkToolAssemblySourceResult> {
  throwIfChildRunAborted(abortSignal);

  const globalTools: HostToolSet = {
    ...(options.buildGlobalTools?.(options.context, childAgentId, childConfig) ?? {}),
    sleep: sleepTool,
  };

  return prepareDefaultHostedChildForkSandboxToolSources({
    authToken: options.context.authToken,
    apiUrl: config.apiUrl,
    apiMcpUrl: config.apiMcpUrl,
    studioMcpUrl: config.studioMcpUrl,
    mcpServers: config.mcpServers,
    clientProfile: options.context.clientProfile,
    getProjectId: () => options.context.projectId || null,
    conversationId: options.context.conversationId,
    globalTools,
    abortSignal,
    isAbortError: isChildRunAbortError,
    logger: options.logger,
    createBashTool: options.createBashTool,
    createAgentServiceSandboxTools: options.createAgentServiceSandboxTools ??
      createAgentServiceSandboxTools,
    createLiveStudioTools: options.createLiveStudioTools ?? createLiveStudioMcpTools,
    createRemoteToolSource: options.createRemoteToolSource ?? createRemoteMCPToolSource,
    createToolsFromRemoteDefinitions: options.createToolsFromRemoteDefinitions ??
      createToolsFromRemoteDefinitions,
    onConfirmedStudioProjectSwitch: (projectId) => applyRequestedProjectId(options, projectId),
  });
}

async function prepareForkToolAssembly<TContext extends DefaultHostedInvokeAgentContext>(
  options: DefaultHostedInvokeAgentToolOptions<TContext>,
  config: DefaultHostedInvokeAgentConfig,
  input: {
    childAgentId: string;
    childConfig?: DefaultHostedChildAgentExecutionConfig;
    provider: string;
    forkModel: string;
    effectivePrompt: string;
    requestedTools?: HostedChildForkToolInput["tools"];
    abortSignal?: AbortSignal;
  },
): Promise<DefaultHostedChildForkToolAssemblyResult> {
  const toolAssembly = await prepareDefaultHostedChildForkToolAssembly({
    prepareToolSources: () =>
      prepareForkToolSources(
        options,
        config,
        input.childAgentId,
        input.childConfig,
        input.abortSignal,
      ),
    provider: input.provider,
    forkModel: input.forkModel,
    effectivePrompt: input.effectivePrompt,
    requestedTools: input.requestedTools,
    activeProjectId: options.context.projectId || null,
    activeBranchId: options.context.branchId,
    logger: options.logger,
    onSteeringMutation: async (mutation) => {
      if (mutation.instructionsChanged || mutation.skillsChanged) {
        options.context.steeringRevision = (options.context.steeringRevision ?? 0) + 1;
      }

      if (mutation.skillsChanged) {
        await refreshProjectSkillIds(options);
      }
    },
  });

  if (toolAssembly.ok) {
    options.context.availableToolNames = toolAssembly.availableToolNames;
  }

  return toolAssembly;
}

function buildInstrumentation<TContext extends DefaultHostedInvokeAgentContext>(
  options: DefaultHostedInvokeAgentToolOptions<TContext>,
) {
  return {
    trace: options.trace,
    setTraceAttributes: options.setTraceAttributes,
    buildToolTraceAttributes: ({ toolName, toolCallId }: {
      toolName: string;
      toolCallId: string | undefined;
    }) =>
      buildExecuteToolTraceAttributes({
        toolName,
        toolCallId,
      }),
    tracePart: async ({ partType }: { partType: string }) => {
      await options.trace("invoke_agent.childStreamPart", async () => {
        options.setTraceAttributes({
          "conversation.id": options.context.conversationId ?? "unknown",
          "run.id": options.context.parentRunId ?? "unknown",
          "stream.part.type": partType,
        });
      });
    },
    debug: (message: string, metadata?: Record<string, unknown>) =>
      options.logger.debug(message, metadata),
    warn: (message: string, metadata?: Record<string, unknown>) =>
      options.logger.warn(message, metadata),
    error: (message: string, metadata?: Record<string, unknown>) =>
      options.logger.error(message, metadata),
  };
}

async function executeForkTask<TContext extends DefaultHostedInvokeAgentContext>(
  options: DefaultHostedInvokeAgentToolOptions<TContext>,
  input: HostedChildForkToolInput,
  execution: {
    toolCallId: string;
    abortSignal?: AbortSignal;
    sourceIntegrationPolicy?: SourceIntegrationPolicyManifest;
  },
  runtimeOptions: {
    childAgentId: string;
    childConfig?: DefaultHostedChildAgentExecutionConfig;
    onSettled?: (snapshot: ChildRunExecutionSnapshot) => void | Promise<void>;
    durableChildRun?: HostedChildRunIdentifiers;
  },
): Promise<ChildRunExecutionResult> {
  const baseConfig = options.getConfig();
  const config = runtimeOptions.childConfig?.mcpServers === undefined
    ? baseConfig
    : { ...baseConfig, mcpServers: runtimeOptions.childConfig.mcpServers };
  const instrumentation = buildInstrumentation(options);
  const writeHostedChildExecutionLog = createHostedChildExecutionLogWriter(options.logger);

  return executeHostedChildForkToolInput<DefaultHostedInvokeAgentTraceAttributes>({
    apiUrl: config.apiUrl,
    authToken: options.context.authToken,
    projectId: options.context.projectId || null,
    forkInput: input,
    toolCallId: execution.toolCallId,
    contextModel: options.context.model,
    defaultModel: options.defaultModel ?? DEFAULT_USER_AGENT_MODEL,
    defaultMaxSteps: options.defaultMaxSteps ?? DEFAULT_USER_AGENT_MAX_STEPS,
    resolveModelId: options.resolveModelId,
    resolveProvider: options.resolveProvider,
    resolveModelThinking: options.resolveModelThinking,
    onRequestedProjectId: (projectId) => applyRequestedProjectId(options, projectId),
    onRuntimeConfig: (runtimeConfig) => {
      options.logger.info("Starting child fork", {
        conversationId: options.context.conversationId,
        parentRunId: options.context.parentRunId,
        description: runtimeConfig.description,
        kind: "invoke_agent",
        model: runtimeConfig.forkModel,
        maxSteps: runtimeConfig.maxSteps,
        requestedTools: runtimeConfig.requestedTools?.length,
      });
    },
    prepareToolAssembly: ({ runtimeConfig, requestedTools, abortSignal }) =>
      prepareForkToolAssembly(options, config, {
        childAgentId: runtimeOptions.childAgentId,
        childConfig: runtimeOptions.childConfig,
        provider: runtimeConfig.provider,
        forkModel: runtimeConfig.forkModel,
        effectivePrompt: runtimeConfig.effectivePrompt,
        requestedTools,
        abortSignal,
      }),
    resolveProviderOptions: options.resolveProviderOptions,
    resolveReasoning: options.resolveReasoning,
    forkContext: options.context,
    ...(runtimeOptions.childConfig
      ? {
        buildInstructions: () => {
          const baseInstructions = buildHostedChildForkInstructions({
            ...options.context,
            availableSkillIds: runtimeOptions.childConfig?.availableSkillIds,
          });
          return runtimeOptions.childConfig?.system
            ? `${runtimeOptions.childConfig.system}\n\n${baseInstructions}`
            : baseInstructions;
        },
      }
      : {}),
    abortSignal: execution.abortSignal,
    durableChildRun: runtimeOptions.durableChildRun,
    conversationId: options.context.conversationId,
    parentRunId: options.context.parentRunId,
    kind: "invoke_agent",
    onSettled: runtimeOptions.onSettled,
    logger: options.logger,
    pendingToolLogWriter: options.logger,
    writeLog: writeHostedChildExecutionLog,
    startRuntime: startHostedChildForkRuntimeWithHostTools,
    shouldRethrowError: options.shouldRethrowError,
    instrumentation,
    sourceIntegrationPolicy: execution.sourceIntegrationPolicy,
  });
}

function getToolCallId(executionContext?: ToolExecutionContext): string {
  return typeof executionContext?.toolCallId === "string" && executionContext.toolCallId.length > 0
    ? executionContext.toolCallId
    : `invoke_agent-${crypto.randomUUID()}`;
}

function getAbortSignal(executionContext?: ToolExecutionContext): AbortSignal | undefined {
  return executionContext?.abortSignal instanceof AbortSignal
    ? executionContext.abortSignal
    : undefined;
}

function applyChildAgentExecutionConfig(
  input: DefaultHostedInvokeAgentInput,
  childConfig: DefaultHostedChildAgentExecutionConfig | undefined,
): DefaultHostedInvokeAgentInput {
  if (!childConfig) {
    return input;
  }

  return {
    ...input,
    ...(input.model === undefined && childConfig.model ? { model: childConfig.model } : {}),
    ...(input.max_steps === undefined && childConfig.maxSteps !== undefined
      ? { max_steps: childConfig.maxSteps }
      : {}),
    ...(input.thinking === undefined && childConfig.thinking !== undefined
      ? { thinking: childConfig.thinking }
      : {}),
    ...(input.tools === undefined && childConfig.toolNames !== undefined
      ? { tools: childConfig.toolNames }
      : {}),
  };
}

/** Test-only helpers for fixed-target hosted delegation behavior. */
export const defaultHostedInvokeAgentToolInternals = {
  applyChildAgentExecutionConfig,
};

/** Execute default hosted invoke agent tool. */
export async function executeDefaultHostedInvokeAgentTool<
  TContext extends DefaultHostedInvokeAgentContext,
>(
  options: DefaultHostedInvokeAgentToolOptions<TContext>,
  input: DefaultHostedInvokeAgentInput,
  childAgentId: string,
  executionContext?: ToolExecutionContext,
): Promise<DefaultHostedInvokeAgentToolResult> {
  let executionSnapshot: ChildRunExecutionSnapshot | null = null;
  const config = options.getConfig();
  const childConfig = await options.resolveChildAgentExecutionConfig?.(childAgentId);
  const toolCallId = getToolCallId(executionContext);
  const abortSignal = getAbortSignal(executionContext);
  const sourceIntegrationPolicy = getRuntimeSourceIntegrationPolicyFromContext(executionContext);
  const configuredInput = applyChildAgentExecutionConfig(input, childConfig);
  const forkInput = withHostedChildInvocationContext(configuredInput, {
    conversationId: options.context.conversationId,
    parentRunId: options.context.parentRunId,
    toolCallId,
  });
  const durableInvokeRecorder = createHostedDurableChildInvokeTraceRecorder({
    traceBase: {
      conversationId: options.context.conversationId,
      projectId: options.context.projectId,
      runId: options.context.parentRunId,
      toolCallId,
      childAgentId,
    },
    executionFailedCode: "INVOKE_AGENT_FAILED",
    setTraceAttributes: options.setTraceAttributes,
  });

  const executeLocalInvoke = (runtimeOptions: HostedDurableChildExecutionOptions = {}) =>
    executeForkTask(
      options,
      forkInput,
      {
        toolCallId,
        abortSignal,
        sourceIntegrationPolicy,
      },
      {
        childAgentId,
        childConfig,
        onSettled: (snapshot) => {
          executionSnapshot = snapshot;
        },
        durableChildRun: runtimeOptions.durableChildRun,
      },
    );

  durableInvokeRecorder.annotate();

  if (!config.enableDurableInvokeAgent) {
    return executeHostedLocalChildInvoke({
      forkInput,
      abortSignal,
      traceRecorder: durableInvokeRecorder,
      execute: executeLocalInvoke,
      getExecutionSnapshot: () => executionSnapshot,
      resultMode: input.result_mode,
    });
  }

  executionSnapshot = null;

  try {
    return await executeHostedDurableChildFork<
      HostedDurableChildInvokeResult,
      ChildRunExecutionResult
    >({
      authToken: options.context.authToken,
      apiUrl: config.apiUrl,
      forkInput,
      executionOptions: {
        toolCallId,
        abortSignal,
      },
      childAgentId,
      runProjectId: input.project_id ?? options.context.projectId,
      parentConversationId: options.context.conversationId,
      parentRunId: options.context.parentRunId,
      parentMessageId: options.context.parentMessageId,
      getProjectId: () => options.context.projectId,
      getRuntimeTargetKind: () => options.context.runtimeTargetKind,
      getRuntimeTargetEnvironmentId: () => options.context.runtimeTargetEnvironmentId,
      getBranchId: () => options.context.branchId,
      getContextModel: () => options.context.model,
      defaultModel: options.defaultModel ?? DEFAULT_USER_AGENT_MODEL,
      resolveModelId: options.resolveModelId,
      resolveProvider: options.resolveProvider,
      onRequestedProjectId: (projectId) => applyRequestedProjectId(options, projectId),
      publishParentRunEvents: options.context.publishParentRunEvents,
      contextUnavailableMessage:
        "invoke_agent requires durable conversation context when durable child runs are enabled.",
      setupFailedCode: DURABLE_INVOKE_SETUP_FAILED,
      executionFailedCode: "INVOKE_AGENT_FAILED",
      executeLocal: executeLocalInvoke,
      getExecutionSnapshot: () => executionSnapshot,
      buildContextUnavailableResult: (message) => {
        durableInvokeRecorder.annotate({
          status: "failed",
          terminalErrorCode: DURABLE_INVOKE_CONTEXT_UNAVAILABLE,
          terminalErrorMessage: message,
        });

        return buildHostedDurableChildInvokeFailureResult({
          terminalErrorCode: DURABLE_INVOKE_CONTEXT_UNAVAILABLE,
          terminalErrorMessage: message,
        });
      },
      buildSetupFailureResult: (failure) => durableInvokeRecorder.recordSetupFailure(failure),
      buildTerminalFailureResult: (failure) => durableInvokeRecorder.recordTerminalFailure(failure),
      buildSuccessResult: (success) =>
        durableInvokeRecorder.recordSuccess(success, { resultMode: input.result_mode }),
      runtime: {
        bootstrapChildRun: bootstrapHostedChildRun,
        createLifecycleAdapter: createConversationChildLifecycleAdapter,
        runLifecycle: runHostedChildExecutionLifecycle,
        shouldSkipTerminalPersistence: shouldSkipHostedChildTerminalPersistence,
      },
      bootstrap: {
        runBootstrap: (operation) =>
          options.trace("invoke_agent.durableChildSetup", async () => {
            options.setTraceAttributes({
              "conversation.id": options.context.conversationId,
              "run.id": options.context.parentRunId,
              "tool.call.id": toolCallId,
            });

            return operation();
          }),
        onBootstrapStart: (bootstrapContext) => {
          options.logger.info("Bootstrapping durable child run", {
            parentConversationId: bootstrapContext.parentConversationId,
            parentRunId: bootstrapContext.parentRunId,
            toolCallId,
            childAgentId,
            description: input.description,
          });
        },
        onBootstrapComplete: (bootstrapContext) => {
          options.logger.info("Durable child bootstrap complete", {
            parentConversationId: bootstrapContext.parentConversationId,
            childConversationId: bootstrapContext.identifiers.childConversationId,
            childRunId: bootstrapContext.identifiers.childRunId,
            childMessageId: bootstrapContext.identifiers.childMessageId,
            toolCallId,
          });
        },
        onBootstrapError: ({ error, parentConversationId }) => {
          options.logger.warn("Durable child-run persistence failed", {
            parentConversationId,
            toolCallId,
            error: error instanceof Error ? error.message : String(error),
          });
        },
      },
      onLifecycleError: (error) => {
        options.logger.warn("Durable child lifecycle adapter failed", {
          toolCallId,
          error: error instanceof Error ? error.message : String(error),
        });
      },
      onLifecycleFinalized: ({ identifiers, status }) =>
        options.trace("invoke_agent.durableChildFinalize", async () => {
          options.setTraceAttributes({
            "child.conversation.id": identifiers.childConversationId,
            "child.run.id": identifiers.childRunId,
            "child.message.id": identifiers.childMessageId,
            "agent.run.final_status": status,
          });
        }),
    });
  } catch (error) {
    durableInvokeRecorder.recordLocalFailure(
      error instanceof Error ? error.message : String(error),
    );
    throw error;
  }
}

/** Create default hosted invoke agent tool. */
export function createDefaultHostedInvokeAgentTool<
  TContext extends DefaultHostedInvokeAgentContext,
>(
  options: DefaultHostedInvokeAgentToolOptions<TContext>,
) {
  return createHostedChildInvokeTool<
    DefaultHostedInvokeAgentInput,
    DefaultHostedInvokeAgentToolResult
  >({
    inputSchema: defaultHostedInvokeAgentInputSchema,
    additionalDescriptionParts: [
      "agent_id is required. Use it to target a specific built-in or custom child agent.",
      'result_mode defaults to "summary"; use "structured" when critical contract ids must survive the bounded summary; use "full" only when exact delegated output is required.',
    ],
    buildFailureResult: buildHostedDurableChildInvokeFailureResult,
    decorateResult: withRootOwnedChildResultHint,
    execute: (input, executionOptions) =>
      executeDefaultHostedInvokeAgentTool(
        options,
        input,
        resolveChildAgentId(options, input),
        executionOptions,
      ),
  });
}
