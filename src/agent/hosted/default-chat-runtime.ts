import { type HostedTaskInput, resolveHostedTaskInput } from "./task-input.ts";
import { captureHostedPlatformDependencyExecution } from "./platform-dependency-credential.ts";
import { sealToolPlatformDependencies } from "#veryfront/tool/factory.ts";
import { getToolResultReaderReservedToolSlots } from "../runtime/tool-result-context.ts";
import { inheritFrameworkSkillLoader } from "#veryfront/skill/loader-provenance.ts";
import { inheritHostedChildInferenceAuthority } from "./inference-credential.ts";
import {
  type HostToolSet,
  type RemoteMCPToolSourceConfig,
  type RemoteToolSource,
  type ToolExecutionContext,
  type ToolSet,
} from "#veryfront/tool";
import {
  hasTrustedHostToolProvenance,
  inheritTrustedHostToolProvenance,
} from "#veryfront/tool/host-tool-provenance.ts";
import { runWithRequestContextAsync, serverLogger } from "#veryfront/utils";
import {
  runWithoutRequestContext as runWithoutProjectRequestContext,
  runWithRequestContext as runWithProjectRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  canVeryfrontCloudCatalogRefuse,
  currentVeryfrontCloudCatalogScopeKey,
  resolveVeryfrontCloudModelId,
  resolveVeryfrontCloudModelThinking,
  resolveVeryfrontCloudReasoningOption,
  resolveVeryfrontCloudThinkingProviderOptions,
} from "#veryfront/provider/veryfront-cloud/model-catalog.ts";
import { loadVeryfrontCloudModelCatalog } from "#veryfront/provider/veryfront-cloud/shared.ts";
import {
  runWithVeryfrontCloudContext,
  runWithVeryfrontCloudContextAsync,
  type VeryfrontCloudContext,
} from "#veryfront/provider/veryfront-cloud/context.ts";
import { createEphemeralAgentWithRuntimeOptions } from "../factory.ts";
import type { AgentRuntimeInternalOptions } from "../runtime/index.ts";
import {
  attachRuntimeObservationWriterLiveness,
  createRuntimeObservationCapability,
  revokeRuntimeObservationWriterCapability,
} from "#veryfront/runtime/runtime-observation-carrier.ts";
import { getHostedAgentPauseCreationOptions } from "./manual-pause-credential.ts";
import {
  inheritRuntimeProviderSchemaHiddenTool,
  markRuntimeLocalTool,
} from "../runtime/local-tool.ts";
import {
  isVeryfrontCloudRuntimeModel,
  type ProviderToolSchemaTarget,
  resolveProviderToolSchemaTarget,
  resolveRuntimeModel,
} from "../runtime/model-resolution.ts";
import { getProviderNativeToolNames } from "../runtime/provider-native-tool-inventory.ts";
import { isLoadSkillToolName } from "../runtime/skill-policy-enforcement.ts";
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
import {
  buildInteractiveVeryfrontCloudRuntimeInstructions,
  resolveHostedRuntimeSkillLoaderToolName,
} from "./cloud-runtime-system-messages.ts";
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
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import { flattenSystemInstructions } from "../runtime/tool-inventory.ts";
import {
  appendProjectDefinitionBootstrap,
  type HostedProjectDefinitionBootstrapPolicy,
  projectDefinitionSelection,
  readHostedProjectDefinitionBootstrap,
} from "./project-definition-bootstrap.ts";

const apply = Reflect.apply;
const arraySome = Array.prototype.some;
const stringTrim = String.prototype.trim;
const TypeErrorConstructor = TypeError;
const objectEntries = Object.entries;
const objectSetPrototypeOf = Object.setPrototypeOf;

function mapOwnRecord<TInput, TOutput>(
  input: Record<string, TInput>,
  mapper: (name: string, value: TInput) => TOutput,
): Record<string, TOutput> {
  const entries = apply(objectEntries, Object, [input]) as Array<[string, TInput]>;
  const output: Record<string, TOutput> = {};
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index];
    if (entry === undefined) continue;
    defineOwnDataProperty(
      output,
      entry[0],
      mapper(entry[0], entry[1]),
      { enumerable: true, configurable: true, writable: true },
    );
  }
  return output;
}

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
  rootRunId?: string;
  taskInput?: HostedTaskInput;
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
  /**
   * Experimental deployment-owned policy for a bounded project definition
   * index. Ignored unless `projectDefinitionBootstrapEnabled` is true.
   */
  projectDefinitionBootstrap?: HostedProjectDefinitionBootstrapPolicy;
  /**
   * Experimental switch captured from the service environment at bootstrap
   * (VERYFRONT_EXPERIMENTAL_PROJECT_DEFINITION_BOOTSTRAP="1"). Default off.
   */
  projectDefinitionBootstrapEnabled?: boolean;
  projectDefinitionBootstrapSignal?: AbortSignal;
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
  input: CreateDefaultHostedChatRuntimeContextInput & { taskInput: HostedTaskInput | undefined },
): DefaultHostedChatRuntimeTaskContext {
  return {
    authToken: input.options.authToken,
    runId: input.options.runId,
    rootRunId: input.options.rootRunId,
    taskInput: input.taskInput,
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

/** @internal Share steering invalidation with facaded runtime preparation. */
export function incrementSteeringRevision(context: HostedRuntimeStateResolverContext): void {
  context.steeringRevision = (context.steeringRevision ?? 0) + 1;
}

async function buildToolAssembly(
  input: CreateDefaultHostedChatRuntimeOptions & {
    taskContext: DefaultHostedChatRuntimeTaskContext;
    cloudContext: VeryfrontCloudContext;
    providerNativeToolNames: readonly string[];
    toolSchemaTarget: ProviderToolSchemaTarget;
  },
): Promise<HostedChatRuntimeToolAssemblyResult> {
  const liveProjectSteering = input.options.liveProjectSteering;
  const runtimeObservationWriterCapability = input.options.runtimeObservationWriterCapability;
  attachRuntimeObservationWriterLiveness(runtimeObservationWriterCapability, () => {
    if (input.taskContext.projectId !== input.options.projectId) {
      throw new Error("Runtime observation writer project scope is no longer active");
    }
  });
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
          skills: apply(arraySome, modelVisibleToolNames, [isLoadSkillToolName])
            ? liveProjectSteering.initialSkills ?? []
            : [],
          availableToolNames: modelVisibleToolNames,
          skillLoaderToolName: resolveHostedRuntimeSkillLoaderToolName(modelVisibleToolNames),
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
    toolLoading: input.options.toolLoading,
    bootstrapTools: input.options.bootstrapTools,
    knowledge: input.options.knowledge,
    providerNativeToolNames: input.providerNativeToolNames,
    toolSchemaTarget: input.toolSchemaTarget,
    reservedToolSlots: getToolResultReaderReservedToolSlots(input.options.toolResultContext),
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
        revokeRuntimeObservationWriterCapability(runtimeObservationWriterCapability);
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

/** @internal Shared runtime construction after transport-free tool assembly. */
export type PreparedHostedRuntimeAgentOptions = {
  /** Internal caller identity for a separately prepared trusted project runtime. */
  runtimeAgentId?: string;
  options: Omit<DefaultHostedChatRuntimeCreationOptions, "authToken">;
  taskContext: HostedRuntimeStateResolverContext;
  toolAssembly: HostedChatRuntimeToolAssemblyResult;
  modelId: string;
  /** Runtime route resolved by trusted preparation; the catalog model id stays canonical. */
  runtimeModelId?: string;
  sourceIntegrationPolicy: SourceIntegrationPolicyManifest;
  refreshSystem?: () => Promise<AgentSystem> | AgentSystem;
};

function resolveRuntimeAgentId(agentId: string | undefined): string {
  return agentId && apply(stringTrim, agentId, []) ? agentId : "veryfront-hosted-runtime";
}

function createRuntimeAgentConfig(input: PreparedHostedRuntimeAgentOptions): AgentConfig {
  const liveProjectSteering = input.options.liveProjectSteering;
  const refreshSystem = input.refreshSystem;

  const runtimeTools = mapOwnRecord(
    input.toolAssembly.runtimeTools,
    (_toolName, runtimeTool) => markRuntimeLocalTool(runtimeTool),
  );
  const resolveHostedRuntimeState = createHostedRuntimeStateResolver({
    taskContext: input.taskContext,
    refreshSystem,
  });
  const runtimeConfig: RuntimeToolFilterConfig = {
    id: input.runtimeAgentId ?? resolveRuntimeAgentId(input.options.agentId),
    model: input.runtimeModelId ?? input.modelId,
    system: input.toolAssembly.systemMessages ?? input.toolAssembly.systemInstructions,
    tools: runtimeTools,
    __vfToolLoadingMode: input.toolAssembly.toolLoadingMode,
    ...(input.options.maxOutputTokensExplicit === false &&
        input.options.maxOutputTokens !== undefined
      ? { __vfMaxOutputTokensCeiling: input.options.maxOutputTokens }
      : {}),
    ...(input.options.toolLoading !== undefined ? { toolLoading: input.options.toolLoading } : {}),
    // Authored startup tools are already merged into the bootstrap names above.
    // A form continuation resumes a turn whose startup load is already in
    // history, and its tool assembly withholds every skill loader.
    ...(input.options.bootstrapSkill !== undefined &&
        input.taskContext.submittedFormInputResult === undefined
      ? { bootstrapSkill: input.options.bootstrapSkill }
      : {}),
    ...(input.options.toolResultContext !== undefined
      ? { toolResultContext: input.options.toolResultContext }
      : {}),
    ...(input.options.knowledge !== undefined ? { knowledge: input.options.knowledge } : {}),
    providerTools: input.toolAssembly.providerToolNames,
    __vfToolBootstrapNames: input.toolAssembly.modelVisibleToolNames,
    ...(input.toolAssembly.toolSchemaTarget === undefined
      ? {}
      : { __vfToolSchemaTarget: input.toolAssembly.toolSchemaTarget }),
    // Assembly consumed the authored startup tools; the runtime's provider
    // capping pass (for example after exposing veryfront__get_tool_result) must keep them.
    ...(input.options.bootstrapTools !== undefined
      ? { __vfRetainedBootstrapToolNames: input.options.bootstrapTools }
      : {}),
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
    ...(input.options.parallelToolCalls === undefined
      ? {}
      : { parallelToolCalls: input.options.parallelToolCalls }),
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
      remoteToolSource: input.toolAssembly.researchArtifactRemoteToolSource ??
        input.toolAssembly.remoteToolSources[0],
    }),
  };
  objectSetPrototypeOf(runtimeConfig, null);
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
  // The run's catalog is named by its non-secret scope key, so model reads in
  // project code use the catalog the run loaded without holding its credential.
  const catalogScopeKey = runWithVeryfrontCloudContext(
    input.cloudContext,
    currentVeryfrontCloudCatalogScopeKey,
  );
  const publicCloudContext: VeryfrontCloudContext = {
    apiBaseUrl: input.cloudContext.apiBaseUrl,
    projectSlug: input.cloudContext.projectSlug,
    serviceLayer: input.cloudContext.serviceLayer,
    billingGroupId: input.cloudContext.billingGroupId,
    billingGroupUsed: input.cloudContext.billingGroupUsed,
    ...(catalogScopeKey ? { catalogScopeKey } : {}),
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

/** @internal Bound tool results and sanitize errors without trusted provenance. */
export function scopeHostedRuntimeToolResults(tools: ToolSet): ToolSet {
  return mapOwnRecord(
    tools,
    (_toolName, tool) => {
      const execute = tool.execute;
      const preserveTrustedError = hasTrustedHostToolProvenance(tool);
      const scopedTool = inheritRuntimeProviderSchemaHiddenTool(
        tool,
        inheritTrustedHostToolProvenance(
          tool,
          inheritFrameworkSkillLoader(tool, {
            ...tool,
            execute: async (toolInput: unknown, context?: ToolExecutionContext) => {
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
        ),
      );
      return sealToolPlatformDependencies(scopedTool);
    },
  );
}

/** @internal Scope local tool execution and sanitize errors without trusted provenance. */
export function scopeHostedRuntimeTools(input: {
  tools: ToolSet;
  taskContext: DefaultHostedChatRuntimeTaskContext;
  cloudContext: VeryfrontCloudContext;
}): ToolSet {
  const scopedTools = scopeHostedRuntimeToolResults(input.tools);
  return mapOwnRecord(
    scopedTools,
    (_toolName, tool) => {
      const scopedTool = inheritRuntimeProviderSchemaHiddenTool(
        tool,
        inheritTrustedHostToolProvenance(
          tool,
          inheritFrameworkSkillLoader(tool, {
            ...tool,
            execute: (toolInput: unknown, context?: ToolExecutionContext) =>
              withoutHostedCredentials({
                taskContext: input.taskContext,
                cloudContext: input.cloudContext,
                operation: () => apply(tool.execute, tool, [toolInput, context]),
              }),
          }),
        ),
      );
      return sealToolPlatformDependencies(scopedTool);
    },
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

/** Longest a run waits for the served catalog before resolving a short model alias. */
const CATALOG_ALIAS_MAX_WAIT_MS = 3_000;

/** Create default hosted chat runtime. */
export async function createDefaultHostedChatRuntime(
  input: CreateDefaultHostedChatRuntimeOptions,
  runtimeOptions: AgentRuntimeInternalOptions = {},
): Promise<HostedChatRuntimeCreationResult> {
  const taskInput = resolveHostedTaskInput(input.options.taskInput, input.options);
  const runWithPlatformDependencies = captureHostedPlatformDependencyExecution();
  const effectiveRunEventWriterCapability = getActiveHostedRunEventWriterCapability();
  return await runWithEffectiveSourceIntegrationPolicy(
    input.sourceIntegrationPolicy,
    async () => {
      const cloudContext = createCloudContext({
        config: input.config,
        options: input.options,
      });
      // A short model alias resolves through the served catalog. It is loaded
      // and read under the run's own credentials and project, the same scope
      // the run's later model reads use.
      const catalogLoaded = await runWithVeryfrontCloudContextAsync(
        cloudContext,
        () => loadVeryfrontCloudModelCatalog({ maxWaitMs: CATALOG_ALIAS_MAX_WAIT_MS }),
      );
      const modelId = runWithVeryfrontCloudContext(
        cloudContext,
        () => resolveVeryfrontCloudModelId(input.options.model),
      );
      const runtimeModelId = runWithVeryfrontCloudContext(
        cloudContext,
        () => resolveRuntimeModel(modelId),
      );
      const taskContext = input.createTaskContext
        ? input.createTaskContext({ options: input.options, modelId })
        : createDefaultTaskContext({ options: input.options, modelId, taskInput });
      inheritHostedChildInferenceAuthority(taskContext, input.options);
      // The id is normalized, so hosted identity comes from the run's routing,
      // read with the run's credentials and served catalog.
      const providerNativeToolNames = runWithVeryfrontCloudContext(
        cloudContext,
        () =>
          getProviderNativeToolNames({
            model: modelId,
            hosted: isVeryfrontCloudRuntimeModel(modelId),
          }),
      );
      // Preselection caps tools by the limit the run's model is converted with.
      // The model settles against a fresh catalog: a load that timed out or
      // answered from a stale entry still refreshes before dispatch, so
      // preselection then assumes the strictest wire limit.
      const toolSchemaTarget = runWithVeryfrontCloudContext(
        cloudContext,
        () =>
          resolveProviderToolSchemaTarget(modelId, {
            catalogSettled: catalogLoaded && canVeryfrontCloudCatalogRefuse(),
          }),
      );
      const cleanup = input.cleanup ?? (() => Promise.resolve());

      try {
        const toolAssembly = await runWithHostedRunEventWriterCapability(
          effectiveRunEventWriterCapability,
          () =>
            buildToolAssembly({
              ...input,
              taskContext,
              cloudContext,
              providerNativeToolNames,
              toolSchemaTarget,
            }),
        );
        const selection = projectDefinitionSelection(taskContext);
        const lookupToolName = "veryfront__lookup_project_definitions";
        const lookupToolGranted =
          toolAssembly.trustedPlatformRemoteToolNames?.includes(lookupToolName) === true &&
          toolAssembly.availableToolNames.includes(lookupToolName);
        const definitionIndex = input.projectDefinitionBootstrap &&
            input.projectDefinitionBootstrapEnabled === true && selection && lookupToolGranted &&
            taskContext.projectId && taskContext.agentId
          ? await readHostedProjectDefinitionBootstrap({
            policy: input.projectDefinitionBootstrap,
            projectId: taskContext.projectId,
            agentId: taskContext.agentId,
            ...(taskContext.runId === undefined ? {} : { runId: taskContext.runId }),
            authToken: taskContext.authToken,
            apiUrl: input.config.apiUrl,
            selection,
            signal: input.projectDefinitionBootstrapSignal ?? new AbortController().signal,
          })
          : null;
        const definitionProjectId = taskContext.projectId;
        const definitionAgentId = taskContext.agentId;
        const effectiveToolAssembly = definitionIndex
          ? (() => {
            const system = appendProjectDefinitionBootstrap(
              toolAssembly.systemMessages ?? toolAssembly.systemInstructions,
              definitionIndex,
            );
            return {
              ...toolAssembly,
              systemMessages: system,
              systemInstructions: flattenSystemInstructions(system),
            };
          })()
          : toolAssembly;
        const refreshSystem = input.refreshSystem;
        const liveProjectSteering = input.options.liveProjectSteering;
        const runtimeAgent = runWithVeryfrontCloudContext(
          cloudContext,
          () =>
            createPreparedHostedRuntimeAgent({
              runtimeAgentId: resolveRuntimeAgentId(taskContext.agentId),
              options: input.options,
              taskContext,
              toolAssembly: effectiveToolAssembly,
              modelId,
              runtimeModelId,
              sourceIntegrationPolicy: input.sourceIntegrationPolicy,
              ...(refreshSystem && liveProjectSteering
                ? {
                  refreshSystem: async () => {
                    const refreshed = await refreshSystem({
                      taskContext,
                      liveProjectSteering,
                      toolAssembly: effectiveToolAssembly,
                    });
                    // Keep the index only while the run still targets the same source view.
                    const currentSelection = projectDefinitionSelection(taskContext);
                    return definitionIndex && taskContext.projectId === definitionProjectId &&
                        taskContext.agentId === definitionAgentId && currentSelection &&
                        selection &&
                        currentSelection.sourceTargetKind === selection.sourceTargetKind &&
                        currentSelection.targetBranchId === selection.targetBranchId &&
                        currentSelection.targetEnvironmentId === selection.targetEnvironmentId
                      ? appendProjectDefinitionBootstrap(refreshed, definitionIndex)
                      : refreshed;
                  },
                }
                : {}),
            }, runtimeOptions),
        );

        return {
          runtimeKind: "framework",
          modelId,
          cleanup,
          agent: createHostedChatRuntimeAgentAdapter({
            runtimeAgent,
            sourceIntegrationPolicy: input.sourceIntegrationPolicy,
            runId: taskContext.runId,
            rootRunId: input.options.rootRunId,
            taskInput,
            agentId: taskContext.agentId,
            conversationId: taskContext.conversationId,
            projectId: taskContext.projectId,
            projectSlug: taskContext.projectSlug,
            ...(input.options.maxOutputTokensExplicit === false
              ? {}
              : { maxOutputTokens: input.options.maxOutputTokens }),
            resolveProjectContext: () => ({
              ...(taskContext.projectId ? { projectId: taskContext.projectId } : {}),
              ...(taskContext.projectSlug ? { projectSlug: taskContext.projectSlug } : {}),
            }),
            runStream: (operation) =>
              runWithPlatformDependencies(() =>
                runWithDefaultHostedRequestContext({
                  taskContext,
                  cloudContext,
                  operation,
                })
              ),
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

/** @internal Construct from explicit runtime state; no private transport or credential defaults. */
export function createPreparedHostedRuntimeAgent(
  input: PreparedHostedRuntimeAgentOptions,
  runtimeOptions: AgentRuntimeInternalOptions,
) {
  const resolvedRuntimeOptions = {
    ...runtimeOptions,
    preserveToolCatalog: true,
    manualPause: runtimeOptions.manualPause ?? getHostedAgentPauseCreationOptions(input.options),
    modelCallThinking: runtimeOptions.modelCallThinking ?? input.options.thinking,
    runtimeObservationCapability: runtimeOptions.runtimeObservationCapability ??
      createRuntimeObservationCapability(),
    ...(input.options.serverResolvedResumeToolCall
      ? { resumeToolCall: input.options.serverResolvedResumeToolCall }
      : {}),
  };
  objectSetPrototypeOf(resolvedRuntimeOptions, null);
  return createEphemeralAgentWithRuntimeOptions(
    createRuntimeAgentConfig(input),
    resolvedRuntimeOptions,
  );
}
