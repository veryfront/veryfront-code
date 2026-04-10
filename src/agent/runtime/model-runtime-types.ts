/**
 * Model Runtime Types
 *
 * Framework-owned message types for the current text-generation runtime
 * boundary. These describe the subset of message shapes the runtime uses
 * today without exposing SDK-owned message contracts upward.
 */

export interface ModelRuntimeTextPart {
  type: "text";
  text: string;
}

export interface ModelRuntimeToolCallPart {
  type: "tool-call";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

export interface ModelRuntimeToolResultPart {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  output: {
    type: "json";
    value: unknown;
  };
}

export interface ModelRuntimeSystemMessage {
  role: "system";
  content: string;
}

export interface ModelRuntimeUserMessage {
  role: "user";
  content: string;
}

export interface ModelRuntimeAssistantMessage {
  role: "assistant";
  content: Array<ModelRuntimeTextPart | ModelRuntimeToolCallPart>;
}

export interface ModelRuntimeToolMessage {
  role: "tool";
  content: ModelRuntimeToolResultPart[];
}

export type ModelRuntimeMessage =
  | ModelRuntimeSystemMessage
  | ModelRuntimeUserMessage
  | ModelRuntimeAssistantMessage
  | ModelRuntimeToolMessage;
