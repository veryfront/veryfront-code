import type { OnToolCallArg, ToolState, UIMessage, UIMessagePart } from "../types.ts";

export interface StreamingCallbacks {
  onMessage: (message: UIMessage) => void;
  onData: (data: unknown) => void;
  onUpdate?: (parts: UIMessagePart[], messageId: string) => void;
  onToolCall?: (arg: OnToolCallArg) => void;
}

export interface StreamingToolCall {
  toolCallId: string;
  toolName: string;
  inputText: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  state: ToolState;
  /** Whether this is a dynamic tool (MCP, user-defined, etc.) */
  dynamic?: boolean;
}

export interface StreamingReasoning {
  id: string;
  text: string;
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
