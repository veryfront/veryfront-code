/**
 * Claude Code SDK Integration
 *
 * Provides Claude Code agentic capabilities within Veryfront workflows.
 *
 * @example
 * ```typescript
 * import { workflow, step } from "veryfront/ai/workflow";
 * import { claudeCodeTool } from "veryfront/ai/workflow/claude-code";
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

// Agent (non-streaming)
export { claudeCodeAgent, defaultClaudeCodeAgent } from "./agent.ts";
export type { ClaudeCodeAgentInstance, ClaudeCodeAgentResponse } from "./agent.ts";

// Agent (streaming)
export { streamingClaudeCodeAgent } from "./streaming-agent.ts";

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

// Workspace Sync (for Claude Code file operations)
export { createWorkspaceSync, withWorkspace, WorkspaceSync } from "./workspace-sync.ts";

export type {
  FileChange,
  UploadResult,
  WorkspaceConfig,
  WorkspaceSyncResult,
} from "./workspace-sync.ts";

// Types
export type {
  // Core types
  AnthropicToolDefinition,
  // Bidirectional types
  ApprovalRequestEvent,
  BashToolInput,
  BidirectionalPublisher,
  CancelCommand,
  CancelledEvent,
  ClaudeCodeAgentConfig,
  ClaudeCodeContext,
  // Streaming types
  ClaudeCodeEvent,
  ClaudeCodeEventBase,
  ClaudeCodeEventHandler,
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
  ClaudeCodeEventType,
  ClaudeCodeMode,
  ClaudeCodeResult,
  ClaudeCodeStreamingConfig,
  ClaudeCodeToolInput,
  ClaudeToolCall,
  ClaudeToolResult,
  ClientCommand,
  ClientCommandHandler,
  ClientCommandType,
  CommandExecution,
  CompleteEvent,
  ComputerToolInput,
  ErrorEvent,
  FileOperation,
  InputCommand,
  InputRequestEvent,
  IterationCompleteEvent,
  IterationResult,
  IterationStartEvent,
  PingCommand,
  PongEvent,
  SandboxMode,
  TextCompleteEvent,
  TextDeltaEvent,
  TextEditorToolInput,
  ThinkingCompleteEvent,
  ThinkingDeltaEvent,
  ThinkingStartEvent,
  ToolApprovalConfig,
  ToolCallCompleteEvent,
  ToolCallInputEvent,
  ToolCallStartEvent,
  ToolResultEvent,
} from "./types.ts";
