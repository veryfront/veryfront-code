/**
 * Tool replay reconciliation.
 *
 * The single owner of deciding which tool-call and tool-result occurrences in
 * UI-message replay history are authoritative for provider conversion. Matching
 * is by part *object identity*, so a single pass over history can mark parts as
 * matched, superseded, batch-starting, or transient-but-preserved without
 * mutating them.
 */
import { isRecord } from "./part-field-access.ts";
import {
  buildToolResultOutput,
  getFilePart,
  getRawToolCallPart,
  getRawToolResultPart,
  getToolPart,
  hasSelfContainedRawToolCallResult,
  isProviderVisibleReasoningPart,
  isTextPart,
} from "./message-part-parsing.ts";
import type { ChatUiMessageRole } from "./types.ts";
import type { ChatProviderModelInputMessage } from "./provider-input-types.ts";

export function isTransientToolState(state: string | undefined): boolean {
  return state === "pending" || state === "input-available" || state === "input-streaming" ||
    state === "streaming" || state === "approval-requested" || state === "approval-responded";
}

type ReplayToolCallPart = {
  part: object;
  toolCallId: string;
  toolName: string;
  transient: boolean;
  selfContainedResult: boolean;
};

type PendingReplayToolCall = Omit<ReplayToolCallPart, "selfContainedResult"> & {
  originMessageIndex: number;
};

function getReplayToolCallPart(part: unknown, role: ChatUiMessageRole): ReplayToolCallPart | null {
  if (role !== "assistant") {
    return null;
  }

  if (!isRecord(part)) {
    return null;
  }

  const toolPart = getToolPart(part);
  if (toolPart) {
    return {
      part,
      toolCallId: toolPart.toolCallId,
      toolName: toolPart.toolName,
      transient: isTransientToolState(toolPart.state),
      selfContainedResult: buildToolResultOutput(toolPart) !== null,
    };
  }

  const rawToolCall = getRawToolCallPart(part);
  if (!rawToolCall) {
    return null;
  }

  return {
    part,
    toolCallId: rawToolCall.toolCallId,
    toolName: rawToolCall.toolName,
    transient: isTransientToolState(rawToolCall.state),
    selfContainedResult: hasSelfContainedRawToolCallResult(rawToolCall),
  };
}

function getReplayToolResultPart(part: unknown, role: ChatUiMessageRole): {
  part: object;
  toolCallId: string;
  toolName?: string;
} | null {
  if (role !== "assistant" && role !== "tool") {
    return null;
  }

  if (!isRecord(part)) {
    return null;
  }

  const rawToolResult = getRawToolResultPart(part);
  if (rawToolResult) {
    return {
      part,
      toolCallId: rawToolResult.toolCallId,
      ...(rawToolResult.toolName ? { toolName: rawToolResult.toolName } : {}),
    };
  }

  const toolPart = getToolPart(part);
  if (role === "tool" && toolPart && buildToolResultOutput(toolPart)) {
    return {
      part,
      toolCallId: toolPart.toolCallId,
      toolName: toolPart.toolName,
    };
  }

  return null;
}

function isProviderVisibleNonToolPart(role: ChatUiMessageRole, part: unknown): boolean {
  if (role === "system") {
    return isTextPart(part) && part.text.length > 0;
  }

  if (role === "user") {
    return isTextPart(part) && part.text.length > 0 || getFilePart(part) !== null;
  }

  if (role === "assistant") {
    return isTextPart(part) && part.text.length > 0 || isProviderVisibleReasoningPart(part) ||
      getFilePart(part) !== null;
  }

  return false;
}

function isCompatibleToolResultName(
  call: { toolName: string },
  result: { toolName?: string },
): boolean {
  return !result.toolName || result.toolName === call.toolName;
}

function removePendingCallsThroughMatchedResult(
  pendingCalls: PendingReplayToolCall[],
  matchedIndex: number,
  toolCallId: string,
): void {
  const priorUnmatchedCalls = pendingCalls.slice(0, matchedIndex).filter((pendingCall) =>
    pendingCall.toolCallId !== toolCallId
  );
  pendingCalls.splice(0, matchedIndex + 1, ...priorUnmatchedCalls);
}

function removePendingCallsWithId(
  pendingCalls: Array<{ toolCallId: string }>,
  toolCallId: string,
): void {
  for (let index = pendingCalls.length - 1; index >= 0; index--) {
    if (pendingCalls[index]?.toolCallId === toolCallId) {
      pendingCalls.splice(index, 1);
    }
  }
}

function removePendingCallsFromEarlierMessages(
  pendingCalls: Array<{ originMessageIndex: number }>,
  messageIndex: number,
): void {
  for (let index = pendingCalls.length - 1; index >= 0; index--) {
    if ((pendingCalls[index]?.originMessageIndex ?? messageIndex) < messageIndex) {
      pendingCalls.splice(index, 1);
    }
  }
}

function hasPendingCallsFromEarlierMessages(
  pendingCalls: Array<{ originMessageIndex: number }>,
  messageIndex: number,
): boolean {
  return pendingCalls.some((pendingCall) => pendingCall.originMessageIndex < messageIndex);
}

/** Tool replay parts that are valid to expose to provider conversion. */
export type ProviderVisibleToolReplayMatches = {
  preservedTransientToolParts: WeakSet<object>;
  matchedToolCallParts: WeakSet<object>;
  matchedToolResultParts: WeakSet<object>;
  matchedToolResultNames: WeakMap<object, string>;
  toolCallPartsStartingNewBatch: WeakSet<object>;
  supersededToolCallParts: WeakSet<object>;
  supersededToolResultParts: WeakSet<object>;
};

/** Find adjacent replay call/result occurrences using part object identity. */
export function findProviderVisibleToolReplayMatches(
  messages: readonly ChatProviderModelInputMessage[],
): ProviderVisibleToolReplayMatches {
  const preservedTransientToolParts = new WeakSet<object>();
  const matchedToolCallParts = new WeakSet<object>();
  const matchedToolResultParts = new WeakSet<object>();
  const matchedToolResultNames = new WeakMap<object, string>();
  const toolCallPartsStartingNewBatch = new WeakSet<object>();
  const supersededToolCallParts = new WeakSet<object>();
  const supersededToolResultParts = new WeakSet<object>();
  const matchedResultPartByCallPart = new WeakMap<object, object>();
  const toolCallsById = new Map<string, ReplayToolCallPart[]>();
  const pendingCalls: PendingReplayToolCall[] = [];

  for (const [messageIndex, message] of messages.entries()) {
    let pendingCountBeforeSameMessageVisibleContent: number | null = null;

    for (const part of message.parts) {
      const call = getReplayToolCallPart(part, message.role);
      if (call) {
        const callsWithId = toolCallsById.get(call.toolCallId) ?? [];
        callsWithId.push(call);
        toolCallsById.set(call.toolCallId, callsWithId);

        if (hasPendingCallsFromEarlierMessages(pendingCalls, messageIndex)) {
          toolCallPartsStartingNewBatch.add(call.part);
        }
        removePendingCallsFromEarlierMessages(pendingCalls, messageIndex);
        if (pendingCountBeforeSameMessageVisibleContent !== null) {
          pendingCalls.splice(0, pendingCountBeforeSameMessageVisibleContent);
          pendingCountBeforeSameMessageVisibleContent = null;
        }
        removePendingCallsWithId(pendingCalls, call.toolCallId);
        if (call.selfContainedResult) {
          for (const priorCall of callsWithId) {
            if (priorCall.part === call.part) {
              continue;
            }

            supersededToolCallParts.add(priorCall.part);
            const priorResultPart = matchedResultPartByCallPart.get(priorCall.part);
            if (priorResultPart) {
              supersededToolResultParts.add(priorResultPart);
            }
          }
          continue;
        }

        pendingCalls.push({ ...call, originMessageIndex: messageIndex });
        continue;
      }

      const result = getReplayToolResultPart(part, message.role);
      if (result) {
        const matchedIndex = pendingCalls.findLastIndex((pendingCall) =>
          pendingCall.toolCallId === result.toolCallId &&
          isCompatibleToolResultName(pendingCall, result)
        );
        if (matchedIndex >= 0) {
          const matchedCall = pendingCalls[matchedIndex];
          if (!matchedCall) {
            continue;
          }
          if (matchedCall.transient) {
            preservedTransientToolParts.add(matchedCall.part);
          }
          for (const priorCall of toolCallsById.get(matchedCall.toolCallId) ?? []) {
            if (priorCall.part === matchedCall.part) {
              continue;
            }

            supersededToolCallParts.add(priorCall.part);
            const priorResultPart = matchedResultPartByCallPart.get(priorCall.part);
            if (priorResultPart) {
              supersededToolResultParts.add(priorResultPart);
            }
          }
          matchedToolCallParts.add(matchedCall.part);
          matchedToolResultParts.add(result.part);
          matchedToolResultNames.set(result.part, matchedCall.toolName);
          matchedResultPartByCallPart.set(matchedCall.part, result.part);
          removePendingCallsThroughMatchedResult(pendingCalls, matchedIndex, result.toolCallId);
        }
        continue;
      }

      if (isProviderVisibleNonToolPart(message.role, part)) {
        removePendingCallsFromEarlierMessages(pendingCalls, messageIndex);
        pendingCountBeforeSameMessageVisibleContent ??= pendingCalls.length;
      }
    }

    if (pendingCountBeforeSameMessageVisibleContent !== null) {
      pendingCalls.splice(0, pendingCountBeforeSameMessageVisibleContent);
    }
  }

  return {
    preservedTransientToolParts,
    matchedToolCallParts,
    matchedToolResultParts,
    matchedToolResultNames,
    toolCallPartsStartingNewBatch,
    supersededToolCallParts,
    supersededToolResultParts,
  };
}
