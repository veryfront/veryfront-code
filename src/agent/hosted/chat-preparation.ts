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
import { getProviderNativeToolNames } from "../runtime/provider-native-tool-inventory.ts";
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
import type { ToolExposureCheckpoint, ToolSearchAuthorization } from "../runtime/tool-exposure.ts";
import { createToolExposureCheckpointEvent } from "../runtime/tool-exposure.ts";
import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import {
  applyProviderReplayCheckpoints,
  createProviderReplayCheckpointEvent,
  type ProviderReplayCheckpoint,
  type ProviderReplayCheckpoints,
  resolveProviderReplayProvider,
} from "../runtime/provider-replay.ts";
import type { RuntimeProviderBlock } from "#veryfront/provider/runtime-loader.ts";
import type { ProviderReplayPersistenceInput } from "../runtime/input-utils.ts";

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
  /** Trusted value resolved after hosted service authentication. */
  serverResolvedToolSearchAuthorization?: ToolSearchAuthorization;
  /** Trusted checkpoint resolved after hosted service authentication. */
  serverResolvedToolExposureCheckpoint?: ToolExposureCheckpoint;
  /** Trusted provider replay history resolved from a verified server envelope. */
  serverResolvedProviderReplayCheckpoints?: ProviderReplayCheckpoints;
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

function getProviderToolNames(agentConfig: { providerTools?: unknown }): string[] {
  return Array.isArray(agentConfig.providerTools)
    ? agentConfig.providerTools.filter((toolName): toolName is string =>
      typeof toolName === "string" && toolName.length > 0
    )
    : [];
}

function getProviderOwnedToolNames(input: {
  agentConfig: { providerTools?: unknown };
  runtimeConfig: ResolvedHostedRuntimeRequestConfig;
}): string[] {
  const providerNativeToolNames = new Set(
    getProviderNativeToolNames({ model: input.runtimeConfig.requestedModel }),
  );
  const requestedProviderToolNames = input.runtimeConfig.requestedAllowedProviderTools.filter(
    (toolName) => providerNativeToolNames.has(toolName),
  );

  return [
    ...new Set([
      ...getProviderToolNames(input.agentConfig),
      ...requestedProviderToolNames,
    ]),
  ];
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

function createDurableToolExposureCheckpointPersister(
  rootRunContext: HostedChatRuntimePreparationRootRunContext | undefined,
): ((checkpoint: ToolExposureCheckpoint) => Promise<void>) | undefined {
  const privateDurableRunMirror = rootRunContext?.privateDurableRunMirror;
  if (rootRunContext?.durableRootRun && !privateDurableRunMirror) {
    return async () => {
      throw new Error(
        "A trusted run-event append token is required to persist a private tool exposure checkpoint",
      );
    };
  }
  if (!privateDurableRunMirror) return undefined;
  return async (checkpoint) => {
    await privateDurableRunMirror.appendEvents([createToolExposureCheckpointEvent(checkpoint)]);
    const snapshot = await privateDurableRunMirror.flush();
    if (snapshot.disabled || snapshot.pendingEventCount > 0 || snapshot.inFlight) {
      privateDurableRunMirror.dispose();
      throw new Error(
        "Tool exposure checkpoint was not durably persisted before model execution",
      );
    }
  };
}

function createDurableProviderReplayPersister(input: {
  rootRunContext: HostedChatRuntimePreparationRootRunContext | undefined;
  provider: ProviderReplayCheckpoint["provider"] | undefined;
  restoredCheckpoints: readonly ProviderReplayCheckpoint[];
}): ((input: ProviderReplayPersistenceInput) => Promise<void>) | undefined {
  const durableRootRun = input.rootRunContext?.durableRootRun;
  if (!durableRootRun || !input.provider) return undefined;
  const durableRunMirror = input.rootRunContext?.privateDurableRunMirror;
  if (!durableRunMirror) {
    return async () => {
      throw new Error(
        "A trusted run-event append token is required to persist provider replay state",
      );
    };
  }
  const restoredCheckpoint = input.restoredCheckpoints.find((checkpoint) =>
    checkpoint.messageId === durableRootRun.messageId &&
    checkpoint.provider === input.provider
  );
  const providerBlocks: RuntimeProviderBlock[] = [
    ...(restoredCheckpoint?.providerBlocks ?? []),
  ];
  const providerBlockPositions = [
    ...(restoredCheckpoint?.providerBlockPositions ?? []),
  ];
  let totalPartCount = restoredCheckpoint?.totalPartCount ?? 0;
  return async (replay) => {
    if (
      replay.providerBlocks.length === 0 ||
      replay.providerBlocks.some((block) => block.provider !== input.provider) ||
      replay.providerBlockPositions.length !== replay.providerBlocks.length
    ) {
      throw new Error("Provider replay blocks did not match the active hosted provider");
    }
    providerBlocks.push(...replay.providerBlocks);
    providerBlockPositions.push(
      ...replay.providerBlockPositions.map((position) => position + totalPartCount),
    );
    totalPartCount += replay.totalPartCount;
    await durableRunMirror.appendEvents([
      createProviderReplayCheckpointEvent({
        version: 1,
        messageId: durableRootRun.messageId,
        provider: input.provider!,
        providerBlocks: [...providerBlocks],
        providerBlockPositions: [...providerBlockPositions],
        totalPartCount,
      }),
    ]);
    const snapshot = await durableRunMirror.flush();
    if (snapshot.disabled || snapshot.pendingEventCount > 0 || snapshot.inFlight) {
      durableRunMirror.dispose();
      throw new Error(
        "Provider replay checkpoint was not durably persisted before model continuation",
      );
    }
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
  /** Trusted value resolved by the authenticated hosted service. */
  serverResolvedToolSearchAuthorization?: ToolSearchAuthorization;
  /** Trusted checkpoint resolved by the authenticated hosted service. */
  serverResolvedToolExposureCheckpoint?: ToolExposureCheckpoint;
  /** Trusted provider replay history resolved from a verified server envelope. */
  serverResolvedProviderReplayCheckpoints?: ProviderReplayCheckpoints;
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
  const agentInstructions = input.buildInstructions({
    agentConfig: input.agentConfig,
    projectId: input.projectId,
    branchId: input.branchId,
    environmentContext: input.environmentContext,
    instructions: steering.instructions,
    skills: selectedSkills,
  });
  const runtimeConfig = resolveHostedRuntimeRequestConfig({
    request: input.request,
    agentConfig: input.agentConfig,
    resolveModelId: input.resolveModelId,
    resolveModelThinking: input.resolveModelThinking,
  });
  const persistProviderReplayBlocks = createDurableProviderReplayPersister({
    rootRunContext: input.rootRunContext,
    provider: resolveProviderReplayProvider(runtimeConfig.requestedModel),
    restoredCheckpoints: input.serverResolvedProviderReplayCheckpoints ?? [],
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
      allowedProviderTools: runtimeConfig.requestedAllowedProviderTools,
      includeRuntimeEssentialToolsWhenEmpty: runtimeConfig.includeRuntimeEssentialToolsWhenEmpty,
      ...(input.serverResolvedToolSearchAuthorization
        ? {
          serverResolvedToolSearchAuthorization: input.serverResolvedToolSearchAuthorization,
        }
        : {}),
      ...(input.serverResolvedToolExposureCheckpoint
        ? { serverResolvedToolExposureCheckpoint: input.serverResolvedToolExposureCheckpoint }
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
          ...(persistProviderReplayBlocks ? { persistProviderReplayBlocks } : {}),
        }
        : {}),
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
  const rootRunContext = await prepareHostedConversationRootRunContext(
    {
      authToken: input.request.authToken,
      runEventAppendToken: input.request.runEventAppendToken,
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
    },
    { abortSignal: input.abortSignal },
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
    serverResolvedToolSearchAuthorization: input.serverResolvedToolSearchAuthorization,
    serverResolvedToolExposureCheckpoint: input.serverResolvedToolExposureCheckpoint,
    serverResolvedProviderReplayCheckpoints: input.serverResolvedProviderReplayCheckpoints,
  });
  const submittedFormInputResult = findSubmittedFormInputResult(normalized.effectiveMessages);
  const historicalToolInputCompactions: HistoricalToolInputCompactionDiagnostic[] = [];
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
      historicalToolInputRetention: {
        diagnostics: historicalToolInputCompactions,
      },
    },
  );
  const finalMessages = applyProviderReplayCheckpoints(
    preparedMessages,
    input.serverResolvedProviderReplayCheckpoints ?? [],
    resolveProviderReplayProvider(runtimePreparation.runtimeConfig.requestedModel),
  );
  if (historicalToolInputCompactions.length > 0) {
    input.contextBudget?.logger?.debug?.("Hosted chat historical tool inputs compacted", {
      toolInputCompactions: historicalToolInputCompactions,
    });
  }
  let budgetedContext: Awaited<ReturnType<typeof applyContextBudget>> | undefined;
  if (input.contextBudget) {
    try {
      budgetedContext = await applyContextBudget(finalMessages, input.contextBudget);
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
  const runtime = await input.createRuntime({
    ...runtimePreparation.creationOptions,
    ...(submittedFormInputResult ? { submittedFormInputResult } : {}),
  });

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
      abortSignal: options.abortSignal,
      fileContentFetchTimeoutMs: options.fileContentFetchTimeoutMs,
      historicalToolInputRetention: options.historicalToolInputRetention,
    });
  }
  const authToken = options.authToken;
  const apiUrl = options.apiUrl;

  return await prepareAgentRuntimeMessagesFromUiMessages({
    messages,
    emptyConversationPrompt: options.emptyConversationPrompt,
    providerOwnedToolNames: options.providerOwnedToolNames,
    abortSignal: options.abortSignal,
    fileContentFetchTimeoutMs: options.fileContentFetchTimeoutMs,
    historicalToolInputRetention: options.historicalToolInputRetention,
    resolveFileUrl: ({ uploadId }) =>
      getRuntimeUploadUrl({
        apiUrl,
        authToken,
        uploadId,
        projectId: options.projectId,
      }),
  });
}
