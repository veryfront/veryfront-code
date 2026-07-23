import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";

/** Check whether a durable chunk mirrors tool output. */
export function isDurableMirroredOutputChunk(
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
): boolean {
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
  /** Started tool call IDs value. */
  startedToolCallIds: Set<string>;
  /** Input available tool call IDs value. */
  inputAvailableToolCallIds: Set<string>;
  /** Output available tool call IDs value. */
  outputAvailableToolCallIds: Set<string>;
  /** Output error tool call IDs value. */
  outputErrorToolCallIds: Set<string>;
  /** Output denied tool call IDs value. */
  outputDeniedToolCallIds: Set<string>;
  /** Tool call names value. */
  toolCallNames: Map<string, string>;
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
  };
}

/** State for record mirrored tool chunk. */
export function recordMirroredToolChunkState(
  state: MirroredToolChunkState,
  chunk: ChatUiMessageChunk<ChatMessageMetadata>,
): void {
  switch (chunk.type) {
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
  /** Needs input close value. */
  needsInputClose: Array<{ toolCallId: string; toolName: string }>;
  /** Needs output close value. */
  needsOutputClose: Array<{ toolCallId: string; toolName: string }>;
}

/** Public API contract for hosted mirrored open tool call logger. */
export interface HostedMirroredOpenToolCallLogger {
  /** Writes a warning log entry. */
  warn: (message: string, metadata?: Record<string, unknown>) => void;
}

/** Public API contract for hosted mirrored UI stream logger. */
export interface HostedMirroredUiStreamLogger extends HostedMirroredOpenToolCallLogger {
  /** Writes an error log entry. */
  error: (message: string, metadata?: Record<string, unknown>) => void;
}

/** Public API contract for hosted mirrored UI stream watchdog. */
export interface HostedMirroredUiStreamWatchdog {
  /** Callback that handles observe. */
  observe: (chunk: ChatUiMessageChunk<ChatMessageMetadata>) => void;
  /** Callback that handles dispose. */
  dispose: () => void;
}

/** Input payload for create hosted mirrored UI stream. */
export interface CreateHostedMirroredUiStreamInput {
  /** Source stream value. */
  sourceStream: AsyncIterable<ChatUiMessageChunk<ChatMessageMetadata>>;
  /** Root stream watchdog value. */
  rootStreamWatchdog: HostedMirroredUiStreamWatchdog;
  /** Mirrored tool chunk state value. */
  mirroredToolChunkState: MirroredToolChunkState;
  /** Append chunk value. */
  appendChunk?: (
    chunk: ChatUiMessageChunk<ChatMessageMetadata>,
  ) => Promise<void> | void;
  /** Callback that handles set mirrored output. */
  setMirroredOutput?: (value: boolean) => void;
  /** Logger value. */
  logger?: HostedMirroredUiStreamLogger;
}

/** Input payload for close hosted mirrored open tool calls. */
export interface CloseHostedMirroredOpenToolCallsInput {
  /** Mirrored tool chunk state value. */
  mirroredToolChunkState: MirroredToolChunkState;
  /** Error text value. */
  errorText: string;
  /** Append chunk value. */
  appendChunk: (
    chunk: ChatUiMessageChunk<ChatMessageMetadata>,
  ) => Promise<void> | void;
  /** Logger value. */
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

/** Create hosted mirrored UI stream. */
export async function* createHostedMirroredUiStream(
  input: CreateHostedMirroredUiStreamInput,
): AsyncIterable<ChatUiMessageChunk<ChatMessageMetadata>> {
  let streamError: unknown = null;

  try {
    for await (const chunk of input.sourceStream) {
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
      yield chunk;
    }
  } catch (error) {
    streamError = error;
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
