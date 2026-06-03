import type {
  ChatRequestContext,
  ChatSystemMessage,
  ChatUiMessage,
} from "#veryfront/chat/types.ts";
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
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";

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
    "emptyConversationPrompt"
  >
  & {
    authToken?: string;
    apiUrl?: string | URL;
    projectId?: string | null;
  };

/** Context for hosted chat runtime preparation root run. */
export type HostedChatRuntimePreparationRootRunContext = {
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
    model?: string;
    thinking?: RuntimeAgentThinkingConfig;
    maxSteps?: number;
  };
  projectId: string | null;
  authToken: string;
  conversationId?: string;
  branchId?: string | null;
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

/** Options accepted by hosted chat execution preparation root run. */
export type HostedChatExecutionPreparationRootRunOptions = Pick<
  PrepareHostedConversationRootRunContextInput,
  | "implementationKind"
  | "persistLatestUserMessageOperation"
  | "missingUserMessageErrorMessage"
  | "onPersistLatestUserMessageFailure"
  | "instrumentation"
>;

/** Input payload for hosted chat execution preparation. */
export type HostedChatExecutionPreparationInput<
  TRuntimeAgentDefinition extends {
    id: string;
    model?: string;
    thinking?: RuntimeAgentThinkingConfig;
    maxSteps?: number;
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
};

/** Result returned from hosted chat execution preparation. */
export type HostedChatExecutionPreparationResult<
  TRuntimeAgentDefinition,
  TRuntimeResult extends HostedChatRuntimeCreationResult,
> = NormalizedHostedChatRequest & {
  rootRunContext: HostedConversationRootRunContext;
  runtime: TRuntimeResult;
  finalMessages: AgentRuntimeMessage[];
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

function mergeSkillLoaderAllowedTools(input: {
  allowedTools: string[] | undefined;
  skills: RuntimeSkillDefinition[];
}): string[] | undefined {
  if (
    !input.allowedTools || input.skills.length === 0 || input.allowedTools.includes("load_skill")
  ) {
    return input.allowedTools;
  }

  return [...input.allowedTools, "load_skill"];
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
  const agentInstructions = input.buildInstructions({
    agentConfig: input.agentConfig,
    projectId: input.projectId,
    branchId: input.branchId,
    environmentContext: input.environmentContext,
    instructions: steering.instructions,
    skills: steering.skills,
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
      ...(runtimeConfig.requestedModel ? { model: runtimeConfig.requestedModel } : {}),
      ...(runtimeConfig.requestedThinking ? { thinking: runtimeConfig.requestedThinking } : {}),
      ...(runtimeConfig.requestedMaxSteps !== undefined
        ? { maxSteps: runtimeConfig.requestedMaxSteps }
        : {}),
      ...(runtimeConfig.effectiveRuntimeOverrides?.allowedTools
        ? {
          allowedTools: mergeSkillLoaderAllowedTools({
            allowedTools: runtimeConfig.effectiveRuntimeOverrides.allowedTools,
            skills: steering.skills,
          }),
        }
        : {}),
      ...(input.request.allowDelegation !== undefined
        ? { allowDelegation: input.request.allowDelegation }
        : {}),
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.rootRunContext?.effectiveParentRunId
        ? { parentRunId: input.rootRunContext.effectiveParentRunId }
        : {}),
      ...(input.rootRunContext?.effectiveParentMessageId
        ? { parentMessageId: input.rootRunContext.effectiveParentMessageId }
        : {}),
      availableSkillIds: steering.skills.map((skill) => skill.id),
      ...(input.rootRunContext?.publishParentRunEvents
        ? { publishParentRunEvents: input.rootRunContext.publishParentRunEvents }
        : {}),
      clientProfile: runtimeConfig.clientProfile,
      liveProjectSteering: buildHostedChatRuntimeProjectSteering({
        agentConfig: input.agentConfig,
        environmentContext: input.environmentContext,
        instructions: steering.instructions,
        skills: steering.skills,
      }),
    },
    steering: {
      ...steering,
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
    environmentContext: normalized.effectiveValidatedContext.environmentContext,
    rootRunContext,
    resolveModelId: input.resolveModelId,
    resolveModelThinking: input.resolveModelThinking,
    fetchSteering: input.fetchSteering,
    buildInstructions: input.buildInstructions,
  });
  const runtime = await input.createRuntime(runtimePreparation.creationOptions);
  const finalMessages = await prepareHostedChatRuntimeMessages(
    normalized.effectiveMessages,
    {
      authToken: input.request.authToken,
      apiUrl: input.apiUrl,
      projectId: input.request.projectId,
    },
  );

  return {
    ...normalized,
    rootRunContext,
    runtime,
    finalMessages,
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
    });
  }
  const authToken = options.authToken;
  const apiUrl = options.apiUrl;

  return await prepareAgentRuntimeMessagesFromUiMessages({
    messages,
    emptyConversationPrompt: options.emptyConversationPrompt,
    resolveFileUrl: ({ uploadId }) =>
      getRuntimeUploadUrl({
        apiUrl,
        authToken,
        uploadId,
        projectId: options.projectId,
      }),
  });
}
