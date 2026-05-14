import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import type { HostedStreamPartForUiChunkMapping } from "#veryfront/chat/hosted-ui-chunk-mapping.ts";

export interface HostedChildChunkMirror {
  handleChunk(chunk: ChatUiMessageChunk<ChatMessageMetadata>): Promise<void> | void;
}

export interface HostedChildMirrorState {
  reasoningStarted: boolean;
  textStarted: boolean;
}

export interface HostedChildMirrorContext {
  mirror: HostedChildChunkMirror | null;
  messageId: string | null;
  reasoningMessageId: string | null;
  state: HostedChildMirrorState;
  appendChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void>;
  closeReasoningSegment: () => Promise<void>;
  closeTextSegment: () => Promise<void>;
  markStepStarted: () => void;
  hasStartedStep: () => boolean;
  hasEmittedProgress: () => boolean;
}

type CoreMirroredPartType =
  | "reasoning-delta"
  | "text-delta"
  | "tool-input-start"
  | "tool-input-delta"
  | "tool-call"
  | "tool-result";

type MirroredPartType = CoreMirroredPartType | "tool-error" | "error";

type DurableMirrorChunkType = ChatUiMessageChunk<ChatMessageMetadata>["type"];

const ALREADY_MIRRORED_CHUNK_TYPES_BY_PART_TYPE: Readonly<
  Partial<Record<MirroredPartType, readonly DurableMirrorChunkType[]>>
> = {
  "reasoning-delta": ["reasoning-delta"],
  "text-delta": ["text-delta"],
  "tool-input-start": ["tool-input-start"],
  "tool-call": ["tool-input-start", "tool-input-available", "tool-input-error"],
  "tool-result": ["tool-output-available"],
  "tool-error": ["tool-input-start", "tool-input-error"],
};

export function isAlreadyMirroredHostedChunk(
  partType: MirroredPartType,
  mirroredChunkType: DurableMirrorChunkType,
): boolean {
  return ALREADY_MIRRORED_CHUNK_TYPES_BY_PART_TYPE[partType]?.includes(mirroredChunkType) ?? false;
}

type MirroredHostedStreamPart = Extract<
  HostedStreamPartForUiChunkMapping,
  | { type: "reasoning-delta" }
  | { type: "text-delta" }
  | { type: "source" }
  | { type: "tool-input-start" }
  | { type: "tool-call" }
  | { type: "tool-input-delta" }
  | { type: "tool-result" }
  | { type: "tool-error" }
  | { type: "error" }
>;

type HostedMirrorBasePart =
  | { type: "reasoning-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; input: unknown; output: unknown }
  | { type: "tool-error"; toolCallId: string; toolName: string; input: unknown; error: Error }
  | { type: "error"; error: Error };

type ExtraMirroredHostedStreamPart = Extract<HostedStreamPartForUiChunkMapping, { type: "source" }>;

export type HostedChildMirrorPart = HostedMirrorBasePart | ExtraMirroredHostedStreamPart;

export function toMirroredHostedStreamPart(
  part: HostedChildMirrorPart,
  ids: {
    messageId: string | null;
    reasoningMessageId: string | null;
  },
): MirroredHostedStreamPart {
  switch (part.type) {
    case "reasoning-delta":
      return {
        type: "reasoning-delta",
        id: ids.reasoningMessageId ?? "fork-reasoning",
        text: part.text,
      };

    case "text-delta":
      return {
        type: "text-delta",
        id: ids.messageId ?? "fork-message",
        text: part.text,
      };

    case "tool-input-start":
      return {
        type: "tool-input-start",
        id: part.toolCallId,
        toolName: part.toolName,
      };

    case "source":
      if (part.sourceType === "url") {
        return {
          type: "source",
          id: part.id,
          sourceType: "url",
          url: part.url,
          ...(part.title ? { title: part.title } : {}),
        };
      }

      return {
        type: "source",
        id: part.id,
        sourceType: "document",
        mediaType: part.mediaType,
        title: part.title ?? part.filename ?? part.id,
        ...(part.filename ? { filename: part.filename } : {}),
      };

    case "tool-call":
      return {
        type: "tool-call",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
      };

    case "tool-input-delta":
      return {
        type: "tool-input-delta",
        id: part.toolCallId,
        delta: part.delta,
      };

    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        output: part.output,
      };

    case "tool-error":
      return {
        type: "tool-error",
        toolCallId: part.toolCallId,
        toolName: part.toolName,
        input: part.input,
        error: part.error,
      };

    case "error":
      return {
        type: "error",
        error: part.error,
      };
  }
}

export async function appendHostedChildMirrorChunk(input: {
  mirror: HostedChildChunkMirror | null;
  chunk: ChatUiMessageChunk<ChatMessageMetadata>;
}): Promise<boolean> {
  if (!input.mirror) {
    return false;
  }

  await input.mirror.handleChunk(input.chunk);
  return true;
}

export async function closeHostedChildReasoningSegment(input: {
  mirror: HostedChildChunkMirror | null;
  reasoningMessageId: string | null;
  state: HostedChildMirrorState;
}): Promise<void> {
  if (!input.state.reasoningStarted || !input.reasoningMessageId) {
    return;
  }

  input.state.reasoningStarted = false;
  await appendHostedChildMirrorChunk({
    mirror: input.mirror,
    chunk: {
      type: "reasoning-end",
      id: input.reasoningMessageId,
    },
  });
}

export async function closeHostedChildTextSegment(input: {
  mirror: HostedChildChunkMirror | null;
  messageId: string | null;
  state: HostedChildMirrorState;
}): Promise<void> {
  if (!input.state.textStarted || !input.messageId) {
    return;
  }

  input.state.textStarted = false;
  await appendHostedChildMirrorChunk({
    mirror: input.mirror,
    chunk: {
      type: "text-end",
      id: input.messageId,
    },
  });
}

export function createHostedChildMirrorContext(input: {
  mirror: HostedChildChunkMirror | null;
  messageId?: string | null;
  reasoningMessageId?: string | null;
}): HostedChildMirrorContext {
  const messageId = input.messageId ?? null;
  const reasoningMessageId = input.reasoningMessageId ??
    (messageId ? `${messageId}:reasoning` : null);
  const state: HostedChildMirrorState = {
    reasoningStarted: false,
    textStarted: false,
  };
  let emittedProgress = false;
  let stepStarted = false;

  const appendChunk = async (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => {
    const mirrored = await appendHostedChildMirrorChunk({
      mirror: input.mirror,
      chunk,
    });
    if (mirrored) {
      emittedProgress = true;
    }
  };

  return {
    mirror: input.mirror,
    messageId,
    reasoningMessageId,
    state,
    appendChunk,
    closeReasoningSegment: () =>
      closeHostedChildReasoningSegment({
        mirror: input.mirror,
        reasoningMessageId,
        state,
      }),
    closeTextSegment: () =>
      closeHostedChildTextSegment({
        mirror: input.mirror,
        messageId,
        state,
      }),
    markStepStarted: () => {
      stepStarted = true;
    },
    hasStartedStep: () => stepStarted,
    hasEmittedProgress: () => emittedProgress,
  };
}
