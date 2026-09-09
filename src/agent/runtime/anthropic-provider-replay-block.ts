import {
  appendPrivateArray,
  concatPrivateArrays,
  everyPrivateArray,
  pushPrivateArray,
} from "#veryfront/security/private-array.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";

const isArray = Array.isArray;
const hasOwn = Object.hasOwn;

// Anthropic reports provider tool failures with the ordinary outer result type
// and the error record inside `content`. An outer `*_tool_result_error` block
// would only defer the failure until the provider request parser rejects it.
const ANTHROPIC_PROVIDER_TOOL_RESULT_TYPES = createPrivateSet([
  "web_search_tool_result",
  "web_fetch_tool_result",
  "code_execution_tool_result",
  "bash_code_execution_tool_result",
  "text_editor_code_execution_tool_result",
  "mcp_tool_result",
]);

/** Identify one Anthropic provider-executed tool-result block. */
export function isAnthropicProviderToolResultBlock(block: Record<string, unknown>): boolean {
  return typeof block.type === "string" && ANTHROPIC_PROVIDER_TOOL_RESULT_TYPES.has(block.type);
}

/** Group raw Anthropic responses around the assistant anchors they project. */
export function groupAnthropicRawAssistantMessagesByAnchor(
  rawAssistantMessages: unknown,
  anchorCount: number,
): Record<string, unknown>[][][] | undefined {
  if (!isArray(rawAssistantMessages)) return undefined;
  const grouped: Record<string, unknown>[][][] = [];
  let pendingResults: Record<string, unknown>[][] = [];
  for (let index = 0; index < rawAssistantMessages.length; index++) {
    if (!hasOwn(rawAssistantMessages, index)) return undefined;
    const rawAssistantMessage = rawAssistantMessages[index];
    if (
      !isArray(rawAssistantMessage) ||
      !everyPrivateArray(
        rawAssistantMessage,
        (block) => block !== null && typeof block === "object" && !isArray(block),
      )
    ) {
      return undefined;
    }
    const blocks = rawAssistantMessage as Record<string, unknown>[];
    if (blocks.length > 0 && everyPrivateArray(blocks, isAnthropicProviderToolResultBlock)) {
      pushPrivateArray(pendingResults, blocks);
      continue;
    }
    if (grouped.length >= anchorCount) return undefined;
    pushPrivateArray(grouped, concatPrivateArrays(pendingResults, [blocks]));
    pendingResults = [];
  }
  if (pendingResults.length > 0) {
    const finalGroup = grouped.length > 0 ? grouped[grouped.length - 1] : undefined;
    if (!finalGroup) return undefined;
    appendPrivateArray(finalGroup, pendingResults);
  }
  return grouped.length === anchorCount ? grouped : undefined;
}

/** Collect provider-executed tool call IDs from raw Anthropic responses. */
export function collectAnthropicProviderToolCallIds(
  rawAssistantMessages: unknown,
): Set<string> {
  const ids = createPrivateSet<string>();
  if (!isArray(rawAssistantMessages)) return ids;
  for (let index = 0; index < rawAssistantMessages.length; index++) {
    if (!hasOwn(rawAssistantMessages, index)) continue;
    const rawAssistantMessage = rawAssistantMessages[index];
    if (!isArray(rawAssistantMessage)) continue;
    for (let blockIndex = 0; blockIndex < rawAssistantMessage.length; blockIndex++) {
      if (!hasOwn(rawAssistantMessage, blockIndex)) continue;
      const block = rawAssistantMessage[blockIndex];
      if (
        block !== null &&
        typeof block === "object" &&
        !isArray(block) &&
        ((block as Record<string, unknown>).type === "server_tool_use" ||
          (block as Record<string, unknown>).type === "mcp_tool_use") &&
        typeof (block as Record<string, unknown>).id === "string"
      ) {
        ids.add((block as Record<string, unknown>).id as string);
      }
    }
  }
  return ids;
}
