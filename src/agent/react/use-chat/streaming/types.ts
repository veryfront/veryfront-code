import type { ChatMessage, ChatMessagePart, ChatToolState, OnToolCallArg } from "../types.ts";

export interface StreamingCallbacks {
  onMessage: (message: ChatMessage) => void;
  onData: (data: unknown) => void;
  onUpdate?: (
    parts: ChatMessagePart[],
    messageId: string,
    metadata?: ChatMessage["metadata"],
  ) => void;
  onToolCall?: (arg: OnToolCallArg) => void;
}

export interface StreamingToolCall {
  toolCallId: string;
  toolName: string;
  inputText: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  state: ChatToolState;
  /** Whether this is a dynamic tool (MCP, user-defined, etc.) */
  dynamic?: boolean;
  /** Whether the provider executed this tool instead of the client/runtime. */
  providerExecuted?: boolean;
}

export interface StreamingReasoning {
  id: string;
  text: string;
  signature?: string;
  redactedData?: string;
  isComplete: boolean;
}

export interface TextBlock {
  text: string;
  state: "streaming" | "done";
  order: number | null;
}

export interface OrderedStep {
  index: number;
  isComplete: boolean;
  order: number;
}

export type OrderedToolCall = StreamingToolCall & { order: number };
export type OrderedReasoning = StreamingReasoning & { order: number };
export type OrderedMessagePart = { order: number; part: ChatMessagePart };
