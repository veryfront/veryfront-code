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
