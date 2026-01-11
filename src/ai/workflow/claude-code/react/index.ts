/**
 * React hooks for Claude Code streaming
 */

// SSE (one-way)
export {
  useClaudeCodeStream,
  useClaudeCodeText,
  type UseClaudeCodeStreamOptions,
  type UseClaudeCodeStreamState,
} from "./use-claude-code-stream.ts";

// WebSocket (bidirectional)
export {
  useClaudeCodeWebSocket,
  type PendingApproval,
  type PendingInput,
  type UseClaudeCodeWebSocketActions,
  type UseClaudeCodeWebSocketOptions,
  type UseClaudeCodeWebSocketState,
} from "./use-claude-code-websocket.ts";
