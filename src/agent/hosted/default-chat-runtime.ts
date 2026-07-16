import {
  type HostToolSet,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
} from "#veryfront/tool";
import { runWithRequestContextAsync, serverLogger } from "#veryfront/utils";
import {
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import {
  runWithVeryfrontCloudContext,
  runWithVeryfrontCloudContextAsync,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { agent } from "../factory.ts";
import { markRuntimeLocalTool } from "../runtime/local-tool.ts";
import {
  applyDefaultResearchArtifactPath,
  createDefaultResearchRunArtifactMirrorHandler,
  shouldRetryCreateResearchArtifactAsUpdate,
} from "../artifacts/default-research-artifact-support.ts";
import { createHostedChatRuntimeAgentAdapter } from "./chat-runtime-agent-adapter.ts";
import type {
  HostedChatRuntimeCreationOptions,
  HostedChatRuntimeCreationResult,
} from "./chat-runtime-contract.ts";
import {
  type HostedChatRuntimeToolAssemblyResult,
  prepareHostedChatRuntimeToolAssembly,
  type PrepareHostedChatRuntimeToolAssemblyInput,
} from "./chat-runtime-tool-assembly.ts";
import type { AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import {
  createHostedRuntimeStateResolver,
  type HostedRuntimeStateResolverContext,
} from "./runtime-state-resolver.ts";
import type { ProjectSteeringMutationResult } from "../project/steering-mutation.ts";
import type {
  RuntimeAgentMarkdownDefinition,
  RuntimeAgentThinkingConfig,
} from "../runtime/agent-definition.ts";
import type { AgentConfig } from "../types.ts";
import type { RuntimeRemoteToolConfig } from "../runtime/mcp-server-tool-sources.ts";

/** Configuration used by default hosted chat runtime. */
export type DefaultHostedChatRuntimeConfig = {
  apiUrl: string;
  apiMcpUrl: string;
  studioMcpUrl?: string | null;
  mcpServers?: readonly AgentServiceMcpServerConfig[];
};

/** Public API contract for default hosted chat runtime logger. */
export type DefaultHostedChatRuntimeLogger = {
  warn(message: string, metadata?: Record<string, unknown>): void;
};

/** Options accepted by default hosted chat runtime creation. */
export type DefaultHostedChatRuntimeCreationOptions =
  & HostedChatRuntimeCreationOptions<
    RuntimeAgentMarkdownDefinition,
    RuntimeAgentThinkingConfig
  >
  & {
    userId?: string;
  };

/** Context for default hosted chat runtime task. */
export type DefaultHostedChatRuntimeTaskContext = HostedRuntimeStateResolverContext & {
  authToken: string;
  runId?: string;
  agentId?: string;
  projectId: string;
  branchId: string | null;
  runtimeTargetKind?: DefaultHostedChatRuntimeCreationOptions["runtimeTargetKind"];
  runtimeTargetEnvironmentId?: string | null;
  model: string | undefined;
  clientProfile?: DefaultHostedChatRuntimeCreationOptions["clientProfile"];
  conversationId?: string;
  userId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  availableSkillIds?: string[];
  /** Per-run skill id -> discovered SKILL.md source path (owner-aware catalog). */
  skillSourcePaths?: Readonly<Record<string, string>>;
  publishParentRunEvents?: DefaultHostedChatRuntimeCreationOptions["publishParentRunEvents"];
  availableToolNames?: string[];
  submittedFormInputResult?: DefaultHostedChatRuntimeCreationOptions["submittedFormInputResult"];
};

/** Input payload for create default hosted chat runtime context. */
export type CreateDefaultHostedChatRuntimeContextInput = {
  options: DefaultHostedChatRuntimeCreationOptions;
  modelId: string;
};

/** Input payload for default hosted chat runtime system refresh. */
export type DefaultHostedChatRuntimeSystemRefreshInput = {
  taskContext: DefaultHostedChatRuntimeTaskContext;
  liveProjectSteering: NonNullable<DefaultHostedChatRuntimeCreationOptions["liveProjectSteering"]>;
  toolAssembly: HostedChatRuntimeToolAssemblyResult;
};

/** Input payload for default hosted chat runtime steering mutation. */
export type DefaultHostedChatRuntimeSteeringMutationInput = {
  mutation: ProjectSteeringMutationResult;
  taskContext: DefaultHostedChatRuntimeTaskContext;
};

/** Input payload for default hosted chat runtime project switch. */
export type DefaultHostedChatRuntimeProjectSwitchInput = {
  projectId: string;
  taskContext: DefaultHostedChatRuntimeTaskContext;
};

/** Options accepted by create default hosted chat runtime. */
export type CreateDefaultHostedChatRuntimeOptions = {
  options: DefaultHostedChatRuntimeCreationOptions;
  config: DefaultHostedChatRuntimeConfig;
  buildLocalTools: (taskContext: DefaultHostedChatRuntimeTaskContext) => HostToolSet;
  createTaskContext?: (
    input: CreateDefaultHostedChatRuntimeContextInput,
  ) => DefaultHostedChatRuntimeTaskContext;
  refreshSystem?: (
    input: DefaultHostedChatRuntimeSystemRefreshInput,
  ) => Promise<string> | string;
  onSteeringMutation?: (
    input: DefaultHostedChatRuntimeSteeringMutationInput,
  ) => Promise<void> | void;
  onStudioProjectSwitch?: (
    input: DefaultHostedChatRuntimeProjectSwitchInput,
  ) => Promise<boolean> | boolean;
  projectScopedRemoteToolOptions?:
    PrepareHostedChatRuntimeToolAssemblyInput["projectScopedRemoteToolOptions"];
  createRemoteToolSource?: (config: RemoteMCPToolSourceConfig) => RemoteToolSource;
  traceLocalTools?: PrepareHostedChatRuntimeToolAssemblyInput["traceLocalTools"];
  preloadLatestConversationUserText?: boolean;
  logger?: DefaultHostedChatRuntimeLogger;
};

function createDefaultTaskContext(
  input: CreateDefaultHostedChatRuntimeContextInput,
): DefaultHostedChatRuntimeTaskContext {
  return {
    authToken: input.options.authToken,
    runId: input.options.runId,
    agentId: input.options.agentId,
    projectId: input.options.projectId ?? "",
    branchId: input.options.branchId ?? null,
    runtimeTargetKind: input.options.runtimeTargetKind ?? null,
    runtimeTargetEnvironmentId: input.options.runtimeTargetEnvironmentId ?? null,
    model: input.modelId,
    clientProfile: input.options.clientProfile,
    conversationId: input.options.conversationId,
    userId: input.options.userId,
    parentRunId: input.options.parentRunId,
    parentMessageId: input.options.parentMessageId,
    availableSkillIds: input.options.availableSkillIds,
    skillSourcePaths: input.options.skillSourcePaths,
    publishParentRunEvents: input.options.publishParentRunEvents,
    submittedFormInputResult: input.options.submittedFormInputResult,
  };
}

function incrementSteeringRevision(context: DefaultHostedChatRuntimeTaskContext): void {
  context.steeringRevision = (context.steeringRevision ?? 0) + 1;
}

async function buildToolAssembly(
  input: CreateDefaultHostedChatRuntimeOptions & {
    taskContext: DefaultHostedChatRuntimeTaskContext;
  },
): Promise<HostedChatRuntimeToolAssemblyResult> {
  return prepareHostedChatRuntimeToolAssembly({
    taskContext: input.taskContext,
    instructions: input.options.instructions,
    localTools: input.buildLocalTools(input.taskContext),
    apiUrl: input.config.apiUrl,
    apiMcpUrl: input.config.apiMcpUrl,
    studioMcpUrl: input.config.studioMcpUrl,
    mcpServers: input.config.mcpServers,
    conversationId: input.options.conversationId,
    allowedToolNames: input.options.allowedTools ?? null,
    allowedProviderToolNames: input.options.allowedProviderTools,
    includeRuntimeEssentialToolsWhenEmpty: input.options.includeRuntimeEssentialToolsWhenEmpty,
    sourceProviderToolNames: input.options.liveProjectSteering?.agent.providerTools,
    projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
    createRemoteToolSource: input.createRemoteToolSource,
    traceLocalTools: input.traceLocalTools,
    preloadLatestConversationUserText: input.preloadLatestConversationUserText,
    prepareRemoteToolInput: ({ toolName, toolInput }) =>
      applyDefaultResearchArtifactPath(toolName, toolInput, input.taskContext),
    shouldRetryWithRemoteTool: ({ toolName, toolInput, error }) =>
      shouldRetryCreateResearchArtifactAsUpdate({
        toolName,
        toolInput,
        taskContext: input.taskContext,
        error,
      }),
    onSteeringMutation: async (mutation) => {
      await input.onSteeringMutation?.({ mutation, taskContext: input.taskContext });
      if (mutation.instructionsChanged || mutation.skillsChanged) {
        incrementSteeringRevision(input.taskContext);
      }
    },
    onStudioProjectSwitch: async (projectId) => {
      const changed = await input.onStudioProjectSwitch?.({
        projectId,
        taskContext: input.taskContext,
      });
      if (changed) {
        incrementSteeringRevision(input.taskContext);
      }
    },
  });
}

function createRuntimeAgentConfig(input: {
  options: DefaultHostedChatRuntimeCreationOptions;
  taskContext: DefaultHostedChatRuntimeTaskContext;
  toolAssembly: HostedChatRuntimeToolAssemblyResult;
  modelId: string;
  refreshSystem?: CreateDefaultHostedChatRuntimeOptions["refreshSystem"];
}): AgentConfig {
  const liveProjectSteering = input.options.liveProjectSteering;
  const systemRefresh = input.refreshSystem;
  const refreshSystem = systemRefresh && liveProjectSteering
    ? () =>
      systemRefresh({
        taskContext: input.taskContext,
        liveProjectSteering,
        toolAssembly: input.toolAssembly,
      })
    : undefined;

  const runtimeTools = Object.fromEntries(
    Object.entries(input.toolAssembly.runtimeTools).map(([toolName, runtimeTool]) => [
      toolName,
      markRuntimeLocalTool(runtimeTool),
    ]),
  );

  const runtimeConfig: AgentConfig & RuntimeRemoteToolConfig = {
    id: "veryfront-hosted-runtime",
    model: input.modelId,
    system: input.toolAssembly.systemInstructions,
    tools: runtimeTools,
    providerTools: input.toolAssembly.providerToolNames,
    __vfRemoteToolSources: input.toolAssembly.remoteToolSources,
    __vfAllowedRemoteTools: input.toolAssembly.compatibleRemoteToolNames,
    temperature: input.options.temperature,
    maxSteps: input.options.maxSteps ?? 50,
    resolveModelTransport: ({ resolvedModel }) => {
      const thinking = input.options.thinking ??
        resolveVeryfrontCloudModelThinking(resolvedModel);
      const providerOptions = resolveVeryfrontCloudThinkingProviderOptions(
        resolvedModel,
        thinking,
      );
      const reasoning = resolveVeryfrontCloudReasoningOption(resolvedModel, thinking);
      return providerOptions || reasoning ? { providerOptions, reasoning } : {};
    },
    resolveRuntimeState: createHostedRuntimeStateResolver({
      taskContext: input.taskContext,
      refreshSystem,
    }),
    onToolResult: createDefaultResearchRunArtifactMirrorHandler({
      taskContext: input.taskContext,
      remoteToolSource: input.toolAssembly.remoteToolSources[0],
    }),
  };
  return runtimeConfig;
}

function createCloudContext(input: {
  config: DefaultHostedChatRuntimeConfig;
  options: DefaultHostedChatRuntimeCreationOptions;
}): VeryfrontCloudContext {
  return {
    apiBaseUrl: input.config.apiUrl,
    apiToken: input.options.authToken,
    serviceLayer: "cloud",
  };
}

function runWithDefaultHostedRequestContext<TResult>(
  input: {
    taskContext: DefaultHostedChatRuntimeTaskContext;
    cloudContext: VeryfrontCloudContext;
    operation: () => Promise<TResult>;
  },
): Promise<TResult> {
  const requestContext = {
    logger: serverLogger.child({
      project_id: input.taskContext.projectId || undefined,
      user_id: input.taskContext.userId,
      conversation_id: input.taskContext.conversationId,
    }),
    requestId: crypto.randomUUID(),
    projectId: input.taskContext.projectId || undefined,
    userId: input.taskContext.userId,
    conversationId: input.taskContext.conversationId,
  };

  return runWithRequestContextAsync(
    requestContext,
    () => runWithVeryfrontCloudContextAsync(input.cloudContext, input.operation),
  );
}

/** Create default hosted chat runtime. */
export async function createDefaultHostedChatRuntime(
  input: CreateDefaultHostedChatRuntimeOptions,
): Promise<HostedChatRuntimeCreationResult> {
  const modelId = resolveVeryfrontCloudModelId(input.options.model);
  const cloudContext = createCloudContext({
    config: input.config,
    options: input.options,
  });
  const taskContext = input.createTaskContext
    ? input.createTaskContext({ options: input.options, modelId })
    : createDefaultTaskContext({ options: input.options, modelId });
  const cleanup = () => Promise.resolve();

  try {
    const toolAssembly = await buildToolAssembly({
      ...input,
      taskContext,
    });
    const runtimeAgentConfig = createRuntimeAgentConfig({
      options: input.options,
      taskContext,
      toolAssembly,
      modelId,
      refreshSystem: input.refreshSystem,
    });
    const runtimeAgent = runWithVeryfrontCloudContext(
      cloudContext,
      () => agent(runtimeAgentConfig),
    );

    return {
      runtimeKind: "framework",
      modelId,
      cleanup,
      agent: createHostedChatRuntimeAgentAdapter({
        runtimeAgent,
        runId: taskContext.runId,
        agentId: taskContext.agentId,
        authToken: taskContext.authToken,
        runStream: (operation) =>
          runWithDefaultHostedRequestContext({
            taskContext,
            cloudContext,
            operation,
          }),
        warnOrphanedToolInput: (message, metadata) => {
          input.logger?.warn(message, {
            ...metadata,
            ...(taskContext.projectId ? { project_id: taskContext.projectId } : {}),
            ...(taskContext.userId ? { user_id: taskContext.userId } : {}),
            ...(taskContext.conversationId ? { conversation_id: taskContext.conversationId } : {}),
          });
        },
      }),
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
