/**
 * Streaming Types
 *
 * Type definitions for streaming response handling.
 *
 * @module ai/react/hooks/use-chat/streaming/types
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
  /** Order for preserving stream sequence */
  order: number;
}

/**
 * Internal reasoning tracking during streaming
 */
export interface StreamingReasoning {
  id: string;
  text: string;
  isComplete: boolean;
  /** Order for preserving stream sequence */
  order: number;
}

/**
 * Internal text block tracking during streaming
 */
export interface StreamingTextBlock {
  text: string;
  state: "streaming" | "done";
  order: number | null;
}
