/**
 * Canonical chat message and stream protocol for Veryfront chat surfaces.
 *
 * These types describe the framework-owned message parts and stream events used
 * by AG-UI-aligned chat clients, hooks, and adapters.
 */

export type ChatPartState = "streaming" | "done";

/** Chat message part that carries text. */
export interface ChatTextPart {
  type: "text";
  text: string;
  state?: ChatPartState;
}

/** Chat message part that carries reasoning text. */
export interface ChatReasoningPart {
  type: "reasoning";
  text: string;
  signature?: string;
  redactedData?: string;
  state?: ChatPartState;
}

/** Chat message part that carries an uploaded file or image attachment. */
export interface ChatFilePart {
  type: "file";
  /** MIME type of the file, e.g. "image/png" or "application/pdf". */
  mediaType: string;
  /** Resolved URL of the uploaded file (from the upload endpoint). */
  url: string;
  /** Original filename shown to the user. */
  filename?: string;
  /** File size in bytes, when known. Shown in the read-only message pill. */
  size?: number;
}

/** State for chat tool. */
export type ChatToolState =
  | "input-streaming"
  | "input-available"
  | "output-streaming"
  | "output-available"
  | "output-error";

/** Public API contract for chat tool part. */
export interface ChatToolPart<NAME extends string = string, INPUT = unknown, OUTPUT = unknown> {
  type: `tool-${NAME}`;
  toolCallId: string;
  toolName: NAME;
  state: ChatToolState;
  input?: INPUT;
  output?: OUTPUT;
  errorText?: string;
}

/** Chat message part that carries a tool result. */
export interface ChatToolResultPart<RESULT = unknown> {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: RESULT;
  isError?: boolean;
}

/** Public API contract for chat dynamic tool part. */
export interface ChatDynamicToolPart {
  type: "dynamic-tool";
  toolCallId: string;
  toolName: string;
  state: ChatToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/** Public API contract for chat step part. */
export interface ChatStepPart {
  type: "step-start" | "step-end";
  stepIndex: number;
}

/** Public API contract for chat data part. */
export interface ChatDataPart {
  type: `data-${string}`;
  data: unknown;
}

/** Public API contract for chat message part. */
export type ChatMessagePart =
  | ChatTextPart
  | ChatReasoningPart
  | ChatFilePart
  | ChatToolPart
  | ChatToolResultPart
  | ChatDynamicToolPart
  | ChatStepPart
  | ChatDataPart;

/** Message shape for chat. */
export interface ChatMessage {
  id: string;
  role: "system" | "user" | "assistant";
  parts: ChatMessagePart[];
  metadata?: Record<string, unknown>;
  createdAt?: Date | string;
}

/** Public API contract for chat message metadata usage. */
export interface ChatMessageMetadataUsage {
  inputTokens?: number;
  outputTokens?: number;
  reasoningTokens?: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
}

/** Public API contract for child run audit tool call. */
export interface ChildRunAuditToolCall {
  toolName: string;
  toolCallId: string;
  input?: unknown;
}

/** Result returned from child run audit tool. */
export interface ChildRunAuditToolResult {
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
}

/** Public API contract for child run audit. */
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

/** Public API contract for chat message metadata. */
export interface ChatMessageMetadata {
  createdAt?: string;
  isStopped?: boolean;
  isCompleted?: boolean;
  completedAt?: string;
  agentId?: string;
  agentName?: string;
  agentAvatarUrl?: string;
  conversationId?: string;
  modelId?: string;
  runId?: string;
  streamingMessageId?: string;
  childRunAudit?: ChildRunAudit;
  usage?: ChatMessageMetadataUsage;
  billableInputTokens?: number;
  billableOutputTokens?: number;
  costUsd?: number;
  providerInputCostUsd?: number;
  providerOutputCostUsd?: number;
  providerCostUsd?: number;
  veryfrontInputChargeUsd?: number;
  veryfrontOutputChargeUsd?: number;
  veryfrontChargeUsd?: number;
  veryfrontBilledUsd?: number;
  costCredits?: number;
  costSource?: "gateway" | "missing" | "partial";
  billingMode?: "direct" | "deferred";
  usageCaptureStatus?: "complete" | "partial" | "missing";
}

/** Public API contract for chat finish reason. */
export type ChatFinishReason =
  | "stop"
  | "length"
  | "tool-calls"
  | "content-filter"
  | "error"
  | "other";

/** Public API contract for chat stream event base. */
type ChatStreamEventBase = {
  providerExecuted?: boolean;
  dynamic?: boolean;
};

/** Event emitted for chat stream. */
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
    messageId?: string;
    contentId?: string;
  }
  | {
    type: "text-delta";
    id: string;
    messageId?: string;
    contentId?: string;
    delta: string;
  }
  | {
    type: "text-end";
    id: string;
    messageId?: string;
    contentId?: string;
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
    signature?: string;
    redactedData?: string;
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
    messageMetadata?: unknown;
  }
  | {
    type: "abort";
  }
  | {
    type: "error";
    errorText: string;
  };

/** Public API contract for message lifecycle chunk. */
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

/** Public API contract for ID chunk. */
type IdChunk<TType extends string> = {
  type: TType;
  id: string;
};

/** Public API contract for ID delta chunk. */
type IdDeltaChunk<TType extends string> = IdChunk<TType> & {
  delta: string;
};

/** Public API contract for tool call chunk. */
type ToolCallChunk<TType extends string> = {
  type: TType;
  toolCallId: string;
};

/** Public API contract for named tool call chunk. */
type NamedToolCallChunk<TType extends string> = ToolCallChunk<TType> & {
  toolName: string;
};

/** Public API contract for tool input chunk. */
type ToolInputChunk<TType extends string> = NamedToolCallChunk<TType> & {
  input: unknown;
};

/** Public API contract for tool error chunk. */
type ToolErrorChunk<TType extends string> = ToolCallChunk<TType> & {
  errorText: string;
};

/** Public API contract for chat UI message chunk. */
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
  | {
    type: "reasoning-end";
    id: string;
    signature?: string;
    redactedData?: string;
  }
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
