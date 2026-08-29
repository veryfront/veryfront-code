// Anthropic reports provider tool failures with the ordinary outer result type
// and the error record inside `content`. An outer `*_tool_result_error` block
// would only defer the failure until the provider request parser rejects it.
const ANTHROPIC_PROVIDER_TOOL_RESULT_TYPES = new Set([
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
  rawAssistantMessages: readonly unknown[],
  anchorCount: number,
): Record<string, unknown>[][][] | undefined {
  const grouped: Record<string, unknown>[][][] = [];
  let pendingResults: Record<string, unknown>[][] = [];
  for (const rawAssistantMessage of rawAssistantMessages) {
    if (
      !Array.isArray(rawAssistantMessage) ||
      !rawAssistantMessage.every((block) =>
        block !== null && typeof block === "object" && !Array.isArray(block)
      )
    ) {
      return undefined;
    }
    const blocks = rawAssistantMessage as Record<string, unknown>[];
    if (blocks.length > 0 && blocks.every(isAnthropicProviderToolResultBlock)) {
      pendingResults.push(blocks);
      continue;
    }
    if (grouped.length >= anchorCount) return undefined;
    grouped.push([...pendingResults, blocks]);
    pendingResults = [];
  }
  if (pendingResults.length > 0) {
    const finalGroup = grouped.at(-1);
    if (!finalGroup) return undefined;
    finalGroup.push(...pendingResults);
  }
  return grouped.length === anchorCount ? grouped : undefined;
}
