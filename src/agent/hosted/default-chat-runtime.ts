import {
  type HostToolSet,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
} from "#veryfront/tool";
import { runWithRequestContextAsync, serverLogger } from "#veryfront/utils";
import {
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import {
  runWithVeryfrontCloudContext,
  runWithVeryfrontCloudContextAsync,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { agent } from "../factory.ts";
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

export type DefaultHostedChatRuntimeConfig = {
  apiUrl: string;
  apiMcpUrl: string;
  studioMcpUrl?: string | null;
  mcpServers?: readonly AgentServiceMcpServerConfig[];
};

export type DefaultHostedChatRuntimeLogger = {
  warn(message: string, metadata?: Record<string, unknown>): void;
};

export type DefaultHostedChatRuntimeCreationOptions =
  & HostedChatRuntimeCreationOptions<
    RuntimeAgentMarkdownDefinition,
    RuntimeAgentThinkingConfig
  >
  & {
    userId?: string;
  };

export type DefaultHostedChatRuntimeTaskContext = HostedRuntimeStateResolverContext & {
  authToken: string;
  projectId: string;
  branchId: string | null;
  model: string | undefined;
  clientProfile?: DefaultHostedChatRuntimeCreationOptions["clientProfile"];
  conversationId?: string;
  userId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  availableSkillIds?: string[];
  publishParentRunEvents?: DefaultHostedChatRuntimeCreationOptions["publishParentRunEvents"];
  availableToolNames?: string[];
};

export type CreateDefaultHostedChatRuntimeContextInput = {
  options: DefaultHostedChatRuntimeCreationOptions;
  modelId: string;
};

export type DefaultHostedChatRuntimeSystemRefreshInput = {
  taskContext: DefaultHostedChatRuntimeTaskContext;
  liveProjectSteering: NonNullable<DefaultHostedChatRuntimeCreationOptions["liveProjectSteering"]>;
  toolAssembly: HostedChatRuntimeToolAssemblyResult;
};

export type DefaultHostedChatRuntimeSteeringMutationInput = {
  mutation: ProjectSteeringMutationResult;
  taskContext: DefaultHostedChatRuntimeTaskContext;
};

export type DefaultHostedChatRuntimeProjectSwitchInput = {
  projectId: string;
  taskContext: DefaultHostedChatRuntimeTaskContext;
};

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
    projectId: input.options.projectId ?? "",
    branchId: input.options.branchId ?? null,
    model: input.modelId,
    clientProfile: input.options.clientProfile,
    conversationId: input.options.conversationId,
    userId: input.options.userId,
    parentRunId: input.options.parentRunId,
    parentMessageId: input.options.parentMessageId,
    availableSkillIds: input.options.availableSkillIds,
    publishParentRunEvents: input.options.publishParentRunEvents,
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

  return {
    id: "veryfront-hosted-runtime",
    model: input.modelId,
    system: input.toolAssembly.systemInstructions,
    tools: input.toolAssembly.runtimeTools,
    remoteTools: input.toolAssembly.remoteToolSources,
    allowedRemoteTools: input.toolAssembly.compatibleRemoteToolNames,
    maxSteps: input.options.maxSteps ?? 50,
    resolveModelTransport: ({ resolvedModel }) => {
      const providerOptions = resolveVeryfrontCloudThinkingProviderOptions(
        resolvedModel,
        input.options.thinking,
      );
      return providerOptions ? { providerOptions } : {};
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
