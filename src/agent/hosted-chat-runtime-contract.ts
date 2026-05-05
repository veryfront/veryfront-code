import type { ChatFinishReason } from "../chat/protocol.ts";
import type {
  ChatSystemMessage,
  ChatUiMessage,
  ChatUiMessageChunk,
  MessageMetadata,
} from "../chat/types.ts";
import type { AgentRuntimeMessage } from "./agent-runtime-message-adapter.ts";
import type { ConversationRunEvent } from "./conversation-run-events.ts";
import type { RuntimeClientProfile } from "./runtime-client-profile.ts";
import type { RuntimeSkillDefinition } from "./runtime-skill-metadata.ts";

export type HostedChatRuntimeFinishPart = {
  type: "finish";
  finishReason: ChatFinishReason;
  rawFinishReason?: string;
  totalUsage: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    reasoningTokens?: number;
    cachedInputTokens?: number;
    inputTokenDetails?: {
      noCacheTokens?: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
    };
    outputTokenDetails?: {
      textTokens?: number;
      reasoningTokens?: number;
    };
  };
};

export type HostedChatRuntimeOnFinishEvent<TMessageMetadata = MessageMetadata> = {
  messages: Array<ChatUiMessage<TMessageMetadata>>;
  isContinuation: boolean;
  responseMessage: ChatUiMessage<TMessageMetadata>;
  isAborted: boolean;
  finishReason: ChatFinishReason;
};

export type HostedChatRuntimeToUiMessageStreamOptions<TMessageMetadata = MessageMetadata> = {
  sendReasoning?: boolean;
  originalMessages?: Array<ChatUiMessage<TMessageMetadata>>;
  generateMessageId?: () => string;
  onError?: (error: unknown) => string;
  onFinish?: (event: HostedChatRuntimeOnFinishEvent<TMessageMetadata>) => void | Promise<void>;
  messageMetadata?: (input: { part: HostedChatRuntimeFinishPart }) => TMessageMetadata | undefined;
};

export type HostedChatRuntimeStreamInput = {
  messages: AgentRuntimeMessage[];
  abortSignal: AbortSignal;
};

export type HostedChatRuntimeStreamResult<TMessageMetadata = MessageMetadata> = {
  steps: PromiseLike<readonly unknown[]>;
  toUIMessageStream: (
    options?: HostedChatRuntimeToUiMessageStreamOptions<TMessageMetadata>,
  ) => AsyncIterable<ChatUiMessageChunk<TMessageMetadata>>;
};

export type HostedChatRuntimeAgent<TMessageMetadata = MessageMetadata> = {
  stream: (
    input: HostedChatRuntimeStreamInput,
  ) => Promise<HostedChatRuntimeStreamResult<TMessageMetadata>>;
};

export type HostedChatRuntimeCreationResult<TMessageMetadata = MessageMetadata> = {
  runtimeKind: "framework";
  agent: HostedChatRuntimeAgent<TMessageMetadata>;
  modelId: string;
  cleanup: () => Promise<void>;
};

export type HostedChatRuntimeProjectSteering<TRuntimeAgentDefinition> = {
  agent: TRuntimeAgentDefinition;
  environmentContext?: string;
  initialProjectInstructions?: string;
  initialSkills?: RuntimeSkillDefinition[];
};

export type HostedChatRuntimeCreationOptions<TRuntimeAgentDefinition, TThinkingConfig> = {
  projectId: string | null;
  branchId?: string | null;
  authToken: string;
  instructions: string | ChatSystemMessage[];
  model?: string;
  maxSteps?: number;
  allowedTools?: string[];
  allowDelegation?: boolean;
  thinking?: TThinkingConfig;
  conversationId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  availableSkillIds?: string[];
  publishParentRunEvents?: (events: ConversationRunEvent[]) => Promise<void>;
  clientProfile?: RuntimeClientProfile | null;
  liveProjectSteering?: HostedChatRuntimeProjectSteering<TRuntimeAgentDefinition>;
};
