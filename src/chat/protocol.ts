/**
 * Canonical chat message and stream protocol for Veryfront chat surfaces.
 *
 * These types describe the framework-owned message parts and stream events used
 * by AG-UI-aligned chat clients, hooks, and adapters.
 */

export type ChatPartState = "streaming" | "done";

export interface ChatTextPart {
  type: "text";
  text: string;
  state?: ChatPartState;
}

export interface ChatReasoningPart {
  type: "reasoning";
  text: string;
  state?: ChatPartState;
}

export type ChatToolState =
  | "input-streaming"
  | "input-available"
  | "output-streaming"
  | "output-available"
  | "output-error";

export interface ChatToolPart<NAME extends string = string, INPUT = unknown, OUTPUT = unknown> {
  type: `tool-${NAME}`;
  toolCallId: string;
  toolName: NAME;
  state: ChatToolState;
  input?: INPUT;
  output?: OUTPUT;
  errorText?: string;
}

export interface ChatToolResultPart<RESULT = unknown> {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: RESULT;
  isError?: boolean;
}

export interface ChatDynamicToolPart {
  type: "dynamic-tool";
  toolCallId: string;
  toolName: string;
  state: ChatToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export interface ChatStepPart {
  type: "step-start" | "step-end";
  stepIndex: number;
}

export type ChatMessagePart =
  | ChatTextPart
  | ChatReasoningPart
  | ChatToolPart
  | ChatToolResultPart
  | ChatDynamicToolPart
  | ChatStepPart;

export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  parts: ChatMessagePart[];
  metadata?: Record<string, unknown>;
  createdAt?: Date | string;
}

export interface ChatMessageMetadataUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
}

export interface ChildRunAuditToolCall {
  toolName: string;
  toolCallId: string;
  input?: unknown;
}

export interface ChildRunAuditToolResult {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
}

export interface ChildRunAudit {
  status: "completed" | "failed" | "cancelled" | "stopped";
  description?: string;
  steps?: number;
  durationMs?: number;
  toolCalls?: ChildRunAuditToolCall[];
  toolResults?: ChildRunAuditToolResult[];
  terminalErrorCode?: string | null;
  terminalErrorMessage?: string | null;
}

export interface ChatMessageMetadata {
  createdAt?: string;
  isStopped?: boolean;
  isCompleted?: boolean;
  completedAt?: string;
  agentId?: string;
  agentName?: string;
  conversationId?: string;
  modelId?: string;
  runId?: string;
  streamingMessageId?: string;
  childRunAudit?: ChildRunAudit;
  usage?: ChatMessageMetadataUsage;
}

export type ChatFinishReason =
  | "stop"
  | "length"
  | "tool-calls"
  | "content-filter"
  | "error"
  | "other";

type ChatStreamEventBase = {
  providerExecuted?: boolean;
  dynamic?: boolean;
};

export type ChatStreamEvent =
  | {
    type: "start";
    messageId?: string;
    messageMetadata?: unknown;
  }
  | {
    type: "message-metadata";
    messageMetadata: unknown;
  }
  | {
    type: "text-start";
    id: string;
  }
  | {
    type: "text-delta";
    id: string;
    delta: string;
  }
  | {
    type: "text-end";
    id: string;
  }
  | {
    type: "reasoning-start";
    id: string;
  }
  | {
    type: "reasoning-delta";
    id: string;
    delta: string;
  }
  | {
    type: "reasoning-end";
    id: string;
  }
  | ({
    type: "tool-input-start";
    toolCallId: string;
    toolName: string;
  } & ChatStreamEventBase)
  | ({
    type: "tool-input-delta";
    toolCallId: string;
    inputTextDelta: string;
  } & ChatStreamEventBase)
  | ({
    type: "tool-input-available";
    toolCallId: string;
    toolName: string;
    input: unknown;
  } & ChatStreamEventBase)
  | ({
    type: "tool-input-error";
    toolCallId: string;
    toolName: string;
    input: unknown;
    errorText: string;
  } & ChatStreamEventBase)
  | {
    type: "tool-approval-request";
    approvalId: string;
    toolCallId: string;
  }
  | ({
    type: "tool-output-available";
    toolCallId: string;
    output: unknown;
  } & ChatStreamEventBase)
  | {
    type: "tool-output-denied";
    toolCallId: string;
  }
  | ({
    type: "tool-output-error";
    toolCallId: string;
    errorText: string;
  } & ChatStreamEventBase)
  | {
    type: "source-url";
    sourceId: string;
    url: string;
    title?: string;
  }
  | {
    type: "source-document";
    sourceId: string;
    mediaType: string;
    title: string;
    filename?: string;
  }
  | {
    type: "file";
    url: string;
    mediaType: string;
    filename?: string;
  }
  | {
    type: "start-step";
  }
  | {
    type: "finish-step";
  }
  | {
    type: `data-${string}`;
    data: unknown;
  }
  | {
    type: "finish";
    finishReason?: ChatFinishReason;
  }
  | {
    type: "abort";
  }
  | {
    type: "error";
    errorText: string;
  };

type MessageLifecycleChunk<TMessageMetadata> =
  | {
    type: "start";
    messageId?: string;
    messageMetadata?: TMessageMetadata;
  }
  | {
    type: "finish";
    finishReason?: string;
    messageMetadata?: TMessageMetadata;
  }
  | {
    type: "message-metadata";
    messageMetadata: TMessageMetadata;
  };

type IdChunk<TType extends string> = {
  type: TType;
  id: string;
};

type IdDeltaChunk<TType extends string> = IdChunk<TType> & {
  delta: string;
};

type ToolCallChunk<TType extends string> = {
  type: TType;
  toolCallId: string;
};

type NamedToolCallChunk<TType extends string> = ToolCallChunk<TType> & {
  toolName: string;
};

type ToolInputChunk<TType extends string> = NamedToolCallChunk<TType> & {
  input: unknown;
};

type ToolErrorChunk<TType extends string> = ToolCallChunk<TType> & {
  errorText: string;
};

export type ChatUiMessageChunk<TMessageMetadata = ChatMessageMetadata> =
  | MessageLifecycleChunk<TMessageMetadata>
  | {
    type: "start-step";
  }
  | {
    type: "finish-step";
  }
  | {
    type: "abort";
  }
  | IdChunk<"reasoning-start">
  | IdDeltaChunk<"reasoning-delta">
  | IdChunk<"reasoning-end">
  | IdChunk<"text-start">
  | IdDeltaChunk<"text-delta">
  | IdChunk<"text-end">
  | {
    type: "source-url";
    sourceId: string;
    url: string;
    title?: string;
  }
  | {
    type: "source-document";
    sourceId: string;
    mediaType: string;
    title: string;
    filename?: string;
  }
  | {
    type: "file";
    mediaType: string;
    url: string;
  }
  | NamedToolCallChunk<"tool-input-start">
  | (ToolCallChunk<"tool-input-delta"> & {
    inputTextDelta: string;
  })
  | ToolInputChunk<"tool-input-available">
  | (ToolInputChunk<"tool-input-error"> & {
    errorText: string;
  })
  | (ToolCallChunk<"tool-output-available"> & {
    output: unknown;
  })
  | ToolErrorChunk<"tool-output-error">
  | ToolCallChunk<"tool-output-denied">
  | (ToolCallChunk<"tool-approval-request"> & {
    approvalId: string;
  })
  | {
    type: "error";
    errorText: string;
  }
  | {
    type: `data-${string}`;
    data: unknown;
  };
