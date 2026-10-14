/** Parse replay tool parts without changing their object identities. */
import { isRecord } from "./part-field-access.ts";
import {
  buildToolResultOutput,
  getRawToolCallPart,
  getRawToolResultPart,
  getToolPart,
  hasSelfContainedRawToolCallResult,
} from "./message-part-parsing.ts";
import type { ChatUiMessageRole } from "./types.ts";

export function isTransientToolState(state: string | undefined): boolean {
  return state === "pending" || state === "input-available" || state === "input-streaming" ||
    state === "streaming" || state === "approval-requested" || state === "approval-responded";
}

export type ReplayToolCallPart = {
  part: object;
  toolCallId: string;
  toolName: string;
  transient: boolean;
  selfContainedResult: boolean;
};

export function getReplayToolCallPart(
  part: unknown,
  role: ChatUiMessageRole,
): ReplayToolCallPart | null {
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

export function getReplayToolResultPart(part: unknown, role: ChatUiMessageRole): {
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
