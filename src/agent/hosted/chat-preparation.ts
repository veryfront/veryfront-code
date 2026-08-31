import type {
  ChatRequestContext,
  ChatSystemMessage,
  ChatUiMessage,
} from "#veryfront/chat/types.ts";
import type { HistoricalToolInputCompactionDiagnostic } from "#veryfront/chat/message-prep.ts";
import type { AgentRuntimeMessage } from "../runtime/message-adapter.ts";
import type { ConversationRunEvent } from "../conversation/run-events.ts";
import type {
  HostedChatRuntimeCreationOptions,
  HostedChatRuntimeCreationResult,
  HostedChatRuntimeProjectSteering,
} from "./chat-runtime-contract.ts";
import type { ParsedHostedChatRequest } from "./chat-request-parser.ts";
import {
  type HostedConversationRootRunContext,
  prepareHostedConversationRootRunContext,
  type PrepareHostedConversationRootRunContextInput,
} from "../conversation/root-run-lifecycle.ts";
import {
  prepareAgentRuntimeMessagesFromUiMessages,
  type PrepareAgentRuntimeMessagesFromUiMessagesOptions,
} from "../runtime/message-preparation.ts";
import type { RuntimeAgentThinkingConfig } from "../runtime/agent-definition.ts";
import {
  type ResolvedHostedRuntimeRequestConfig,
  resolveHostedRuntimeRequestConfig,
} from "./runtime-request-config.ts";
import { getRuntimeUploadUrl } from "../runtime/upload-url-client.ts";
import {
  resolveRuntimeSkillSelectorForAgent,
  type RuntimeSkillDefinition,
} from "../runtime/skill-metadata.ts";
import type { ResolvedSkillSelectorPolicy } from "#veryfront/skill/selector.ts";
import {
  applyContextBudget,
  type ContextBudgetDiagnostics,
  type ContextBudgetManagerOptions,
  ContextCompactionError,
} from "./context-budget-manager.ts";
import { findSubmittedFormInputResult } from "./form-input-tool.ts";
import type { ToolExposureCheckpoint } from "../runtime/tool-exposure.ts";
import {
  createProviderReplayCheckpointEvent,
  type ProviderReplayCheckpoint,
} from "#veryfront/agent/runtime/provider-replay.ts";
import {
  createToolExposureCheckpointEvent,
  TOOL_SEARCH_TOOL_NAME,
} from "../runtime/tool-exposure.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type { HostedHostToolPolicy } from "./chat-runtime-tool-assembly.ts";
import {
  createHostedRunEventWriterCapabilityForRequest,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { DURABLE_RUN_EVENT_PERSISTENCE_FAILED } from "#veryfront/errors";

/** Host-owned opt-in for new provider replay checkpoint emission. */
export const PROVIDER_REPLAY_CHECKPOINT_EMISSION_ENV =
  "VERYFRONT_ENABLE_PROVIDER_REPLAY_CHECKPOINT_EMISSION";

/** Return whether the trusted host explicitly enabled private replay checkpoint writes. */
export function isProviderReplayCheckpointEmissionEnabled(
  value: string | undefined = getHostEnv(PROVIDER_REPLAY_CHECKPOINT_EMISSION_ENV),
): boolean {
  return value === "1";
}

/** Request payload for normalized hosted chat. */
export type NormalizedHostedChatRequest = {
  effectiveMessages: ChatUiMessage[];
  effectiveValidatedContext: ChatRequestContext;
  parentMessageId: string | undefined;
};

/** Options accepted by prepare hosted chat runtime messages. */
export type PrepareHostedChatRuntimeMessagesOptions =
  & Pick<
    PrepareAgentRuntimeMessagesFromUiMessagesOptions,
    | "emptyConversationPrompt"
    | "providerOwnedToolNames"
    | "abortSignal"
    | "fileContentFetchTimeoutMs"
    | "historicalToolInputRetention"
  >
  & {
    authToken?: string;
    apiUrl?: string | URL;
    projectId?: string | null;
    providerReplayCheckpointMessageIds?: readonly string[];
  };

/** Context for hosted chat runtime preparation root run. */
export type HostedChatRuntimePreparationRootRunContext = {
  durableRootRun?: HostedConversationRootRunContext["durableRootRun"];
  effectiveParentRunId?: string;
  effectiveParentMessageId?: string;
  publishParentRunEvents?: (events: ConversationRunEvent[]) => Promise<void>;
  durableRunMirror?: ConversationRunChunkMirror | null;
  privateDurableRunMirror?: ConversationRunChunkMirror | null;
};

/** Public API contract for hosted chat runtime preparation steering. */
export type HostedChatRuntimePreparationSteering = {
  instructions: string;
  skills: RuntimeSkillDefinition[];
};

function mergePreservedSourceMessageIds(
  checkpointIds: readonly string[] | undefined,
  retentionIds: readonly string[] | undefined,
): readonly string[] | undefined {
  if (checkpointIds === undefined && retentionIds === undefined) {
    return undefined;
  }
  return [...new Set([...(checkpointIds ?? []), ...(retentionIds ?? [])])];
}

/** Input payload for hosted chat runtime instructions. */
export type HostedChatRuntimeInstructionsInput<TRuntimeAgentDefinition> = {
  agentConfig: TRuntimeAgentDefinition;
  projectId: string | null;
  branchId?: string | null;
  environmentContext?: string;
  instructions: string;
  skills: RuntimeSkillDefinition[];
  availableToolNames?: readonly string[];
};

/** Input payload for hosted chat runtime creation preparation. */
export type HostedChatRuntimeCreationPreparationInput<TRuntimeAgentDefinition> = {
  request: ParsedHostedChatRequest;
  agentConfig: TRuntimeAgentDefinition & {
    id: string;
    model?: string;
    thinking?: RuntimeAgentThinkingConfig;
    maxSteps?: number;
    allowedRemoteTools?: unknown;
    providerTools?: string[];
    tools?: true | string[];
    deniedTools?: string[];
    skills?: true | false | string[];
  };
  projectId: string | null;
  authToken: string;
  conversationId?: string;
  branchId?: string | null;
  runtimeTargetKind?: ChatRequestContext["runtimeTargetKind"];
  runtimeTargetEnvironmentId?: string | null;
  environmentContext?: string;
  rootRunContext?: HostedChatRuntimePreparationRootRunContext;
  /** Trusted checkpoint resolved after hosted service authentication. */
  serverResolvedToolExposureCheckpoint?: ToolExposureCheckpoint;
  /** Verified provider replay state resolved by the authenticated server. */
  serverResolvedProviderReplayCheckpoints?: readonly ProviderReplayCheckpoint[];
  /** Deployment-owned emission decision snapshotted before request-scoped environment setup. */
  providerReplayCheckpointEmissionEnabled?: boolean;
  /** Verified integration tool grant for this run, resolved by the control plane. */
  serverResolvedIntegrationToolNames?: readonly string[];
  /** Service-owned authorization ceiling for Framework host tools. */
  hostToolPolicy?: HostedHostToolPolicy;
  resolveModelId: (modelId: string | undefined) => string | undefined;
  resolveModelThinking?: (
    modelId: string | undefined,
  ) => RuntimeAgentThinkingConfig | undefined;
  fetchSteering: (input: {
    projectId: string | null;
    authToken: string;
    branchId?: string | null;
  }) => Promise<HostedChatRuntimePreparationSteering>;
  buildInstructions: (
    input: HostedChatRuntimeInstructionsInput<TRuntimeAgentDefinition>,
  ) => string | ChatSystemMessage[];
};

/** Result returned from hosted chat runtime creation preparation. */
export type HostedChatRuntimeCreationPreparationResult<TRuntimeAgentDefinition> = {
  creationOptions: HostedChatRuntimeCreationOptions<
    TRuntimeAgentDefinition,
    RuntimeAgentThinkingConfig
  >;
  steering: HostedChatRuntimePreparationSteering & {
    agentInstructions: string | ChatSystemMessage[];
  };
  runtimeConfig: ResolvedHostedRuntimeRequestConfig;
};

function getProviderOwnedToolNames(input: {
  agentConfig: { providerTools?: unknown };
  runtimeConfig: ResolvedHostedRuntimeRequestConfig;
}): string[] {
  const configured = Array.isArray(input.agentConfig.providerTools)
    ? input.agentConfig.providerTools.filter((toolName): toolName is string =>
      typeof toolName === "string" && toolName.length > 0
    )
    : [];
  return [...new Set([...configured, ...input.runtimeConfig.requestedAllowedProviderTools])];
}

async function flushRequiredContextCompactionEvent(
  rootRunContext: HostedConversationRootRunContext,
  eventPayload: ConversationRunEvent,
): Promise<void> {
  if (!rootRunContext.durableRunMirror) {
    throw new ContextCompactionError(
      "Context compaction produced an event but no durable run mirror is available",
    );
  }

  await rootRunContext.durableRunMirror.appendEvents([eventPayload]);
  const snapshot = await rootRunContext.durableRunMirror.flush();
  if (snapshot.disabled || snapshot.pendingEventCount > 0 || snapshot.inFlight) {
    rootRunContext.durableRunMirror.dispose();
    throw new ContextCompactionError(
      "Context compaction event was not durably persisted before model execution",
    );
  }
}

function createDurablePrivateCheckpointPersister<T>(input: {
  rootRunContext: HostedChatRuntimePreparationRootRunContext | undefined;
  createEvent: (checkpoint: T) => ConversationRunEvent;
  missingWriterMessage: string;
  incompleteFlushMessage: string;
}): ((checkpoint: T) => Promise<void>) | undefined {
  const privateDurableRunMirror = input.rootRunContext?.privateDurableRunMirror;
  if (input.rootRunContext?.durableRootRun && !privateDurableRunMirror) {
    return async () => {
      throw DURABLE_RUN_EVENT_PERSISTENCE_FAILED.create({
        detail: input.missingWriterMessage,
      });
    };
  }
  if (!privateDurableRunMirror) return undefined;
  return async (checkpoint) => {
    await privateDurableRunMirror.appendEvents([input.createEvent(checkpoint)]);
    const snapshot = await privateDurableRunMirror.flush();
    if (snapshot.disabled || snapshot.pendingEventCount > 0 || snapshot.inFlight) {
      privateDurableRunMirror.dispose();
      throw DURABLE_RUN_EVENT_PERSISTENCE_FAILED.create({
        detail: input.incompleteFlushMessage,
      });
    }
  };
}

function createDurableToolExposureCheckpointPersister(
  rootRunContext: HostedChatRuntimePreparationRootRunContext | undefined,
): ((checkpoint: ToolExposureCheckpoint) => Promise<void>) | undefined {
  return createDurablePrivateCheckpointPersister({
    rootRunContext,
    createEvent: createToolExposureCheckpointEvent,
    missingWriterMessage:
      "A trusted run-event append token is required to persist a private tool exposure checkpoint",
    incompleteFlushMessage:
      "Tool exposure checkpoint was not durably persisted before model execution",
  });
}

function createDurableProviderReplayCheckpointPersister(
  rootRunContext: HostedChatRuntimePreparationRootRunContext | undefined,
): ((checkpoint: ProviderReplayCheckpoint) => Promise<void>) | undefined {
  return createDurablePrivateCheckpointPersister({
    rootRunContext,
    createEvent: createProviderReplayCheckpointEvent,
    missingWriterMessage:
      "A trusted run-event append token is required to persist a private provider replay checkpoint",
    incompleteFlushMessage:
      "Provider replay checkpoint was not durably persisted before continuation",
  });
}

/** Resolve private provider replay bindings without exposing the host gate to requests. */
export function createProviderReplayCheckpointCreationOptions(
  rootRunContext: HostedChatRuntimePreparationRootRunContext | undefined,
  enabled = isProviderReplayCheckpointEmissionEnabled(),
  existingCheckpoints: readonly ProviderReplayCheckpoint[] = [],
): {
  providerReplayCheckpointMessageId?: string;
  persistProviderReplayCheckpoint?: (
    checkpoint: ProviderReplayCheckpoint,
  ) => void | Promise<void>;
  requireProviderReplayCheckpointPersistence?: true;
} {
  if (!rootRunContext?.durableRootRun) return {};
  const messageId = rootRunContext.durableRootRun.messageId;
  const mustContinueExistingCheckpoint = existingCheckpoints.some((checkpoint) =>
    checkpoint.messageId === messageId
  );
  if (!enabled && !mustContinueExistingCheckpoint) return {};
  return {
    providerReplayCheckpointMessageId: messageId,
    persistProviderReplayCheckpoint: createDurableProviderReplayCheckpointPersister(
      rootRunContext,
    ),
    requireProviderReplayCheckpointPersistence: true,
  };
}

/** Options accepted by hosted chat execution preparation root run. */
export type HostedChatExecutionPreparationRootRunOptions = Pick<
  PrepareHostedConversationRootRunContextInput,
  | "implementationKind"
  | "persistLatestUserMessageOperation"
  | "missingUserMessageErrorMessage"
  | "onPersistLatestUserMessageFailure"
  | "instrumentation"
>;

/** Public API contract for hosted chat context budget logging. */
export type HostedChatContextBudgetLogger = {
  debug?: (message: string, metadata?: Record<string, unknown>) => void;
  error?: (message: string, metadata?: Record<string, unknown>) => void;
};

/** Options accepted by hosted chat context budget management. */
export type HostedChatContextBudgetOptions = ContextBudgetManagerOptions & {
  logger?: HostedChatContextBudgetLogger;
};

/** Input payload for hosted chat execution preparation. */
export type HostedChatExecutionPreparationInput<
  TRuntimeAgentDefinition extends {
    id: string;
    model?: string;
    thinking?: RuntimeAgentThinkingConfig;
    maxSteps?: number;
    allowedRemoteTools?: unknown;
    providerTools?: string[];
    tools?: true | string[];
    deniedTools?: string[];
  },
  TRuntimeResult extends HostedChatRuntimeCreationResult,
> = {
  request: ParsedHostedChatRequest;
  agentConfig: TRuntimeAgentDefinition;
  apiUrl: string | URL;
  abortSignal: AbortSignal;
  rootRun?: HostedChatExecutionPreparationRootRunOptions;
  resolveModelId: (modelId: string | undefined) => string | undefined;
  resolveModelThinking?: (
    modelId: string | undefined,
  ) => RuntimeAgentThinkingConfig | undefined;
  fetchSteering: (input: {
    projectId: string | null;
    authToken: string;
    branchId?: string | null;
  }) => Promise<HostedChatRuntimePreparationSteering>;
  buildInstructions: (
    input: HostedChatRuntimeInstructionsInput<TRuntimeAgentDefinition>,
  ) => string | ChatSystemMessage[];
  createRuntime: (
    options: HostedChatRuntimeCreationOptions<
      TRuntimeAgentDefinition,
      RuntimeAgentThinkingConfig
    >,
  ) => Promise<TRuntimeResult>;
  contextBudget?: HostedChatContextBudgetOptions;
  /** Trusted checkpoint resolved by the authenticated hosted service. */
  serverResolvedToolExposureCheckpoint?: ToolExposureCheckpoint;
  /** Verified provider replay state resolved by the authenticated server. */
  serverResolvedProviderReplayCheckpoints?: readonly ProviderReplayCheckpoint[];
  /** Deployment-owned emission decision snapshotted before request-scoped environment setup. */
  providerReplayCheckpointEmissionEnabled?: boolean;
  /** Verified integration tool grant for this run, resolved by the control plane. */
  serverResolvedIntegrationToolNames?: readonly string[];
  /** Service-owned authorization ceiling for Framework host tools. */
  hostToolPolicy?: HostedHostToolPolicy;
};

/** Result returned from hosted chat execution preparation. */
export type HostedChatExecutionPreparationResult<
  TRuntimeAgentDefinition,
  TRuntimeResult extends HostedChatRuntimeCreationResult,
> = NormalizedHostedChatRequest & {
  rootRunContext: HostedConversationRootRunContext;
  runtime: TRuntimeResult;
  finalMessages: AgentRuntimeMessage[];
  contextBudgetDiagnostics?: ContextBudgetDiagnostics;
  historicalToolInputCompactions?: HistoricalToolInputCompactionDiagnostic[];
  steering: HostedChatRuntimeCreationPreparationResult<
    TRuntimeAgentDefinition
  >["steering"];
  runtimeConfig: ResolvedHostedRuntimeRequestConfig;
};

/** Request payload for normalize parsed hosted chat. */
export function normalizeParsedHostedChatRequest(
  request: ParsedHostedChatRequest,
): NormalizedHostedChatRequest {
  const effectiveMessages = request.messages;
  const validatedContext = request.validatedContext;
  const conversationId = validatedContext.conversationId ?? request.conversationId;
  const effectiveValidatedContext: ChatRequestContext = {
    ...validatedContext,
    projectId: validatedContext.projectId ?? request.projectId,
    branchId: validatedContext.branchId ?? null,
    ...(conversationId ? { conversationId } : {}),
  };

  return {
    effectiveMessages,
    effectiveValidatedContext,
    parentMessageId: effectiveMessages.findLast((message) => message.role === "user")?.id,
  };
}

function buildHostedChatRuntimeProjectSteering<TRuntimeAgentDefinition>(input: {
  agentConfig: TRuntimeAgentDefinition;
  skillSelectorPolicy: ResolvedSkillSelectorPolicy;
  environmentContext?: string;
  instructions: string;
  skills: RuntimeSkillDefinition[];
}): HostedChatRuntimeProjectSteering<TRuntimeAgentDefinition> {
  return {
    agent: input.agentConfig,
    skillSelectorPolicy: input.skillSelectorPolicy,
    ...(input.environmentContext ? { environmentContext: input.environmentContext } : {}),
    ...(input.instructions ? { initialProjectInstructions: input.instructions } : {}),
    ...(input.skills.length > 0 ? { initialSkills: input.skills } : {}),
  };
}

function resolveInitialModelVisibleToolNames(input: {
  runtimeConfig: ResolvedHostedRuntimeRequestConfig;
  selectedSkills: readonly RuntimeSkillDefinition[];
  hostToolPolicy?: HostedHostToolPolicy;
}): string[] {
  const hostAllow = input.hostToolPolicy === undefined
    ? undefined
    : new Set(input.hostToolPolicy.allow);
  const deniedToolNames = new Set(input.runtimeConfig.deniedToolNames ?? []);
  const isHostAllowed = (toolName: string): boolean =>
    (hostAllow === undefined || hostAllow.has(toolName)) && !deniedToolNames.has(toolName);

  if (input.runtimeConfig.requestedAllowedTools === undefined) {
    return [
      ...(isHostAllowed("form_input") ? ["form_input"] : []),
      ...(input.selectedSkills.length > 0 && isHostAllowed("load_skill") ? ["load_skill"] : []),
      ...(isHostAllowed(TOOL_SEARCH_TOOL_NAME) ? [TOOL_SEARCH_TOOL_NAME] : []),
    ].sort(compareStrings);
  }

  const visibleToolNames = new Set(
    input.runtimeConfig.requestedAllowedTools.filter(isHostAllowed),
  );
  if (
    input.selectedSkills.length > 0 &&
    isHostAllowed("load_skill") &&
    (visibleToolNames.size > 0 || input.runtimeConfig.includeRuntimeEssentialToolsWhenEmpty)
  ) {
    visibleToolNames.add("load_skill");
  }
  return [...visibleToolNames].sort(compareStrings);
}

/** Options accepted by prepare hosted chat runtime creation. */
export async function prepareHostedChatRuntimeCreationOptions<
  TRuntimeAgentDefinition,
>(
  input: HostedChatRuntimeCreationPreparationInput<TRuntimeAgentDefinition>,
): Promise<HostedChatRuntimeCreationPreparationResult<TRuntimeAgentDefinition>> {
  const steering = await input.fetchSteering({
    projectId: input.projectId,
    authToken: input.authToken,
    branchId: input.branchId,
  });
  const skillSelectorSnapshot = resolveRuntimeSkillSelectorForAgent({
    skills: steering.skills,
    agentId: input.agentConfig.id,
    selector: input.agentConfig.skills === false ? [] : input.agentConfig.skills,
  });
  const selectedSkills = skillSelectorSnapshot.definitions;
  const runtimeConfig = resolveHostedRuntimeRequestConfig({
    request: input.request,
    agentConfig: input.agentConfig,
    resolveModelId: input.resolveModelId,
    resolveModelThinking: input.resolveModelThinking,
  });
  const initialModelVisibleToolNames = resolveInitialModelVisibleToolNames({
    runtimeConfig,
    selectedSkills,
    hostToolPolicy: input.hostToolPolicy,
  });
  const promptSkills = initialModelVisibleToolNames.includes("load_skill") ? selectedSkills : [];
  const agentInstructions = input.buildInstructions({
    agentConfig: input.agentConfig,
    projectId: input.projectId,
    branchId: input.branchId,
    environmentContext: input.environmentContext,
    instructions: steering.instructions,
    skills: promptSkills,
    availableToolNames: initialModelVisibleToolNames,
  });
  return {
    creationOptions: {
      projectId: input.projectId,
      ...(input.request.projectSlug ? { projectSlug: input.request.projectSlug } : {}),
      authToken: input.authToken,
      instructions: agentInstructions,
      ...(input.branchId !== undefined ? { branchId: input.branchId } : {}),
      ...(input.runtimeTargetKind !== undefined
        ? { runtimeTargetKind: input.runtimeTargetKind }
        : {}),
      ...(input.runtimeTargetEnvironmentId !== undefined
        ? { runtimeTargetEnvironmentId: input.runtimeTargetEnvironmentId }
        : {}),
      ...(runtimeConfig.requestedModel ? { model: runtimeConfig.requestedModel } : {}),
      ...(runtimeConfig.requestedThinking ? { thinking: runtimeConfig.requestedThinking } : {}),
      ...(runtimeConfig.requestedTemperature !== undefined
        ? { temperature: runtimeConfig.requestedTemperature }
        : {}),
      ...(runtimeConfig.requestedMaxSteps !== undefined
        ? { maxSteps: runtimeConfig.requestedMaxSteps }
        : {}),
      ...(runtimeConfig.requestedMaxOutputTokens !== undefined
        ? { maxOutputTokens: runtimeConfig.requestedMaxOutputTokens }
        : {}),
      ...(runtimeConfig.requestedAllowedTools !== undefined
        ? { allowedTools: runtimeConfig.requestedAllowedTools }
        : {}),
      ...(runtimeConfig.deniedToolNames !== undefined
        ? { deniedTools: runtimeConfig.deniedToolNames }
        : {}),
      allowedProviderTools: runtimeConfig.requestedAllowedProviderTools,
      includeRuntimeEssentialToolsWhenEmpty: runtimeConfig.includeRuntimeEssentialToolsWhenEmpty,
      ...(input.serverResolvedToolExposureCheckpoint
        ? { serverResolvedToolExposureCheckpoint: input.serverResolvedToolExposureCheckpoint }
        : {}),
      ...(input.serverResolvedProviderReplayCheckpoints?.length
        ? {
          serverResolvedProviderReplayCheckpoints: input.serverResolvedProviderReplayCheckpoints,
        }
        : {}),
      ...(input.serverResolvedIntegrationToolNames?.length
        ? { serverResolvedIntegrationToolNames: input.serverResolvedIntegrationToolNames }
        : {}),
      ...(input.request.allowDelegation !== undefined
        ? { allowDelegation: input.request.allowDelegation }
        : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.rootRunContext?.durableRootRun?.runId
        ? { runId: input.rootRunContext.durableRootRun.runId }
        : {}),
      agentId: input.agentConfig.id,
      ...(input.rootRunContext?.effectiveParentRunId
        ? { parentRunId: input.rootRunContext.effectiveParentRunId }
        : {}),
      ...(input.rootRunContext?.effectiveParentMessageId
        ? { parentMessageId: input.rootRunContext.effectiveParentMessageId }
        : {}),
      availableSkillIds: skillSelectorSnapshot.allowedSkillIds,
      skillSelectorPolicy: skillSelectorSnapshot.policy,
      ...(Object.keys(skillSelectorSnapshot.skillSourcePaths).length > 0
        ? {
          skillSourcePaths: skillSelectorSnapshot.skillSourcePaths,
        }
        : {}),
      ...(input.rootRunContext?.publishParentRunEvents
        ? { publishParentRunEvents: input.rootRunContext.publishParentRunEvents }
        : {}),
      ...(input.rootRunContext?.durableRootRun
        ? {
          persistToolExposureCheckpoint: createDurableToolExposureCheckpointPersister(
            input.rootRunContext,
          ),
          ...(input.rootRunContext.privateDurableRunMirror
            ? { requireToolExposureCheckpointPersistence: true as const }
            : {}),
        }
        : {}),
      ...createProviderReplayCheckpointCreationOptions(
        input.rootRunContext,
        input.providerReplayCheckpointEmissionEnabled ??
          isProviderReplayCheckpointEmissionEnabled(),
        input.serverResolvedProviderReplayCheckpoints,
      ),
      clientProfile: runtimeConfig.clientProfile,
      liveProjectSteering: buildHostedChatRuntimeProjectSteering({
        agentConfig: input.agentConfig,
        skillSelectorPolicy: skillSelectorSnapshot.policy,
        environmentContext: input.environmentContext,
        instructions: steering.instructions,
        skills: selectedSkills,
      }),
    },
    steering: {
      ...steering,
      skills: selectedSkills,
      agentInstructions,
    },
    runtimeConfig,
  };
}

/** Prepare hosted chat execution. */
export async function prepareHostedChatExecution<
  TRuntimeAgentDefinition extends {
    id: string;
    model?: string;
    thinking?: RuntimeAgentThinkingConfig;
    maxSteps?: number;
    allowedRemoteTools?: unknown;
    providerTools?: string[];
    tools?: true | string[];
    deniedTools?: string[];
  },
  TRuntimeResult extends HostedChatRuntimeCreationResult,
>(
  input: HostedChatExecutionPreparationInput<
    TRuntimeAgentDefinition,
    TRuntimeResult
  >,
): Promise<
  HostedChatExecutionPreparationResult<TRuntimeAgentDefinition, TRuntimeResult>
> {
  const normalized = normalizeParsedHostedChatRequest(input.request);
  const rootRunEventWriterCapability = input.request.durableRootRun
    ? createHostedRunEventWriterCapabilityForRequest(input.request, {
      apiUrl: input.apiUrl.toString(),
      runId: input.request.durableRootRun.runId,
    })
    : undefined;
  const rootRunContext = await runWithHostedRunEventWriterCapability(
    rootRunEventWriterCapability,
    () =>
      prepareHostedConversationRootRunContext({
        authToken: input.request.authToken,
        apiUrl: input.apiUrl.toString(),
        conversationId: input.request.conversationId,
        projectId: input.request.projectId,
        branchId: normalized.effectiveValidatedContext.branchId,
        agentId: input.agentConfig.id,
        messages: normalized.effectiveMessages,
        parentRunId: input.request.parentRunId,
        parentMessageId: normalized.parentMessageId,
        providedRun: input.request.durableRootRun,
        persistLatestUserMessageBeforeRun: input.request.persistLatestUserMessageBeforeDurableRun,
        ...input.rootRun,
      }, { abortSignal: input.abortSignal }),
  );
  const runtimePreparation = await prepareHostedChatRuntimeCreationOptions({
    request: input.request,
    agentConfig: input.agentConfig,
    projectId: input.request.projectId,
    authToken: input.request.authToken,
    conversationId: input.request.conversationId,
    branchId: normalized.effectiveValidatedContext.branchId,
    runtimeTargetKind: normalized.effectiveValidatedContext.runtimeTargetKind,
    runtimeTargetEnvironmentId: normalized.effectiveValidatedContext.runtimeTargetEnvironmentId,
    environmentContext: normalized.effectiveValidatedContext.environmentContext,
    rootRunContext,
    resolveModelId: input.resolveModelId,
    resolveModelThinking: input.resolveModelThinking,
    fetchSteering: input.fetchSteering,
    buildInstructions: input.buildInstructions,
    serverResolvedToolExposureCheckpoint: input.serverResolvedToolExposureCheckpoint,
    serverResolvedProviderReplayCheckpoints: input.serverResolvedProviderReplayCheckpoints,
    providerReplayCheckpointEmissionEnabled: input.providerReplayCheckpointEmissionEnabled,
    serverResolvedIntegrationToolNames: input.serverResolvedIntegrationToolNames,
    hostToolPolicy: input.hostToolPolicy,
  });
  const submittedFormInputResult = findSubmittedFormInputResult(normalized.effectiveMessages);
  const historicalToolInputCompactions: HistoricalToolInputCompactionDiagnostic[] = [];
  const providerReplayCheckpointMessageIds = input.serverResolvedProviderReplayCheckpoints?.map(
    (checkpoint) => checkpoint.messageId,
  );
  const preparedMessages = await prepareHostedChatRuntimeMessages(
    normalized.effectiveMessages,
    {
      authToken: input.request.authToken,
      apiUrl: input.apiUrl,
      projectId: input.request.projectId,
      providerOwnedToolNames: getProviderOwnedToolNames({
        agentConfig: input.agentConfig,
        runtimeConfig: runtimePreparation.runtimeConfig,
      }),
      abortSignal: input.abortSignal,
      providerReplayCheckpointMessageIds,
      historicalToolInputRetention: {
        diagnostics: historicalToolInputCompactions,
      },
    },
  );
  const finalMessages = preparedMessages;
  if (historicalToolInputCompactions.length > 0) {
    input.contextBudget?.logger?.debug?.("Hosted chat historical tool inputs compacted", {
      toolInputCompactions: historicalToolInputCompactions,
    });
  }
  let budgetedContext: Awaited<ReturnType<typeof applyContextBudget>> | undefined;
  if (input.contextBudget) {
    try {
      budgetedContext = await applyContextBudget(finalMessages, {
        ...input.contextBudget,
        atomicMessageIds: [
          ...new Set([
            ...(input.contextBudget.atomicMessageIds ?? []),
            ...(providerReplayCheckpointMessageIds ?? []),
          ]),
        ],
      });
    } catch (error) {
      input.contextBudget.logger?.error?.("Hosted chat context compaction failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  if (budgetedContext?.eventPayload) {
    input.contextBudget?.logger?.debug?.("Hosted chat context compacted", {
      ...budgetedContext.diagnostics,
      firstKeptEntryId: budgetedContext.eventPayload.firstKeptEntryId,
    });
    await flushRequiredContextCompactionEvent(rootRunContext, budgetedContext.eventPayload);
  } else if (budgetedContext) {
    input.contextBudget?.logger?.debug?.("Hosted chat context compaction skipped", {
      ...budgetedContext.diagnostics,
    });
  }
  const runtime = await runWithHostedRunEventWriterCapability(
    rootRunEventWriterCapability,
    () =>
      input.createRuntime({
        ...runtimePreparation.creationOptions,
        ...(submittedFormInputResult ? { submittedFormInputResult } : {}),
      }),
  );

  return {
    ...normalized,
    rootRunContext,
    runtime,
    finalMessages: budgetedContext?.messages ?? finalMessages,
    contextBudgetDiagnostics: budgetedContext?.diagnostics,
    ...(historicalToolInputCompactions.length > 0 ? { historicalToolInputCompactions } : {}),
    steering: runtimePreparation.steering,
    runtimeConfig: runtimePreparation.runtimeConfig,
  };
}

/** Prepare hosted chat runtime messages. */
export async function prepareHostedChatRuntimeMessages(
  messages: readonly ChatUiMessage[],
  options: PrepareHostedChatRuntimeMessagesOptions = {},
): Promise<AgentRuntimeMessage[]> {
  if (!options.authToken || !options.apiUrl) {
    return await prepareAgentRuntimeMessagesFromUiMessages({
      messages,
      emptyConversationPrompt: options.emptyConversationPrompt,
      providerOwnedToolNames: options.providerOwnedToolNames,
      preserveProviderOwnedToolSourceMessageIds: options.providerReplayCheckpointMessageIds,
      abortSignal: options.abortSignal,
      fileContentFetchTimeoutMs: options.fileContentFetchTimeoutMs,
      historicalToolInputRetention: {
        ...options.historicalToolInputRetention,
        preserveSourceMessageIds: mergePreservedSourceMessageIds(
          options.providerReplayCheckpointMessageIds,
          options.historicalToolInputRetention?.preserveSourceMessageIds,
        ),
      },
    });
  }
  const authToken = options.authToken;
  const apiUrl = options.apiUrl;

  return await prepareAgentRuntimeMessagesFromUiMessages({
    messages,
    emptyConversationPrompt: options.emptyConversationPrompt,
    providerOwnedToolNames: options.providerOwnedToolNames,
    preserveProviderOwnedToolSourceMessageIds: options.providerReplayCheckpointMessageIds,
    abortSignal: options.abortSignal,
    fileContentFetchTimeoutMs: options.fileContentFetchTimeoutMs,
    historicalToolInputRetention: {
      ...options.historicalToolInputRetention,
      preserveSourceMessageIds: mergePreservedSourceMessageIds(
        options.providerReplayCheckpointMessageIds,
        options.historicalToolInputRetention?.preserveSourceMessageIds,
      ),
    },
    resolveFileUrl: ({ uploadId }) =>
      getRuntimeUploadUrl({
        apiUrl,
        authToken,
        uploadId,
        projectId: options.projectId,
      }),
  });
}
