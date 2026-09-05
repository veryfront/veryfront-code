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
import type { AgentSystem } from "#veryfront/agent/types.ts";
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
import {
  type StartedHostedChildForkRuntime,
  startHostedChildForkRuntimeWithHostTools,
  type StartHostedChildForkRuntimeWithHostToolsInput,
} from "./child-fork-runtime-start.ts";
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
  type HostedChildInvocationContext,
  withHostedChildInvocationContext,
} from "./child-tool-input.ts";
import type {
  DefaultHostedChildForkToolAssemblyResult,
  DefaultHostedChildForkToolAssemblySourceResult,
} from "./child-requested-tools.ts";
import { prepareDefaultHostedChildForkToolAssembly } from "./child-requested-tools.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";
import type { RuntimeLoadSkillToolContext } from "../runtime/load-skill-tool.ts";
import type { RuntimeReasoningOption } from "../types.ts";
import { withRootOwnedChildResultHint } from "../conversation/delegation-policy.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import { getRuntimeSourceIntegrationPolicyFromContext } from "../runtime/runtime-tool-config.ts";
import { buildHostedChildForkInstructions } from "./child-fork-instructions.ts";
import {
  type HostedProjectReferenceResolver,
  requireConfirmedHostedProjectReference,
  resolveHostedProjectReference,
} from "./project-reference-resolver.ts";
import {
  getActiveHostedRunEventWriterCapability,
  type HostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";

/** Context for default hosted invoke agent. */
export type DefaultHostedInvokeAgentContext = MutableAgentProjectContext & {
  authToken: string;
  clientProfile?: RuntimeClientProfile | null;
  model?: string;
  conversationId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  veryfrontInvocationContext?: HostedChildInvocationContext;
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
  system: AgentSystem;
  model?: string;
  temperature?: number;
  maxSteps?: number;
  thinking?: HostedChildForkToolInput["thinking"];
  toolNames?: string[];
  /**
   * Tool names the child's agent configuration denied explicitly (`false`
   * entries). An authorization ceiling for child execution: explicit
   * `invoke_agent` tool requests cannot re-enable them, and they are removed
   * from the assembled fork tool sources.
   */
  deniedToolNames?: string[];
  mcpServers?: readonly AgentServiceMcpServerConfig[];
  availableSkillIds?: string[];
  skillSelectorPolicy?: import("#veryfront/skill/selector.ts").ResolvedSkillSelectorPolicy;
  skillSourcePaths?: Readonly<Record<string, string>>;
  loadedSkillResponses?: RuntimeLoadSkillToolContext["loadedSkillResponses"];
  loadedSkillReferenceResponses?: RuntimeLoadSkillToolContext["loadedSkillReferenceResponses"];
  delegateIds?: string[];
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

/**
 * Options for the default hosted invoke-agent tool.
 * `runEventWriterCapability` carries the current parent run's authority and is
 * delegated internally after each durable child run is persisted.
 */
export type DefaultHostedInvokeAgentToolOptions<TContext extends DefaultHostedInvokeAgentContext> =
  {
    context: TContext;
    /** Opaque exact-parent authority used to persist durable delegated child events. */
    runEventWriterCapability?: HostedRunEventWriterCapability;
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
      durableChildRun?: HostedChildRunIdentifiers,
    ) => HostToolSet;
    resolveChildAgentExecutionConfig?: (
      childAgentId: string,
      projectId: string,
    ) => Promise<DefaultHostedChildAgentExecutionConfig | undefined>;
    resolveProjectReference?: HostedProjectReferenceResolver;
    refreshProjectSkillIds?: DefaultHostedInvokeAgentProjectRefresh<TContext>;
    /** Require durable child lifecycle even when legacy generic delegation is disabled. */
    requireDurableInvokeAgent?: boolean;
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
    startRuntime?: (
      input: StartHostedChildForkRuntimeWithHostToolsInput<DefaultHostedInvokeAgentTraceAttributes>,
    ) => StartedHostedChildForkRuntime | Promise<StartedHostedChildForkRuntime>;
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
type ParsedDefaultHostedInvokeAgentInput = InferSchema<
  ReturnType<typeof getDefaultHostedInvokeAgentInputSchema>
>;
export type DefaultHostedInvokeAgentInput =
  & Omit<ParsedDefaultHostedInvokeAgentInput, "context">
  & {
    context?: ParsedDefaultHostedInvokeAgentInput["context"];
  };

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
  projectSlug?: string,
): Promise<void> {
  if (!applyAgentProjectContextChange(options.context, projectId, projectSlug)) {
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
  durableChildRun?: HostedChildRunIdentifiers,
): Promise<DefaultHostedChildForkToolAssemblySourceResult> {
  throwIfChildRunAborted(abortSignal);

  const globalTools: HostToolSet = {
    ...(options.buildGlobalTools?.(
      options.context,
      childAgentId,
      childConfig,
      durableChildRun,
    ) ?? {}),
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
    onConfirmedStudioProjectSwitch: (projectId, confirmedProject) =>
      applyRequestedProjectId(options, projectId, confirmedProject?.projectSlug),
  });
}

/**
 * Removes explicitly denied tool names from the assembled fork tool set. The
 * assembled sources contain the full discovered and remote catalogs, so an
 * unrestricted child selector (or an explicit request) would otherwise still
 * surface a tool the child's agent configuration switched off.
 */
function withoutDeniedForkTools(
  toolSources: DefaultHostedChildForkToolAssemblySourceResult,
  deniedToolNames: readonly string[] | undefined,
): DefaultHostedChildForkToolAssemblySourceResult {
  if (!toolSources.ok || !deniedToolNames?.length) {
    return toolSources;
  }
  const denied = new Set(deniedToolNames);
  return {
    ...toolSources,
    forkTools: Object.fromEntries(
      Object.entries(toolSources.forkTools).filter(([toolName, tool]) =>
        !denied.has(toolName) &&
        (tool.shortName === undefined || !denied.has(tool.shortName))
      ),
    ),
  };
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
    durableChildRun?: HostedChildRunIdentifiers;
  },
): Promise<DefaultHostedChildForkToolAssemblyResult> {
  const toolAssembly = await prepareDefaultHostedChildForkToolAssembly({
    prepareToolSources: async () =>
      withoutDeniedForkTools(
        await prepareForkToolSources(
          options,
          config,
          input.childAgentId,
          input.childConfig,
          input.abortSignal,
          input.durableChildRun,
        ),
        input.childConfig?.deniedToolNames,
      ),
    provider: input.provider,
    forkModel: input.forkModel,
    effectivePrompt: input.effectivePrompt,
    requestedTools: input.requestedTools,
    ...(input.childConfig?.deniedToolNames?.length
      ? { excludedTools: new Set(input.childConfig.deniedToolNames) }
      : {}),
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
    runEventWriterCapability?: HostedRunEventWriterCapability;
  },
): Promise<ChildRunExecutionResult> {
  const baseConfig = options.getConfig();
  const config = runtimeOptions.childConfig?.mcpServers === undefined
    ? baseConfig
    : { ...baseConfig, mcpServers: runtimeOptions.childConfig.mcpServers };
  const forkInput = withHostedChildInvocationContext(input, {
    parentConversationId: options.context.conversationId,
    conversationId: options.context.conversationId,
    parentRunId: options.context.parentRunId,
    parentMessageId: options.context.parentMessageId,
    toolCallId: execution.toolCallId,
    trustedInvocationContext: options.context.veryfrontInvocationContext,
  });
  const invocationContext = forkInput.context?.veryfront_invocation_context as
    | HostedChildInvocationContext
    | undefined;
  const scopedOptions = invocationContext
    ? {
      ...options,
      context: {
        ...options.context,
        veryfrontInvocationContext: invocationContext,
      },
    }
    : options;
  const instrumentation = buildInstrumentation(scopedOptions);
  const writeHostedChildExecutionLog = createHostedChildExecutionLogWriter(options.logger);

  return executeHostedChildForkToolInput<DefaultHostedInvokeAgentTraceAttributes>({
    apiUrl: config.apiUrl,
    authToken: scopedOptions.context.authToken,
    ...(runtimeOptions.runEventWriterCapability
      ? { runEventWriterCapability: runtimeOptions.runEventWriterCapability }
      : {}),
    projectId: scopedOptions.context.projectId || null,
    forkInput,
    toolCallId: execution.toolCallId,
    contextModel: scopedOptions.context.model,
    defaultModel: options.defaultModel ?? DEFAULT_USER_AGENT_MODEL,
    defaultMaxSteps: runtimeOptions.childConfig?.maxSteps ??
      options.defaultMaxSteps ??
      DEFAULT_USER_AGENT_MAX_STEPS,
    resolveModelId: options.resolveModelId,
    resolveProvider: options.resolveProvider,
    resolveModelThinking: options.resolveModelThinking,
    onRequestedProjectId: (projectId, projectSlug) =>
      applyRequestedProjectId(scopedOptions, projectId, projectSlug),
    onRuntimeConfig: (runtimeConfig) => {
      options.logger.info("Starting child fork", {
        conversationId: scopedOptions.context.conversationId,
        parentRunId: scopedOptions.context.parentRunId,
        description: runtimeConfig.description,
        kind: "invoke_agent",
        model: runtimeConfig.forkModel,
        maxSteps: runtimeConfig.maxSteps,
        requestedTools: runtimeConfig.requestedTools?.length,
      });
    },
    prepareToolAssembly: ({ runtimeConfig, requestedTools, abortSignal }) =>
      prepareForkToolAssembly(scopedOptions, config, {
        childAgentId: runtimeOptions.childAgentId,
        childConfig: runtimeOptions.childConfig,
        provider: runtimeConfig.provider,
        forkModel: runtimeConfig.forkModel,
        effectivePrompt: runtimeConfig.effectivePrompt,
        requestedTools,
        abortSignal,
        durableChildRun: runtimeOptions.durableChildRun,
      }),
    resolveProviderOptions: options.resolveProviderOptions,
    resolveReasoning: options.resolveReasoning,
    forkContext: scopedOptions.context,
    parentConversationId: scopedOptions.context.conversationId,
    parentMessageId: scopedOptions.context.parentMessageId,
    trustedInvocationContext: scopedOptions.context.veryfrontInvocationContext,
    inputAlreadyHasInvocationContext: true,
    ...(runtimeOptions.childConfig
      ? {
        buildInstructions: () => {
          const baseInstructions = buildHostedChildForkInstructions({
            ...scopedOptions.context,
            availableSkillIds: runtimeOptions.childConfig?.availableSkillIds,
          });
          const childSystem = runtimeOptions.childConfig?.system;
          if (childSystem === undefined) {
            return baseInstructions;
          }
          if (typeof childSystem === "string") {
            return childSystem ? `${childSystem}\n\n${baseInstructions}` : baseInstructions;
          }
          return [
            ...childSystem,
            { role: "system", content: baseInstructions },
          ];
        },
      }
      : {}),
    abortSignal: execution.abortSignal,
    durableChildRun: runtimeOptions.durableChildRun,
    conversationId: scopedOptions.context.conversationId,
    parentRunId: scopedOptions.context.parentRunId,
    kind: "invoke_agent",
    onSettled: runtimeOptions.onSettled,
    logger: options.logger,
    pendingToolLogWriter: options.logger,
    writeLog: writeHostedChildExecutionLog,
    startRuntime: options.startRuntime ?? startHostedChildForkRuntimeWithHostTools,
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

  // The resolved child selector and explicit denials are authorization
  // ceilings: a parent-supplied tool list in `invoke_agent` can only narrow
  // the child's configured capabilities.
  const deniedToolNames = childConfig.deniedToolNames;
  const allowedToolNames = childConfig.toolNames === undefined
    ? undefined
    : new Set(childConfig.toolNames);
  const requestedTools = input.tools?.filter((toolName) =>
    deniedToolNames?.includes(toolName) !== true &&
    (allowedToolNames === undefined || allowedToolNames.has(toolName))
  );

  return {
    ...input,
    ...(input.model === undefined && childConfig.model ? { model: childConfig.model } : {}),
    ...(input.temperature === undefined && childConfig.temperature !== undefined
      ? { temperature: childConfig.temperature }
      : {}),
    ...(input.max_steps === undefined && childConfig.maxSteps !== undefined
      ? { max_steps: childConfig.maxSteps }
      : {}),
    ...(input.thinking === undefined && childConfig.thinking !== undefined
      ? { thinking: childConfig.thinking }
      : {}),
    ...(requestedTools === undefined
      ? (childConfig.toolNames !== undefined ? { tools: childConfig.toolNames } : {})
      : { tools: requestedTools }),
  };
}

/** Test-only helpers for fixed-target hosted delegation behavior. */
export const defaultHostedInvokeAgentToolInternals = {
  applyChildAgentExecutionConfig,
  withoutDeniedForkTools,
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
  return await executeDefaultHostedInvokeAgentToolWithCapability(
    options,
    input,
    childAgentId,
    executionContext,
    options.runEventWriterCapability ?? getActiveHostedRunEventWriterCapability(),
  );
}

async function executeDefaultHostedInvokeAgentToolWithCapability<
  TContext extends DefaultHostedInvokeAgentContext,
>(
  options: DefaultHostedInvokeAgentToolOptions<TContext>,
  input: DefaultHostedInvokeAgentInput,
  childAgentId: string,
  executionContext: ToolExecutionContext | undefined,
  runEventWriterCapability: HostedRunEventWriterCapability | undefined,
): Promise<DefaultHostedInvokeAgentToolResult> {
  return await runWithHostedRunEventWriterCapability(undefined, async () => {
    let executionSnapshot: ChildRunExecutionSnapshot | null = null;
    const config = options.getConfig();
    const toolCallId = getToolCallId(executionContext);
    const abortSignal = getAbortSignal(executionContext);
    const requestedProjectReference = input.project_reference;
    let targetProjectId = options.context.projectId;
    let resolvedInput = input;
    if (requestedProjectReference) {
      const resolver = options.resolveProjectReference ?? resolveHostedProjectReference;
      const resolution = await resolver({
        projectReference: requestedProjectReference,
        authToken: options.context.authToken,
        apiUrl: config.apiUrl,
        abortSignal,
      });
      const resolvedProject = requireConfirmedHostedProjectReference(
        resolution,
        requestedProjectReference,
      );
      targetProjectId = resolvedProject.projectId;
      await applyRequestedProjectId(options, targetProjectId, resolvedProject.projectSlug);
      resolvedInput = {
        ...input,
        project_reference: undefined,
      };
    }
    const childConfig = await options.resolveChildAgentExecutionConfig?.(
      childAgentId,
      targetProjectId,
    );
    const sourceIntegrationPolicy = getRuntimeSourceIntegrationPolicyFromContext(executionContext);
    const configuredInput = applyChildAgentExecutionConfig(resolvedInput, childConfig);
    const forkInput = configuredInput;
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

    const executeLocalInvoke = (runtimeOptions: HostedDurableChildExecutionOptions = {}) => {
      const childRunEventWriterCapability = getActiveHostedRunEventWriterCapability() ??
        runEventWriterCapability;
      return runWithHostedRunEventWriterCapability(
        undefined,
        () =>
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
              runEventWriterCapability: childRunEventWriterCapability,
            },
          ),
      );
    };

    durableInvokeRecorder.annotate();

    if (!config.enableDurableInvokeAgent && !options.requireDurableInvokeAgent) {
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
        ...(runEventWriterCapability ? { runEventWriterCapability } : {}),
        forkInput,
        executionOptions: {
          toolCallId,
          abortSignal,
        },
        childAgentId,
        runProjectId: targetProjectId,
        parentConversationId: options.context.conversationId,
        parentRunId: options.context.parentRunId,
        parentMessageId: options.context.parentMessageId,
        trustedInvocationContext: options.context.veryfrontInvocationContext,
        getProjectId: () => options.context.projectId,
        getRuntimeTargetKind: () => options.context.runtimeTargetKind,
        getRuntimeTargetEnvironmentId: () => options.context.runtimeTargetEnvironmentId,
        getBranchId: () => options.context.branchId,
        getContextModel: () => options.context.model,
        defaultModel: options.defaultModel ?? DEFAULT_USER_AGENT_MODEL,
        resolveModelId: options.resolveModelId,
        resolveProvider: options.resolveProvider,
        onRequestedProjectId: (projectId, projectSlug) =>
          applyRequestedProjectId(options, projectId, projectSlug),
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
        buildTerminalFailureResult: (failure) =>
          durableInvokeRecorder.recordTerminalFailure(failure),
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
  });
}

/** Create default hosted invoke agent tool. */
export function createDefaultHostedInvokeAgentTool<
  TContext extends DefaultHostedInvokeAgentContext,
>(
  options: DefaultHostedInvokeAgentToolOptions<TContext>,
) {
  const runEventWriterCapability = options.runEventWriterCapability ??
    getActiveHostedRunEventWriterCapability();
  return createHostedChildInvokeTool<
    DefaultHostedInvokeAgentInput,
    DefaultHostedInvokeAgentToolResult
  >({
    inputSchema: defaultHostedInvokeAgentInputSchema,
    additionalDescriptionParts: [
      "agent_id is required. Use it to target a specific built-in or custom child agent.",
      'result_mode defaults to "summary"; "structured" extracts contract ids from a bounded 128,000-character head-and-tail window; use "full" only when exact delegated output is required.',
    ],
    buildFailureResult: buildHostedDurableChildInvokeFailureResult,
    decorateResult: withRootOwnedChildResultHint,
    execute: (input, executionOptions) =>
      executeDefaultHostedInvokeAgentToolWithCapability(
        options,
        input,
        resolveChildAgentId(options, input),
        executionOptions,
        runEventWriterCapability,
      ),
  });
}
