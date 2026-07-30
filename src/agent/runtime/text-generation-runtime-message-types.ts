/**
 * Text-Generation Runtime Message Types
 *
 * Framework-owned message types for the current text-generation runtime
 * boundary. These describe the subset of message shapes the runtime uses
 * today without exposing SDK-owned message contracts upward.
 */

import type { RuntimeProviderBlock } from "#veryfront/provider/runtime-loader.ts";

export interface TextGenerationRuntimeTextPart {
  type: "text";
  text: string;
}

export interface TextGenerationRuntimeReasoningPart {
  type: "reasoning";
  text?: string;
  signature?: string;
  redactedData?: string;
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
    | RuntimeProviderBlock
  >;
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
