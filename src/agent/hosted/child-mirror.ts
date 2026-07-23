import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import type { HostedStreamPartForUiChunkMapping } from "#veryfront/chat/hosted-ui-chunk-mapping.ts";

/** Public API contract for hosted child chunk mirror. */
export interface HostedChildChunkMirror {
  /** Executes chunk. */
  handleChunk(chunk: ChatUiMessageChunk<ChatMessageMetadata>): Promise<void> | void;
}

/** State for hosted child mirror. */
export interface HostedChildMirrorState {
  /** Whether reasoning started. */
  reasoningStarted: boolean;
  /** Whether text started. */
  textStarted: boolean;
}

/** Context for hosted child mirror. */
export interface HostedChildMirrorContext {
  /** Mirror value. */
  mirror: HostedChildChunkMirror | null;
  /** Message ID value. */
  messageId: string | null;
  /** Reasoning message ID value. */
  reasoningMessageId: string | null;
  /** State value. */
  state: HostedChildMirrorState;
  /** Callback that handles append chunk. */
  appendChunk: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => Promise<void>;
  /** Callback that handles close reasoning segment. */
  closeReasoningSegment: () => Promise<void>;
  /** Callback that handles close text segment. */
  closeTextSegment: () => Promise<void>;
  /** Callback that handles mark step started. */
  markStepStarted: () => void;
  /** Callback that handles has started step. */
  hasStartedStep: () => boolean;
  /** Callback that handles has emitted progress. */
  hasEmittedProgress: () => boolean;
}

/** Core stream part kinds handled by the hosted child mirror. */
export type CoreMirroredPartType =
  | "reasoning-delta"
  | "text-delta"
  | "tool-input-start"
  | "tool-input-delta"
  | "tool-call"
  | "tool-result";

/** Stream part kinds tracked by the hosted child mirror. */
export type MirroredPartType = CoreMirroredPartType | "tool-error" | "error";

/** Durable UI chunk kinds emitted by the hosted child mirror. */
export type DurableMirrorChunkType = ChatUiMessageChunk<ChatMessageMetadata>["type"];

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

/** Check whether a hosted chunk was already mirrored. */
export function isAlreadyMirroredHostedChunk(
  partType: MirroredPartType,
  mirroredChunkType: DurableMirrorChunkType,
): boolean {
  return ALREADY_MIRRORED_CHUNK_TYPES_BY_PART_TYPE[partType]?.includes(mirroredChunkType) ?? false;
}

/** Hosted stream parts supported by durable child mirroring. */
export type MirroredHostedStreamPart = Extract<
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

/** Provider-neutral stream parts accepted by the hosted child mirror. */
export type HostedMirrorBasePart =
  | { type: "reasoning-delta"; text: string }
  | { type: "text-delta"; text: string }
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; toolName: string; input: unknown; output: unknown }
  | { type: "tool-error"; toolCallId: string; toolName: string; input: unknown; error: Error }
  | { type: "error"; error: Error };

/** Additional source part accepted directly from hosted stream mapping. */
export type ExtraMirroredHostedStreamPart = Extract<
  HostedStreamPartForUiChunkMapping,
  { type: "source" }
>;

/** Public API contract for hosted child mirror part. */
export type HostedChildMirrorPart = HostedMirrorBasePart | ExtraMirroredHostedStreamPart;

/** Converts a value to mirrored hosted stream part. */
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

/** Append hosted child mirror chunk. */
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

/** Close hosted child reasoning segment helper. */
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

/** Close hosted child text segment helper. */
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

/** Context for create hosted child mirror. */
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
