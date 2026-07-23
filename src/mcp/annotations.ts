/**
 * Behavioral hints for MCP clients (MCP 2025-11-25).
 * Guides auto-approval, confirmation prompts, and caching.
 */
export interface ToolAnnotations {
  /** Human-readable fallback title for clients using tool annotations. */
  title?: string;
  /** Whether execution reads state without changing it. */
  readOnlyHint?: boolean;
  /** Whether execution can irreversibly change or remove state. */
  destructiveHint?: boolean;
  /** Whether repeated execution with the same input has the same effect. */
  idempotentHint?: boolean;
  /** Whether execution can interact with systems outside the MCP server. */
  openWorldHint?: boolean;
}
