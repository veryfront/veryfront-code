/**
 * @module
 * React hooks for Claude Code streaming
 */

// SSE (one-way)
export {
  useClaudeCodeStream,
  type UseClaudeCodeStreamOptions,
  type UseClaudeCodeStreamState,
  useClaudeCodeText,
} from "./use-claude-code-stream.ts";

// WebSocket (bidirectional)
export {
  type PendingApproval,
  type PendingInput,
  useClaudeCodeWebSocket,
  type UseClaudeCodeWebSocketActions,
  type UseClaudeCodeWebSocketOptions,
  type UseClaudeCodeWebSocketState,
} from "./use-claude-code-websocket.ts";
