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
  resolveRuntimeSkillsForAgent,
  type RuntimeSkillDefinition,
} from "../runtime/skill-metadata.ts";
import {
  applyContextBudget,
  type ContextBudgetDiagnostics,
  type ContextBudgetManagerOptions,
  ContextCompactionError,
} from "./context-budget-manager.ts";
import { findSubmittedFormInputResult } from "./form-input-tool.ts";

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
    skills?: true | string[];
  };
  projectId: string | null;
  authToken: string;
  conversationId?: string;
  branchId?: string | null;
  runtimeTargetKind?: ChatRequestContext["runtimeTargetKind"];
  runtimeTargetEnvironmentId?: string | null;
  environmentContext?: string;
  rootRunContext?: HostedChatRuntimePreparationRootRunContext;
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
  environmentContext?: string;
  instructions: string;
  skills: RuntimeSkillDefinition[];
}): HostedChatRuntimeProjectSteering<TRuntimeAgentDefinition> {
  return {
    agent: input.agentConfig,
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
  // The selector controls what the prompt advertises, not what load_skill can
  // resolve. Keep the hosted execution gate aligned with the classic runtime:
  // every owner-visible skill remains loadable by id.
  const loadableSkills = resolveRuntimeSkillsForAgent({
    skills: steering.skills,
    agentId: input.agentConfig.id,
    selector: true,
  });
  const advertisedSkills = resolveRuntimeSkillsForAgent({
    skills: steering.skills,
    agentId: input.agentConfig.id,
    selector: input.agentConfig.skills,
  });
  const agentInstructions = input.buildInstructions({
    agentConfig: input.agentConfig,
    projectId: input.projectId,
    branchId: input.branchId,
    environmentContext: input.environmentContext,
    instructions: steering.instructions,
    skills: advertisedSkills,
  });
  const runtimeConfig = resolveHostedRuntimeRequestConfig({
    request: input.request,
    agentConfig: input.agentConfig,
    resolveModelId: input.resolveModelId,
    resolveModelThinking: input.resolveModelThinking,
  });

  return {
    creationOptions: {
      projectId: input.projectId,
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
      availableSkillIds: loadableSkills.map((skill) => skill.id),
      ...(loadableSkills.some((skill) => skill.sourcePath)
        ? {
          skillSourcePaths: Object.fromEntries(
            loadableSkills
              .filter((skill) => skill.sourcePath)
              .map((skill) => [skill.id, skill.sourcePath as string]),
          ),
        }
        : {}),
      ...(input.rootRunContext?.publishParentRunEvents
        ? { publishParentRunEvents: input.rootRunContext.publishParentRunEvents }
        : {}),
      clientProfile: runtimeConfig.clientProfile,
      liveProjectSteering: buildHostedChatRuntimeProjectSteering({
        agentConfig: input.agentConfig,
        environmentContext: input.environmentContext,
        instructions: steering.instructions,
        skills: advertisedSkills,
      }),
    },
    steering: {
      ...steering,
      skills: advertisedSkills,
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
  });
  const submittedFormInputResult = findSubmittedFormInputResult(normalized.effectiveMessages);
  const historicalToolInputCompactions: HistoricalToolInputCompactionDiagnostic[] = [];
  const finalMessages = await prepareHostedChatRuntimeMessages(
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
