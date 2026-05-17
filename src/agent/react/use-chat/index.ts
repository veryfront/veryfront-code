/**
 * useChat Hook - Public API
 *
 * Complete chat state management with zero UI.
 * Build any interface you want.
 */

export { useChat } from "#veryfront/agent/react/use-chat/use-chat.ts";
export type {
  BranchInfo,
  BrowserInferenceStatus,
  ChatDynamicToolPart,
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatStepPart,
  ChatTextPart,
  ChatToolPart,
  ChatToolResultPart,
  ChatToolState,
  InferenceMode,
  OnToolCallArg,
  ToolOutput,
  UseChatOptions,
  UseChatResult,
} from "#veryfront/agent/react/use-chat/types.ts";
export type {
  ChatFinishReason,
  ChatStreamEvent,
} from "#veryfront/agent/react/use-chat/stream-protocol.ts";
