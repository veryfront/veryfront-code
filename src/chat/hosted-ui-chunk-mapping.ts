import type { ChatMessageMetadata, ChatUiMessageChunk } from "./protocol.ts";

/** Options accepted by hosted UI chunk mapping. */
export type HostedUiChunkMappingOptions = {
  messageId?: string | null;
  reasoningMessageId?: string | null;
  sendReasoning?: boolean;
  sendSources?: boolean;
  onError?: (error: unknown) => string;
};

export type HostedStreamSourcePart =
  | {
    type: "source";
    id: string;
    sourceType: "url";
    url: string;
    title?: string;
  }
  | {
    type: "source";
    id: string;
    sourceType: "document";
    mediaType: string;
    title?: string;
    filename?: string;
  };

/** Public API contract for hosted stream part for UI chunk mapping. */
export type HostedStreamPartForUiChunkMapping =
  | {
    type: "start";
  }
  | {
    type: "start-step";
  }
  | {
    type: "finish-step";
  }
  | {
    type: "finish";
    finishReason?: string;
  }
  | {
    type: "abort";
  }
  | {
    type: "reasoning-start";
    id: string;
  }
  | {
    type: "reasoning-delta";
    id: string;
    text: string;
  }
  | {
    type: "reasoning-end";
    id: string;
  }
  | {
    type: "text-start";
    id: string;
  }
  | {
    type: "text-delta";
    id: string;
    text: string;
  }
  | {
    type: "text-end";
    id: string;
  }
  | HostedStreamSourcePart
  | {
    type: "file";
    file: {
      mediaType: string;
      base64: string;
    };
  }
  | {
    type: "tool-input-start";
    id: string;
    toolName: string;
  }
  | {
    type: "tool-input-delta";
    id: string;
    delta: string;
  }
  | {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: unknown;
    invalid: true;
    error: unknown;
  }
  | {
    type: "tool-call";
    toolCallId: string;
    toolName: string;
    input: unknown;
    invalid?: false;
  }
  | {
    type: "tool-approval-request";
    approvalId: string;
    toolCall: {
      toolCallId: string;
    };
  }
  | {
    type: "tool-result";
    toolCallId: string;
    toolName: string;
    input: unknown;
    output: unknown;
  }
  | {
    type: "tool-error";
    toolCallId: string;
    toolName: string;
    input: unknown;
    error: unknown;
  }
  | {
    type: "tool-output-denied";
    toolCallId: string;
  }
  | {
    type: "error";
    error: unknown;
  }
  | {
    type: "tool-input-end";
  }
  | {
    type: "raw";
  };

function defaultOnError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mapHostedStreamSourceToUiChunks(
  part: HostedStreamSourcePart,
  sendSources: boolean,
): ChatUiMessageChunk<ChatMessageMetadata>[] {
  if (!sendSources) {
    return [];
  }

  if (part.sourceType === "url") {
    return [{
      type: "source-url",
      sourceId: part.id,
      url: part.url,
      ...(part.title ? { title: part.title } : {}),
    }];
  }

  return [
    {
      type: "source-document",
      sourceId: part.id,
      mediaType: part.mediaType,
      title: part.title ?? part.filename ?? part.id,
      ...(part.filename ? { filename: part.filename } : {}),
    },
  ];
}

function mapToolCallPartToUiChunks(
  part: Extract<HostedStreamPartForUiChunkMapping, { type: "tool-call" }>,
  onError: (error: unknown) => string,
): ChatUiMessageChunk<ChatMessageMetadata>[] {
  if (part.invalid) {
    return [{
      type: "tool-input-error",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.input,
      errorText: onError(part.error),
    }];
  }

  return [{
    type: "tool-input-available",
    toolCallId: part.toolCallId,
    toolName: part.toolName,
    input: part.input,
  }];
}

function mapToolErrorPartToUiChunks(
  part: Extract<HostedStreamPartForUiChunkMapping, { type: "tool-error" }>,
  onError: (error: unknown) => string,
): ChatUiMessageChunk<ChatMessageMetadata>[] {
  return [
    {
      type: "tool-input-start",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
    },
    {
      type: "tool-input-error",
      toolCallId: part.toolCallId,
      toolName: part.toolName,
      input: part.input,
      errorText: onError(part.error),
    },
  ];
}

/** Map hosted stream part to chat UI chunks. */
export function mapHostedStreamPartToChatUiChunks(
  part: HostedStreamPartForUiChunkMapping,
  options: HostedUiChunkMappingOptions = {},
): ChatUiMessageChunk<ChatMessageMetadata>[] {
  const onError = options.onError ?? defaultOnError;
  const sendReasoning = options.sendReasoning ?? true;
  const sendSources = options.sendSources ?? true;

  switch (part.type) {
    case "start":
      return [{ type: "start", ...(options.messageId ? { messageId: options.messageId } : {}) }];

    case "start-step":
      return [{ type: "start-step" }];

    case "finish-step":
      return [{ type: "finish-step" }];

    case "finish":
      return [{
        type: "finish",
        ...(part.finishReason ? { finishReason: part.finishReason } : {}),
      }];

    case "abort":
      return [{ type: "abort" }];

    case "reasoning-start":
      return [{ type: "reasoning-start", id: options.reasoningMessageId ?? part.id }];

    case "reasoning-delta":
      return sendReasoning
        ? [{ type: "reasoning-delta", id: options.reasoningMessageId ?? part.id, delta: part.text }]
        : [];

    case "reasoning-end":
      return [{ type: "reasoning-end", id: options.reasoningMessageId ?? part.id }];

    case "text-start":
      return [{ type: "text-start", id: options.messageId ?? part.id }];

    case "text-delta":
      return [{ type: "text-delta", id: options.messageId ?? part.id, delta: part.text }];

    case "text-end":
      return [{ type: "text-end", id: options.messageId ?? part.id }];

    case "source":
      return mapHostedStreamSourceToUiChunks(part, sendSources);

    case "file":
      return [{
        type: "file",
        mediaType: part.file.mediaType,
        url: `data:${part.file.mediaType};base64,${part.file.base64}`,
      }];

    case "tool-input-start":
      return [{ type: "tool-input-start", toolCallId: part.id, toolName: part.toolName }];

    case "tool-input-delta":
      return [{ type: "tool-input-delta", toolCallId: part.id, inputTextDelta: part.delta }];

    case "tool-call":
      return mapToolCallPartToUiChunks(part, onError);

    case "tool-approval-request":
      return [{
        type: "tool-approval-request",
        approvalId: part.approvalId,
        toolCallId: part.toolCall.toolCallId,
      }];

    case "tool-result":
      return [{ type: "tool-output-available", toolCallId: part.toolCallId, output: part.output }];

    case "tool-error":
      return mapToolErrorPartToUiChunks(part, onError);

    case "tool-output-denied":
      return [{ type: "tool-output-denied", toolCallId: part.toolCallId }];

    case "error":
      return [{ type: "error", errorText: onError(part.error) }];

    case "tool-input-end":
    case "raw":
      return [];
  }
}
