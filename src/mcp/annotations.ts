/**
 * Behavioral hints for MCP clients (MCP 2025-11-25).
 * Guides auto-approval, confirmation prompts, and caching.
 */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}
