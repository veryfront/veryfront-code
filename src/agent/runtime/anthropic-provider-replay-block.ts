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
