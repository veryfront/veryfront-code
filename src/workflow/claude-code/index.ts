/**
 * Claude Agent SDK Integration
 *
 * Provides Claude Code agentic capabilities within Veryfront workflows.
 * Uses your local Claude Code installation — no separate API key needed.
 *
 * @example
 * ```typescript
 * import { workflow, step } from "veryfront/workflow";
 * import { claudeCodeTool } from "veryfront/workflow/claude-code";
 *
 * export const migration = workflow({
 *   id: "migration",
 *   steps: [
 *     step("migrate", {
 *       tool: "claude-code",
 *       input: {
 *         task: "Migrate from React 17 to React 19",
 *         mode: "code",
 *       },
 *     }),
 *   ],
 * });
 * ```
 */

// Agent
export { createAgent, executeAgent } from "./agent.ts";
export type { AgentConfig } from "./agent.ts";

// Tools
export {
  bugFixTool,
  claudeCodeTool,
  codeReviewTool,
  createClaudeCodeTool,
  docsTool,
  refactorTool,
} from "./tool.ts";

// Event Publishers (one-way)
export {
  CallbackEventPublisher,
  createEventPublisher,
  MemoryEventPublisher,
  MultiEventPublisher,
  RedisEventPublisher,
  SSEEventPublisher,
} from "./event-publisher.ts";

export type { RedisEventPublisherConfig } from "./event-publisher.ts";

// WebSocket Publisher (bidirectional)
export {
  AgentController,
  createWebSocketHandler,
  WebSocketPublisher,
} from "./websocket-publisher.ts";

export type { WebSocketPublisherConfig } from "./websocket-publisher.ts";

// Workspace Sync (for cloud deployments with API-backed file operations)
export { createWorkspaceSync, withWorkspace, WorkspaceSync } from "./workspace-sync.ts";

export type {
  FileChange,
  UploadResult,
  WorkspaceConfig,
  WorkspaceSyncResult,
} from "./workspace-sync.ts";

// Types
export type {
  // Bidirectional types
  ApprovalRequestEvent,
  BidirectionalPublisher,
  CancelCommand,
  CancelledEvent,
  // Streaming event types
  ClaudeCodeEvent,
  ClaudeCodeEventBase,
  ClaudeCodeEventHandler,
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
  ClaudeCodeEventType,
  // Core types
  ClaudeCodeMode,
  ClaudeCodeResult,
  ClaudeCodeToolInput,
  ClientCommand,
  ClientCommandHandler,
  ClientCommandType,
  CompleteEvent,
  ErrorEvent,
  InputCommand,
  InputRequestEvent,
  IterationCompleteEvent,
  IterationStartEvent,
  PingCommand,
  PongEvent,
  TextCompleteEvent,
  TextDeltaEvent,
  ThinkingCompleteEvent,
  ThinkingDeltaEvent,
  ThinkingStartEvent,
  ToolApprovalConfig,
  ToolCallCompleteEvent,
  ToolCallInputEvent,
  ToolCallStartEvent,
  ToolResultEvent,
} from "./types.ts";
