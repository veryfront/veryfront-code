import {
  type HostToolSet,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolExecutionContext,
  type ToolSet,
} from "#veryfront/tool";
import { hasTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { runWithRequestContextAsync, serverLogger } from "#veryfront/utils";
import {
  runWithoutRequestContext as runWithoutProjectRequestContext,
  runWithRequestContext as runWithProjectRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { resolveModel } from "#veryfront/provider";
import { runWithVeryfrontCloudInferenceCredential } from "#veryfront/provider/veryfront-cloud/provider.ts";
import {
  runWithVeryfrontCloudContext,
  runWithVeryfrontCloudContextAsync,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { agent, createAgentWithInferenceCredential } from "../factory.ts";
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
  getActiveHostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import {
  type HostedChatRuntimeToolAssemblyResult,
  type HostedHostToolPolicy,
  prepareConfigDerivedHostedChatRuntimeToolAssembly,
  type PrepareHostedChatRuntimeToolAssemblyInput,
} from "./chat-runtime-tool-assembly.ts";
import type { AgentServiceMcpServerConfig } from "../service/mcp-server-config.ts";
import { buildInteractiveVeryfrontCloudRuntimeInstructions } from "./cloud-runtime-system-messages.ts";
import {
  createHostedRuntimeStateResolver,
  type HostedRuntimeStateResolverContext,
} from "./runtime-state-resolver.ts";
import type { ProjectSteeringMutationResult } from "../project/steering-mutation.ts";
import type {
  RuntimeAgentMarkdownDefinition,
  RuntimeAgentThinkingConfig,
} from "../runtime/agent-definition.ts";
import type { AgentConfig, AgentSystem } from "../types.ts";
import type { RuntimeToolFilterConfig } from "../runtime/runtime-tool-config.ts";
import type { SourceIntegrationPolicyManifest } from "#veryfront/integrations/source-policy.ts";
import { runWithEffectiveSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

const apply = Reflect.apply;
const TypeErrorConstructor = TypeError;

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
  projectSlug?: string;
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
  skillSelectorPolicy?: DefaultHostedChatRuntimeCreationOptions["skillSelectorPolicy"];
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
  projectSlug?: string;
  taskContext: DefaultHostedChatRuntimeTaskContext;
};

/** Options accepted by create default hosted chat runtime. */
export type CreateDefaultHostedChatRuntimeOptions = {
  options: DefaultHostedChatRuntimeCreationOptions;
  /** Service-owned authorization ceiling applied to Framework host tools. */
  hostToolPolicy?: HostedHostToolPolicy;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  config: DefaultHostedChatRuntimeConfig;
  buildLocalTools: (
    taskContext: DefaultHostedChatRuntimeTaskContext,
  ) => HostToolSet | Promise<HostToolSet>;
  cleanup?: () => Promise<void>;
  createTaskContext?: (
    input: CreateDefaultHostedChatRuntimeContextInput,
  ) => DefaultHostedChatRuntimeTaskContext;
  refreshSystem?: (
    input: DefaultHostedChatRuntimeSystemRefreshInput,
  ) => Promise<AgentSystem> | AgentSystem;
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
    projectSlug: input.options.projectSlug,
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
    skillSelectorPolicy: input.options.skillSelectorPolicy,
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
    cloudContext: VeryfrontCloudContext;
  },
): Promise<HostedChatRuntimeToolAssemblyResult> {
  const liveProjectSteering = input.options.liveProjectSteering;
  const localTools = await input.buildLocalTools(input.taskContext);
  const toolAssembly = await prepareConfigDerivedHostedChatRuntimeToolAssembly({
    taskContext: input.taskContext,
    instructions: input.options.instructions,
    ...(liveProjectSteering === undefined ? {} : {
      renderInstructions: (modelVisibleToolNames: readonly string[]) =>
        buildInteractiveVeryfrontCloudRuntimeInstructions({
          agentConfig: liveProjectSteering.agent,
          projectId: input.taskContext.projectId,
          branchId: input.taskContext.branchId,
          environmentContext: liveProjectSteering.environmentContext,
          instructions: liveProjectSteering.initialProjectInstructions ?? "",
          skills: modelVisibleToolNames.includes("load_skill")
            ? liveProjectSteering.initialSkills ?? []
            : [],
          availableToolNames: modelVisibleToolNames,
        }),
    }),
    localTools,
    hostToolPolicy: input.hostToolPolicy,
    apiUrl: input.config.apiUrl,
    apiMcpUrl: input.config.apiMcpUrl,
    studioMcpUrl: input.config.studioMcpUrl,
    mcpServers: input.config.mcpServers,
    conversationId: input.options.conversationId,
    allowedToolNames: input.options.allowedTools ?? null,
    ...(input.options.deniedTools !== undefined
      ? { deniedToolNames: input.options.deniedTools }
      : {}),
    ...(input.options.serverResolvedIntegrationToolNames !== undefined
      ? {
        serverResolvedIntegrationToolNames: input.options.serverResolvedIntegrationToolNames,
      }
      : {}),
    allowedProviderToolNames: input.options.allowedProviderTools,
    includeRuntimeEssentialToolsWhenEmpty: input.options.includeRuntimeEssentialToolsWhenEmpty,
    sourceProviderToolNames: input.options.liveProjectSteering?.agent.providerTools,
    projectScopedRemoteToolOptions: input.projectScopedRemoteToolOptions,
    createRemoteToolSource: input.createRemoteToolSource,
    traceLocalTools: input.traceLocalTools,
    preloadLatestConversationUserText: input.preloadLatestConversationUserText,
    sourceIntegrationPolicy: input.sourceIntegrationPolicy,
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
    onStudioProjectSwitch: async (projectId, confirmedProject) => {
      const changed = await input.onStudioProjectSwitch?.({
        projectId,
        ...(confirmedProject?.projectSlug === undefined
          ? {}
          : { projectSlug: confirmedProject.projectSlug }),
        taskContext: input.taskContext,
      });
      if (changed) {
        incrementSteeringRevision(input.taskContext);
      }
    },
  });
  return {
    ...toolAssembly,
    runtimeTools: scopeHostedRuntimeTools({
      tools: toolAssembly.runtimeTools,
      taskContext: input.taskContext,
      cloudContext: input.cloudContext,
    }),
  };
}

function createRuntimeAgentConfig(input: {
  options: DefaultHostedChatRuntimeCreationOptions;
  taskContext: DefaultHostedChatRuntimeTaskContext;
  toolAssembly: HostedChatRuntimeToolAssemblyResult;
  modelId: string;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
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
  const resolveHostedRuntimeState = createHostedRuntimeStateResolver({
    taskContext: input.taskContext,
    refreshSystem,
  });
  const runtimeConfig: RuntimeToolFilterConfig = {
    id: "veryfront-hosted-runtime",
    model: input.modelId,
    system: input.toolAssembly.systemMessages ?? input.toolAssembly.systemInstructions,
    tools: runtimeTools,
    __vfToolLoadingMode: input.toolAssembly.toolLoadingMode,
    providerTools: input.toolAssembly.providerToolNames,
    __vfRemoteToolSources: input.toolAssembly.remoteToolSources,
    __vfAllowedRemoteTools: input.toolAssembly.compatibleRemoteToolNames,
    __vfSourceIntegrationPolicy: input.sourceIntegrationPolicy,
    __vfToolExposureCheckpoint: input.options.serverResolvedToolExposureCheckpoint,
    __vfProviderReplayCheckpoints: input.options.serverResolvedProviderReplayCheckpoints,
    __vfProviderReplayCheckpointMessageId: input.options.providerReplayCheckpointMessageId,
    __vfPersistProviderReplayCheckpoint: input.options.persistProviderReplayCheckpoint,
    __vfProviderReplayCheckpointPersistenceRequired:
      input.options.requireProviderReplayCheckpointPersistence === true,
    __vfPersistToolExposureCheckpoint: input.options.persistToolExposureCheckpoint,
    __vfToolExposureCheckpointPersistenceRequired:
      input.options.requireToolExposureCheckpointPersistence === true,
    ...(liveProjectSteering === undefined ? {} : { __vfPreassembledSkillContext: true }),
    temperature: input.options.temperature,
    maxSteps: input.options.maxSteps ?? 50,
    resolveModelTransport: ({ resolvedModel }) => {
      const languageModel = input.options.inferenceAuthToken
        ? runWithVeryfrontCloudInferenceCredential(
          input.options.inferenceAuthToken,
          () => resolveModel(resolvedModel),
        )
        : undefined;
      const thinking = input.options.thinking ??
        resolveVeryfrontCloudModelThinking(resolvedModel);
      const providerOptions = resolveVeryfrontCloudThinkingProviderOptions(
        resolvedModel,
        thinking,
      );
      const reasoning = resolveVeryfrontCloudReasoningOption(resolvedModel, thinking);
      return providerOptions || reasoning || languageModel
        ? { ...(languageModel ? { model: languageModel } : {}), providerOptions, reasoning }
        : {};
    },
    resolveRuntimeState: async ({ structuredSystem, system, ...request }) => {
      const result = await resolveHostedRuntimeState({
        ...request,
        system,
        ...(structuredSystem === undefined ? {} : { structuredSystem }),
      });
      return typeof result.system === "string"
        ? { system: result.system, context: result.context }
        : { structuredSystem: result.structuredSystem, context: result.context };
    },
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
    projectSlug: input.options.projectSlug,
    serviceLayer: "cloud",
  };
}

function withoutHostedCredentials<TResult>(input: {
  taskContext: DefaultHostedChatRuntimeTaskContext;
  cloudContext: VeryfrontCloudContext;
  operation: () => Promise<TResult>;
}): Promise<TResult> {
  const publicCloudContext: VeryfrontCloudContext = {
    apiBaseUrl: input.cloudContext.apiBaseUrl,
    projectSlug: input.cloudContext.projectSlug,
    serviceLayer: input.cloudContext.serviceLayer,
    billingGroupId: input.cloudContext.billingGroupId,
    billingGroupUsed: input.cloudContext.billingGroupUsed,
  };
  const runWithPublicCloudContext = () =>
    runWithVeryfrontCloudContextAsync(publicCloudContext, input.operation);
  if (!input.taskContext.projectSlug) {
    return runWithoutProjectRequestContext(runWithPublicCloudContext);
  }
  return runWithProjectRequestContext(
    {
      projectSlug: input.taskContext.projectSlug,
      projectId: input.taskContext.projectId || undefined,
      token: "",
      productionMode: false,
    },
    runWithPublicCloudContext,
  );
}

function snapshotHostedToolResult(result: unknown): unknown {
  if (result === undefined) return undefined;
  const snapshot = snapshotBoundedJsonValue(result);
  if (!snapshot.success) {
    throw new TypeError("Hosted project tool result must be a bounded JSON value");
  }
  return snapshot.value;
}

/** @internal Scope local tool execution and sanitize errors without trusted provenance. */
export function scopeHostedRuntimeTools(input: {
  tools: ToolSet;
  taskContext: DefaultHostedChatRuntimeTaskContext;
  cloudContext: VeryfrontCloudContext;
}): ToolSet {
  return Object.fromEntries(
    Object.entries(input.tools).map(([toolName, tool]) => {
      const execute = tool.execute;
      const preserveTrustedError = hasTrustedHostToolProvenance(tool);
      return [
        toolName,
        {
          ...tool,
          execute: (toolInput: unknown, context?: ToolExecutionContext) =>
            withoutHostedCredentials({
              taskContext: input.taskContext,
              cloudContext: input.cloudContext,
              operation: async () => {
                try {
                  return snapshotHostedToolResult(
                    await apply(execute, tool, [toolInput, context]),
                  );
                } catch (error) {
                  if (preserveTrustedError) throw error;
                  throw new TypeErrorConstructor("Hosted project tool execution failed");
                }
              },
            }),
        },
      ];
    }),
  );
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
    projectSlug: input.taskContext.projectSlug,
    userId: input.taskContext.userId,
    conversationId: input.taskContext.conversationId,
  };
  return runWithRequestContextAsync(
    requestContext,
    () => {
      const runWithCloudContext = () =>
        runWithVeryfrontCloudContextAsync(input.cloudContext, input.operation);
      if (!input.taskContext.projectSlug) {
        return runWithCloudContext();
      }
      return runWithProjectRequestContext(
        {
          projectSlug: input.taskContext.projectSlug,
          projectId: input.taskContext.projectId || undefined,
          token: input.taskContext.authToken,
          productionMode: false,
        },
        runWithCloudContext,
      );
    },
  );
}

/** Create default hosted chat runtime. */
export async function createDefaultHostedChatRuntime(
  input: CreateDefaultHostedChatRuntimeOptions,
): Promise<HostedChatRuntimeCreationResult> {
  const effectiveRunEventWriterCapability = getActiveHostedRunEventWriterCapability();
  return await runWithEffectiveSourceIntegrationPolicy(
    input.sourceIntegrationPolicy,
    async () => {
      const modelId = resolveVeryfrontCloudModelId(input.options.model);
      const cloudContext = createCloudContext({
        config: input.config,
        options: input.options,
      });
      const taskContext = input.createTaskContext
        ? input.createTaskContext({ options: input.options, modelId })
        : createDefaultTaskContext({ options: input.options, modelId });
      const cleanup = input.cleanup ?? (() => Promise.resolve());

      try {
        const toolAssembly = await runWithHostedRunEventWriterCapability(
          effectiveRunEventWriterCapability,
          () => buildToolAssembly({ ...input, taskContext, cloudContext }),
        );
        const runtimeAgentConfig = createRuntimeAgentConfig({
          options: input.options,
          taskContext,
          toolAssembly,
          modelId,
          sourceIntegrationPolicy: input.sourceIntegrationPolicy,
          refreshSystem: input.refreshSystem,
        });
        const runtimeAgent = runWithVeryfrontCloudContext(
          cloudContext,
          () =>
            input.options.inferenceAuthToken
              ? createAgentWithInferenceCredential(
                runtimeAgentConfig,
                input.options.inferenceAuthToken,
              )
              : agent(runtimeAgentConfig),
        );

        return {
          runtimeKind: "framework",
          modelId,
          cleanup,
          agent: createHostedChatRuntimeAgentAdapter({
            runtimeAgent,
            sourceIntegrationPolicy: input.sourceIntegrationPolicy,
            runId: taskContext.runId,
            agentId: taskContext.agentId,
            conversationId: taskContext.conversationId,
            projectId: taskContext.projectId,
            projectSlug: taskContext.projectSlug,
            maxOutputTokens: input.options.maxOutputTokens,
            resolveProjectContext: () => ({
              ...(taskContext.projectId ? { projectId: taskContext.projectId } : {}),
              ...(taskContext.projectSlug ? { projectSlug: taskContext.projectSlug } : {}),
            }),
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
                ...(taskContext.conversationId
                  ? { conversation_id: taskContext.conversationId }
                  : {}),
              });
            },
          }),
        };
      } catch (error) {
        try {
          await cleanup();
        } catch (cleanupError) {
          input.logger?.warn("Hosted chat runtime cleanup failed after setup error", {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        }
        throw error;
      }
    },
  );
}
