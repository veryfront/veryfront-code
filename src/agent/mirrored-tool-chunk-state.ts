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
