import type { ChatFinishReason } from "#veryfront/chat/protocol.ts";
import type {
  ChatSystemMessage,
  ChatUiMessage,
  ChatUiMessageChunk,
  MessageMetadata,
} from "../../chat/types.ts";
import type { AgentRuntimeMessage } from "../runtime/message-adapter.ts";
import type { ConversationRunEvent } from "../conversation/run-events.ts";
import type { RuntimeClientProfile } from "../runtime/client-profile.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";

/** Public API contract for hosted chat runtime finish part. */
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

/** Event emitted for hosted chat runtime on finish. */
export type HostedChatRuntimeOnFinishEvent<TMessageMetadata = MessageMetadata> = {
  messages: Array<ChatUiMessage<TMessageMetadata>>;
  isContinuation: boolean;
  responseMessage: ChatUiMessage<TMessageMetadata>;
  isAborted: boolean;
  finishReason: ChatFinishReason;
};

/** Options accepted by hosted chat runtime to UI message stream. */
export type HostedChatRuntimeToUiMessageStreamOptions<TMessageMetadata = MessageMetadata> = {
  sendReasoning?: boolean;
  originalMessages?: Array<ChatUiMessage<TMessageMetadata>>;
  generateMessageId?: () => string;
  onError?: (error: unknown) => string;
  onFinish?: (event: HostedChatRuntimeOnFinishEvent<TMessageMetadata>) => void | Promise<void>;
  messageMetadata?: (input: { part: HostedChatRuntimeFinishPart }) => TMessageMetadata | undefined;
};

/** Input payload for hosted chat runtime stream. */
export type HostedChatRuntimeStreamInput = {
  messages: AgentRuntimeMessage[];
  abortSignal: AbortSignal;
};

/** Result returned from hosted chat runtime stream. */
export type HostedChatRuntimeStreamResult<TMessageMetadata = MessageMetadata> = {
  steps: PromiseLike<readonly unknown[]>;
  toUIMessageStream: (
    options?: HostedChatRuntimeToUiMessageStreamOptions<TMessageMetadata>,
  ) => AsyncIterable<ChatUiMessageChunk<TMessageMetadata>>;
};

/** Public API contract for hosted chat runtime agent. */
export type HostedChatRuntimeAgent<TMessageMetadata = MessageMetadata> = {
  stream: (
    input: HostedChatRuntimeStreamInput,
  ) => Promise<HostedChatRuntimeStreamResult<TMessageMetadata>>;
};

/** Result returned from hosted chat runtime creation. */
export type HostedChatRuntimeCreationResult<TMessageMetadata = MessageMetadata> = {
  runtimeKind: "framework";
  agent: HostedChatRuntimeAgent<TMessageMetadata>;
  modelId: string;
  cleanup: () => Promise<void>;
};

/** Public API contract for hosted chat runtime project steering. */
export type HostedChatRuntimeProjectSteering<TRuntimeAgentDefinition> = {
  agent: TRuntimeAgentDefinition;
  environmentContext?: string;
  initialProjectInstructions?: string;
  initialSkills?: RuntimeSkillDefinition[];
};

/** Options accepted by hosted chat runtime creation. */
export type HostedChatRuntimeCreationOptions<TRuntimeAgentDefinition, TThinkingConfig> = {
  projectId: string | null;
  branchId?: string | null;
  authToken: string;
  instructions: string | ChatSystemMessage[];
  runId?: string;
  agentId?: string;
  model?: string;
  temperature?: number;
  maxSteps?: number;
  allowedTools?: string[];
  allowDelegation?: boolean;
  thinking?: TThinkingConfig;
  conversationId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  availableSkillIds?: string[];
  /** Per-run skill id -> discovered SKILL.md source path (owner-aware catalog). */
  skillSourcePaths?: Readonly<Record<string, string>>;
  publishParentRunEvents?: (events: ConversationRunEvent[]) => Promise<void>;
  clientProfile?: RuntimeClientProfile | null;
  liveProjectSteering?: HostedChatRuntimeProjectSteering<TRuntimeAgentDefinition>;
};
