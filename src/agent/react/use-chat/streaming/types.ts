/**
 * Streaming Types
 *
 * Type definitions for streaming response handling.
 */

import type { OnToolCallArg, ToolState, UIMessage, UIMessagePart } from "../types.ts";

/**
 * Streaming response callbacks - AI SDK v5 compatible
 */
export interface StreamingCallbacks {
  onMessage: (message: UIMessage) => void;
  onData: (data: unknown) => void;
  onUpdate?: (parts: UIMessagePart[], messageId: string) => void;
  onToolCall?: (arg: OnToolCallArg) => void;
}

/**
 * Internal tool tracking during streaming
 */
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

/**
 * Internal reasoning tracking during streaming
 */
export interface StreamingReasoning {
  id: string;
  text: string;
  isComplete: boolean;
}

/**
 * Text block tracking during streaming
 */
export interface TextBlock {
  text: string;
  state: "streaming" | "done";
  order: number | null;
}

/**
 * Ordered streaming tool call (with order for proper sequencing)
 */
export type OrderedToolCall = StreamingToolCall & { order: number };

/**
 * Ordered streaming reasoning (with order for proper sequencing)
 */
export type OrderedReasoning = StreamingReasoning & { order: number };
