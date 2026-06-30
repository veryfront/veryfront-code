/**
 * Agent React
 *
 * @module agent/react
 */

export { useChat } from "./use-chat/index.ts";
export type {
  BranchInfo,
  ChatDynamicToolPart,
  ChatFinishReason,
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatStepPart,
  ChatStreamEvent,
  ChatTextPart,
  ChatToolPart,
  ChatToolResultPart,
  ChatToolState,
  InferenceMode,
  OnToolCallArg,
  ToolOutput,
  UseChatOptions,
  UseChatResult,
} from "./use-chat/index.ts";

export { useAgent } from "./use-agent.ts";
export type { UseAgentOptions, UseAgentResult } from "./use-agent.ts";

export {
  getAgentPromptSuggestions,
  normalizeAgentMetadataResponse,
  useAgentMetadata,
} from "./use-agent-metadata.ts";
export type {
  AgentMetadata,
  AgentMetadataPromptSuggestion,
  AgentMetadataSuggestion,
  AgentMetadataSuggestions,
  AgentMetadataTaskSuggestion,
  UseAgentMetadataResult,
} from "./use-agent-metadata.ts";

export { useCompletion } from "./use-completion.ts";
export type { UseCompletionOptions, UseCompletionResult } from "./use-completion.ts";

export { useStreaming } from "./use-streaming.ts";
export type { UseStreamingOptions, UseStreamingResult } from "./use-streaming.ts";

export { useVoiceInput } from "./use-voice-input.ts";
export type { UseVoiceInputOptions, UseVoiceInputResult } from "./use-voice-input.ts";
