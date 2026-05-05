import type { ChatMessageMetadata, ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";

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

export interface MirroredToolChunkState {
  startedToolCallIds: Set<string>;
  inputAvailableToolCallIds: Set<string>;
  outputAvailableToolCallIds: Set<string>;
  outputErrorToolCallIds: Set<string>;
  outputDeniedToolCallIds: Set<string>;
  toolCallNames: Map<string, string>;
}

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

export interface OpenToolCalls {
  needsInputClose: Array<{ toolCallId: string; toolName: string }>;
  needsOutputClose: Array<{ toolCallId: string; toolName: string }>;
}

export interface HostedMirroredOpenToolCallLogger {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
}

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

export function getHostedMirroredAbortErrorText(streamError: unknown): string {
  if (isAbortErrorLike(streamError)) {
    return "Chat stream aborted before tool call completed";
  }

  return `Chat stream errored before tool call completed: ${
    streamError instanceof Error ? streamError.message : String(streamError)
  }`;
}

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
