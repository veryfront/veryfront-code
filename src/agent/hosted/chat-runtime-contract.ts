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
import type { ToolExposureCheckpoint } from "../runtime/tool-exposure.ts";
import type { ProviderReplayCheckpoint } from "../runtime/provider-replay.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";
import type { ResolvedSkillSelectorPolicy } from "#veryfront/skill/selector.ts";

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
    billableInputTokens?: number;
    billableOutputTokens?: number;
    costUsd?: number;
    providerInputCostUsd?: number;
    providerOutputCostUsd?: number;
    providerCostUsd?: number;
    veryfrontInputChargeUsd?: number;
    veryfrontOutputChargeUsd?: number;
    veryfrontChargeUsd?: number;
    veryfrontBilledUsd?: number;
    costCredits?: number;
    costSource?: "gateway" | "missing" | "partial";
    billingMode?: "direct" | "deferred";
    usageCaptureStatus?: "complete" | "partial" | "missing";
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
  skillSelectorPolicy?: ResolvedSkillSelectorPolicy;
  environmentContext?: string;
  initialProjectInstructions?: string;
  initialSkills?: RuntimeSkillDefinition[];
};

/** Submitted form_input result carried across hosted runtime continuations. */
export type HostedSubmittedFormInputResult = {
  values: Record<string, unknown>;
  inputRequestId: string;
};

/** Runtime target kind carried by hosted project-agent runs. */
export type HostedChatRuntimeTargetKind = "main_branch" | "environment" | "preview_branch";

/** Options accepted by hosted chat runtime creation. */
export type HostedChatRuntimeCreationOptions<TRuntimeAgentDefinition, TThinkingConfig> = {
  projectId: string | null;
  projectSlug?: string;
  branchId?: string | null;
  runtimeTargetKind?: HostedChatRuntimeTargetKind | null;
  runtimeTargetEnvironmentId?: string | null;
  authToken: string;
  /** @internal Verified run-scoped gateway credential, never copied to public config. */
  inferenceAuthToken?: string;
  instructions: string | ChatSystemMessage[];
  runId?: string;
  agentId?: string;
  model?: string;
  temperature?: number;
  maxSteps?: number;
  maxOutputTokens?: number;
  allowedTools?: string[];
  /**
   * Tool names the agent configuration denied explicitly (`false` entries).
   * They must never be re-added by runtime-essential tool preservation.
   */
  deniedTools?: string[];
  /**
   * Integration tools the control plane resolved for this run. Verified before
   * it reaches here, and used only to widen the Veryfront API MCP allowlist.
   */
  serverResolvedIntegrationToolNames?: readonly string[];
  /** Provider-native selection kept separate from local and MCP tool bindings. */
  allowedProviderTools?: string[];
  /**
   * Marks `allowedTools` as config-derived (no request-level override):
   * skill runtime infrastructure is preserved for empty selectors and skill
   * delegation stays available for empty and non-empty configured sets.
   */
  includeRuntimeEssentialToolsWhenEmpty?: boolean;
  allowDelegation?: boolean;
  thinking?: TThinkingConfig;
  conversationId?: string;
  parentRunId?: string;
  parentMessageId?: string;
  availableSkillIds?: string[];
  skillSelectorPolicy?: ResolvedSkillSelectorPolicy;
  /** Per-run skill id -> discovered SKILL.md source path (owner-aware catalog). */
  skillSourcePaths?: Readonly<Record<string, string>>;
  publishParentRunEvents?: (events: ConversationRunEvent[]) => Promise<void>;
  clientProfile?: RuntimeClientProfile | null;
  liveProjectSteering?: HostedChatRuntimeProjectSteering<TRuntimeAgentDefinition>;
  submittedFormInputResult?: HostedSubmittedFormInputResult;
  /** @internal Latest private checkpoint loaded from trusted run state. */
  serverResolvedToolExposureCheckpoint?: ToolExposureCheckpoint;
  /** @internal Verified provider replay state for persisted assistant turns. */
  serverResolvedProviderReplayCheckpoints?: readonly ProviderReplayCheckpoint[];
  /** @internal Durable assistant message id for emitted provider replay state. */
  providerReplayCheckpointMessageId?: string;
  /** @internal Persists private provider replay state outside model messages. */
  persistProviderReplayCheckpoint?: (
    checkpoint: ProviderReplayCheckpoint,
  ) => void | Promise<void>;
  /** @internal Fail closed when a hosted durable run cannot persist provider replay state. */
  requireProviderReplayCheckpointPersistence?: true;
  /** @internal Persists private checkpoint state outside model messages. */
  persistToolExposureCheckpoint?: (
    checkpoint: ToolExposureCheckpoint,
  ) => void | Promise<void>;
  /** @internal Fail closed when a trusted hosted durable run cannot persist exposure state. */
  requireToolExposureCheckpointPersistence?: true;
};
