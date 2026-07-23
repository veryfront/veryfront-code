/**
 * Text-Generation Runtime Message Types
 *
 * Framework-owned message types for the current text-generation runtime
 * boundary. These describe the subset of message shapes the runtime uses
 * today without exposing SDK-owned message contracts upward.
 */

export interface TextGenerationRuntimeTextPart {
  type: "text";
  text: string;
}

export interface TextGenerationRuntimeFilePart {
  type: "file" | "image";
  mediaType: string;
  url: string;
  filename?: string;
}

export interface TextGenerationRuntimeToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface TextGenerationRuntimeReasoningPart {
  type: "reasoning";
  text?: string;
  signature?: string;
  redactedData?: string;
}

export interface TextGenerationRuntimeProviderToolCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
  supportsDeferredResults?: boolean;
}

export interface TextGenerationRuntimeToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: {
    type: "json";
    value: unknown;
  };
}

export interface TextGenerationRuntimeSystemMessage {
  role: "system";
  content: string;
}

export interface TextGenerationRuntimeUserMessage {
  role: "user";
  content: string | Array<TextGenerationRuntimeTextPart | TextGenerationRuntimeFilePart>;
}

export interface TextGenerationRuntimeAssistantMessage {
  role: "assistant";
  content: Array<
    | TextGenerationRuntimeTextPart
    | TextGenerationRuntimeReasoningPart
    | TextGenerationRuntimeToolCallPart
  >;
  /** Provider-owned calls retained for result correlation but omitted from generic replay. */
  providerToolCalls?: TextGenerationRuntimeProviderToolCall[];
  /** Opaque provider-authored assistant blocks used by the owning provider for exact replay. */
  providerMetadata?: Record<string, unknown>;
}

export interface TextGenerationRuntimeToolMessage {
  role: "tool";
  content: TextGenerationRuntimeToolResultPart[];
}

export type TextGenerationRuntimeMessage =
  | TextGenerationRuntimeSystemMessage
  | TextGenerationRuntimeUserMessage
  | TextGenerationRuntimeAssistantMessage
  | TextGenerationRuntimeToolMessage;
