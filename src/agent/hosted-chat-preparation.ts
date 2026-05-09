import type {
  ChatRequestContext,
  ChatSystemMessage,
  ChatUiMessage,
} from "#veryfront/chat/types.ts";
import type { AgentRuntimeMessage } from "./agent-runtime-message-adapter.ts";
import type { ConversationRunEvent } from "./conversation-run-events.ts";
import type {
  HostedChatRuntimeCreationOptions,
  HostedChatRuntimeProjectSteering,
} from "./hosted-chat-runtime-contract.ts";
import type { ParsedHostedChatRequest } from "./hosted-chat-request-parser.ts";
import {
  prepareAgentRuntimeMessagesFromUiMessages,
  type PrepareAgentRuntimeMessagesFromUiMessagesOptions,
} from "./runtime-message-preparation.ts";
import type { RuntimeAgentThinkingConfig } from "./runtime-agent-definition.ts";
import {
  type ResolvedHostedRuntimeRequestConfig,
  resolveHostedRuntimeRequestConfig,
} from "./hosted-runtime-request-config.ts";
import { getRuntimeUploadUrl } from "./runtime-upload-url-client.ts";
import type { RuntimeSkillDefinition } from "./runtime-skill-metadata.ts";

export type NormalizedHostedChatRequest = {
  effectiveMessages: ChatUiMessage[];
  effectiveValidatedContext: ChatRequestContext;
  parentMessageId: string | undefined;
};

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

export type HostedChatRuntimePreparationRootRunContext = {
  effectiveParentRunId?: string;
  effectiveParentMessageId?: string;
  publishParentRunEvents?: (events: ConversationRunEvent[]) => Promise<void>;
};

export type HostedChatRuntimePreparationSteering = {
  instructions: string;
  skills: RuntimeSkillDefinition[];
};

export type HostedChatRuntimeInstructionsInput<TRuntimeAgentDefinition> = {
  agentConfig: TRuntimeAgentDefinition;
  projectId: string | null;
  branchId?: string | null;
  environmentContext?: string;
  instructions: string;
  skills: RuntimeSkillDefinition[];
};

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
        ? { allowedTools: runtimeConfig.effectiveRuntimeOverrides.allowedTools }
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
