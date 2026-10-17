import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import { deriveKnowledgeSourceDocumentChunk } from "#veryfront/chat/knowledge-source-document.ts";
import { createMirroredStepChunk } from "./step-identity.ts";
import {
  getRuntimeObservation,
  retainRuntimeObservation,
} from "../../runtime/runtime-observation-carrier.ts";

/** Check whether a durable chunk mirrors tool output. */
export function isDurableMirroredOutputChunk(
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
): boolean {
  if (chunk.type === "tool-output-available" && chunk.preliminary) return false;
  switch (chunk.type) {
    case "text-start":
    case "text-delta":
    case "text-end":
    case "reasoning-start":
    case "reasoning-delta":
    case "reasoning-end":
    case "tool-input-start":
    case "tool-input-delta":
    case "tool-input-available":
    case "tool-input-error":
    case "tool-output-available":
    case "tool-output-error":
    case "tool-output-denied":
      return true;

    default:
      return false;
  }
}

/** State for mirrored tool chunk. */
export interface MirroredToolChunkState {
  startedToolCallIds: Set<string>;
  inputAvailableToolCallIds: Set<string>;
  outputAvailableToolCallIds: Set<string>;
  outputErrorToolCallIds: Set<string>;
  outputDeniedToolCallIds: Set<string>;
  toolCallNames: Map<string, string>;
  /** Actual durable reasoning content IDs, reserved during final-step recovery. */
  reasoningContentIds?: Set<string>;
  /** Reasoning spans that started but have not ended, with their exact mirrored text. */
  openReasoningParts?: Map<string, string>;
  /** Ownership corrections already appended by trusted finalization. */
  ownershipCorrectedToolCallIds?: Set<string>;
}

/** State for create mirrored tool chunk. */
export function createMirroredToolChunkState(): MirroredToolChunkState {
  return {
    startedToolCallIds: new Set<string>(),
    inputAvailableToolCallIds: new Set<string>(),
    outputAvailableToolCallIds: new Set<string>(),
    outputErrorToolCallIds: new Set<string>(),
    outputDeniedToolCallIds: new Set<string>(),
    toolCallNames: new Map<string, string>(),
    reasoningContentIds: new Set<string>(),
    openReasoningParts: new Map<string, string>(),
    ownershipCorrectedToolCallIds: new Set<string>(),
  };
}

/** State for clone mirrored tool chunk. */
export function cloneMirroredToolChunkState(
  state: MirroredToolChunkState,
): MirroredToolChunkState {
  return {
    startedToolCallIds: new Set(state.startedToolCallIds),
    inputAvailableToolCallIds: new Set(state.inputAvailableToolCallIds),
    outputAvailableToolCallIds: new Set(state.outputAvailableToolCallIds),
    outputErrorToolCallIds: new Set(state.outputErrorToolCallIds),
    outputDeniedToolCallIds: new Set(state.outputDeniedToolCallIds),
    toolCallNames: new Map(state.toolCallNames),
    reasoningContentIds: new Set(state.reasoningContentIds),
    openReasoningParts: new Map(state.openReasoningParts),
    ownershipCorrectedToolCallIds: new Set(state.ownershipCorrectedToolCallIds),
  };
}

function recordMirroredReasoningChunk(
  state: MirroredToolChunkState,
  chunk: Extract<
    ChatUiMessageChunk<ChatMessageMetadata>,
    { type: "reasoning-start" | "reasoning-delta" | "reasoning-end" }
  >,
): void {
  const reasoningContentIds = state.reasoningContentIds ??= new Set<string>();
  reasoningContentIds.add(chunk.id);
  const open = state.openReasoningParts ??= new Map<string, string>();
  if (chunk.type === "reasoning-start" && !open.has(chunk.id)) open.set(chunk.id, "");
  if (chunk.type === "reasoning-delta" && open.has(chunk.id)) {
    open.set(chunk.id, open.get(chunk.id)! + chunk.delta);
  }
  if (chunk.type === "reasoning-end") open.delete(chunk.id);
}

/** State for record mirrored tool chunk. */
export function recordMirroredToolChunkState(
  state: MirroredToolChunkState,
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
): void {
  switch (chunk.type) {
    case "reasoning-start":
    case "reasoning-delta":
    case "reasoning-end": {
      recordMirroredReasoningChunk(state, chunk);
      break;
    }

    case "tool-input-start":
      state.startedToolCallIds.add(chunk.toolCallId);
      if (chunk.toolName.length > 0) {
        state.toolCallNames.set(chunk.toolCallId, chunk.toolName);
      }
      break;

    case "tool-input-available":
      state.startedToolCallIds.add(chunk.toolCallId);
      state.inputAvailableToolCallIds.add(chunk.toolCallId);
      if (chunk.toolName.length > 0) {
        state.toolCallNames.set(chunk.toolCallId, chunk.toolName);
      }
      break;

    case "tool-input-error":
      state.startedToolCallIds.add(chunk.toolCallId);
      state.inputAvailableToolCallIds.add(chunk.toolCallId);
      state.outputErrorToolCallIds.add(chunk.toolCallId);
      if (chunk.toolName.length > 0) {
        state.toolCallNames.set(chunk.toolCallId, chunk.toolName);
      }
      break;

    case "tool-output-available":
      if (chunk.preliminary) break;
      state.outputAvailableToolCallIds.add(chunk.toolCallId);
      break;

    case "tool-output-error":
      state.outputErrorToolCallIds.add(chunk.toolCallId);
      break;

    case "tool-output-denied":
      state.outputDeniedToolCallIds.add(chunk.toolCallId);
      break;
  }
}

/** Public API contract for open tool calls. */
export interface OpenToolCalls {
  needsInputClose: Array<{ toolCallId: string; toolName: string }>;
  needsOutputClose: Array<{ toolCallId: string; toolName: string }>;
}

/** Public API contract for hosted mirrored open tool call logger. */
export interface HostedMirroredOpenToolCallLogger {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
}

/** Public API contract for hosted mirrored UI stream logger. */
export interface HostedMirroredUiStreamLogger extends HostedMirroredOpenToolCallLogger {
  error: (message: string, metadata?: Record<string, unknown>) => void;
}

/** Public API contract for hosted mirrored UI stream watchdog. */
export interface HostedMirroredUiStreamWatchdog {
  observe: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => void;
  dispose: () => void;
}

/** Input payload for create hosted mirrored UI stream. */
export interface CreateHostedMirroredUiStreamInput {
  sourceStream: AsyncIterable<ChatUiMessageChunk<ChatMessageMetadata>>;
  rootStreamWatchdog: HostedMirroredUiStreamWatchdog;
  mirroredToolChunkState: MirroredToolChunkState;
  appendChunk?: (
    chunk: ChatUiMessageChunk<ChatMessageMetadata>,
  ) => Promise<void> | void;
  setMirroredOutput?: (value: boolean) => void;
  registerPendingDerivedSourceFlush?: (flush: () => Promise<void>) => void;
  logger?: HostedMirroredUiStreamLogger;
}

/** Input payload for close hosted mirrored open tool calls. */
export interface CloseHostedMirroredOpenToolCallsInput {
  mirroredToolChunkState: MirroredToolChunkState;
  errorText: string;
  appendChunk: (
    chunk: ChatUiMessageChunk<ChatMessageMetadata>,
  ) => Promise<void> | void;
  logger?: HostedMirroredOpenToolCallLogger;
}

function isAbortErrorLike(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }

  return error instanceof Error && error.name === "AbortError";
}

/** Return hosted mirrored abort error text. */
export function getHostedMirroredAbortErrorText(streamError: unknown): string {
  if (isAbortErrorLike(streamError)) {
    return "Chat stream aborted before tool call completed";
  }

  return `Chat stream errored before tool call completed: ${
    streamError instanceof Error ? streamError.message : String(streamError)
  }`;
}

/** Compute open tool calls. */
export function computeOpenToolCalls(
  state: MirroredToolChunkState,
): OpenToolCalls {
  const needsInputClose: Array<{ toolCallId: string; toolName: string }> = [];
  const needsOutputClose: Array<{ toolCallId: string; toolName: string }> = [];

  for (const toolCallId of state.startedToolCallIds) {
    const toolName = state.toolCallNames.get(toolCallId) ?? "unknown";

    if (!state.inputAvailableToolCallIds.has(toolCallId)) {
      needsInputClose.push({ toolCallId, toolName });
      continue;
    }

    if (
      !state.outputAvailableToolCallIds.has(toolCallId) &&
      !state.outputErrorToolCallIds.has(toolCallId) &&
      !state.outputDeniedToolCallIds.has(toolCallId)
    ) {
      needsOutputClose.push({ toolCallId, toolName });
    }
  }

  return {
    needsInputClose,
    needsOutputClose,
  };
}

/** Close hosted mirrored open tool calls helper. */
export async function closeHostedMirroredOpenToolCalls(
  input: CloseHostedMirroredOpenToolCallsInput,
): Promise<void> {
  const openToolCalls = computeOpenToolCalls(input.mirroredToolChunkState);
  if (
    openToolCalls.needsInputClose.length === 0 &&
    openToolCalls.needsOutputClose.length === 0
  ) {
    return;
  }

  input.logger?.warn("Closing open tool calls after stream abort", {
    needsInputClose: openToolCalls.needsInputClose.map(({ toolCallId }) => toolCallId),
    needsOutputClose: openToolCalls.needsOutputClose.map(({ toolCallId }) => toolCallId),
    errorText: input.errorText,
  });

  const unknownToolNames = openToolCalls.needsInputClose.filter(
    ({ toolName }) => toolName === "unknown",
  );
  if (unknownToolNames.length > 0) {
    input.logger?.warn("Closing aborted tool calls without recoverable tool names", {
      toolCallIds: unknownToolNames.map(({ toolCallId }) => toolCallId),
      errorText: input.errorText,
    });
  }

  for (const { toolCallId, toolName } of openToolCalls.needsInputClose) {
    await input.appendChunk({
      type: "tool-input-error",
      toolCallId,
      toolName,
      input: {},
      errorText: input.errorText,
    });
  }

  for (const { toolCallId } of openToolCalls.needsOutputClose) {
    await input.appendChunk({
      type: "tool-output-error",
      toolCallId,
      errorText: input.errorText,
    });
  }
}

function retainMirroredStepIdentity(
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
): ChatUiMessageChunk<ChatMessageMetadata> {
  const observation = getRuntimeObservation(chunk);
  let emittedChunk = chunk;
  if (chunk.type === "start-step") {
    emittedChunk = createMirroredStepChunk(
      chunk,
      observation?.kind === "step_started" ? observation.stepId : undefined,
    );
  }
  if (emittedChunk !== chunk) retainRuntimeObservation(chunk, emittedChunk);
  return emittedChunk;
}

type KnowledgeSourceChunk = NonNullable<ReturnType<typeof deriveKnowledgeSourceDocumentChunk>>;

function sourceDocumentMirrorMode(
  source: ChatUiMessageChunk<ChatMessageMetadata>,
  emittedKnowledgeSourceIds: Set<string>,
  emittedDerivedKnowledgeSourceIds: Set<string>,
): "mirror" | "once" | "other" | null {
  if (source.type !== "source-document") return "other";
  if (emittedKnowledgeSourceIds.has(source.sourceId)) {
    return emittedDerivedKnowledgeSourceIds.delete(source.sourceId) ? "mirror" : null;
  }
  emittedKnowledgeSourceIds.add(source.sourceId);
  return "once";
}

function matchesPendingKnowledgeSource(
  pending: KnowledgeSourceChunk | null,
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
): boolean {
  return !!pending && chunk.type === "source-document" && chunk.sourceId === pending.sourceId;
}

function derivePendingKnowledgeSource(
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
  input: CreateHostedMirroredUiStreamInput,
  emittedKnowledgeSourceIds: Set<string>,
  pending: KnowledgeSourceChunk | null,
): KnowledgeSourceChunk | null {
  const derivedSource = chunk.type === "tool-output-available"
    ? deriveKnowledgeSourceDocumentChunk({
      toolName: input.mirroredToolChunkState.toolCallNames.get(chunk.toolCallId),
      output: chunk.output,
    })
    : null;
  return derivedSource && !emittedKnowledgeSourceIds.has(derivedSource.sourceId)
    ? derivedSource
    : pending;
}

/** Create hosted mirrored UI stream. */
export async function* createHostedMirroredUiStream(
  input: CreateHostedMirroredUiStreamInput,
): AsyncIterable<ChatUiMessageChunk<ChatMessageMetadata>> {
  let streamError: unknown = null;
  const emittedKnowledgeSourceIds = new Set<string>();
  const mirroredKnowledgeSourceIds = new Set<string>();
  const emittedDerivedKnowledgeSourceIds = new Set<string>();
  let pendingDerivedSource: ReturnType<typeof deriveKnowledgeSourceDocumentChunk> = null;

  const mirrorChunk = async (chunk: ChatUiMessageChunk<ChatMessageMetadata>): Promise<void> => {
    input.rootStreamWatchdog.observe(chunk);
    if (isDurableMirroredOutputChunk(chunk)) {
      input.setMirroredOutput?.(true);
    }
    recordMirroredToolChunkState(input.mirroredToolChunkState, chunk);
    if (input.appendChunk) {
      await Promise.resolve(input.appendChunk(chunk)).catch((error: unknown) => {
        input.logger?.error("Durable run mirror failed to handle chunk", {
          chunkType: chunk.type,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
  };

  const takePendingDerivedSource = (): ReturnType<
    typeof deriveKnowledgeSourceDocumentChunk
  > => {
    const source = pendingDerivedSource;
    pendingDerivedSource = null;
    if (!source || emittedKnowledgeSourceIds.has(source.sourceId)) {
      return null;
    }
    emittedKnowledgeSourceIds.add(source.sourceId);
    return source;
  };

  const mirrorSourceOnce = async (
    source: NonNullable<ReturnType<typeof deriveKnowledgeSourceDocumentChunk>>,
  ): Promise<void> => {
    if (mirroredKnowledgeSourceIds.has(source.sourceId)) {
      return;
    }
    mirroredKnowledgeSourceIds.add(source.sourceId);
    await mirrorChunk(source);
  };

  input.registerPendingDerivedSourceFlush?.(async () => {
    if (!pendingDerivedSource || emittedKnowledgeSourceIds.has(pendingDerivedSource.sourceId)) {
      return;
    }
    await mirrorSourceOnce(pendingDerivedSource);
  });

  const consumePendingKnowledgeSource = (
    chunk: ChatUiMessageChunk<ChatMessageMetadata>,
  ): "emit" | "skip" | "other" => {
    if (!matchesPendingKnowledgeSource(pendingDerivedSource, chunk)) return "other";
    pendingDerivedSource = null;
    const source = chunk as KnowledgeSourceChunk;
    if (emittedKnowledgeSourceIds.has(source.sourceId)) return "skip";
    emittedKnowledgeSourceIds.add(source.sourceId);
    mirroredKnowledgeSourceIds.add(source.sourceId);
    return "emit";
  };

  try {
    for await (const sourceChunk of input.sourceStream) {
      switch (consumePendingKnowledgeSource(sourceChunk)) {
        case "emit":
          await mirrorChunk(sourceChunk);
          yield sourceChunk;
          continue;
        case "skip":
          continue;
      }

      const pendingSource = takePendingDerivedSource();
      if (pendingSource) {
        emittedDerivedKnowledgeSourceIds.add(pendingSource.sourceId);
        await mirrorSourceOnce(pendingSource);
        yield pendingSource;
      }

      switch (
        sourceDocumentMirrorMode(
          sourceChunk,
          emittedKnowledgeSourceIds,
          emittedDerivedKnowledgeSourceIds,
        )
      ) {
        case "mirror":
          await mirrorChunk(sourceChunk);
          yield sourceChunk;
          continue;
        case "once":
          await mirrorSourceOnce(sourceChunk as KnowledgeSourceChunk);
          yield sourceChunk;
          continue;
        case null:
          continue;
      }

      pendingDerivedSource = derivePendingKnowledgeSource(
        sourceChunk,
        input,
        emittedKnowledgeSourceIds,
        pendingDerivedSource,
      );

      const emittedChunk = retainMirroredStepIdentity(sourceChunk);
      await mirrorChunk(emittedChunk);
      yield emittedChunk;
    }

    const pendingSource = takePendingDerivedSource();
    if (pendingSource) {
      emittedDerivedKnowledgeSourceIds.add(pendingSource.sourceId);
      await mirrorSourceOnce(pendingSource);
      yield pendingSource;
    }
  } catch (error) {
    streamError = error;
    const pendingSource = takePendingDerivedSource();
    if (pendingSource) {
      emittedDerivedKnowledgeSourceIds.add(pendingSource.sourceId);
      await mirrorSourceOnce(pendingSource);
      yield pendingSource;
    }
    throw error;
  } finally {
    if (streamError && input.appendChunk) {
      const errorText = getHostedMirroredAbortErrorText(streamError);

      await closeHostedMirroredOpenToolCalls({
        mirroredToolChunkState: input.mirroredToolChunkState,
        errorText,
        appendChunk: input.appendChunk,
        logger: input.logger,
      }).catch((error: unknown) => {
        input.logger?.error("Failed to close open tool calls after stream abort", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }
    input.rootStreamWatchdog.dispose();
  }
}
