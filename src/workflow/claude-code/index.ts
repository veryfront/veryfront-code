/**
 * Claude Agent SDK Integration
 *
 * Provides provider-neutral Claude Code capabilities within Veryfront
 * workflows. Agent execution requires an implementation of the
 * `ClaudeCodeAgentRuntime` extension contract, such as
 * `@veryfront/ext-claude-code-agent`.
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
export { MAX_CLAUDE_CODE_AGENT_TURNS } from "./agent.ts";

// Extension runtime contract
export { ClaudeCodeAgentRuntimeName } from "./runtime-contract.ts";
export type { ClaudeCodeAgentExecutionConfig, ClaudeCodeAgentRuntime } from "./runtime-contract.ts";

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
  createDistributedEventPublisher,
  createEventPublisher,
  MemoryEventPublisher,
  MultiEventPublisher,
  SSEEventPublisher,
} from "./event-publisher.ts";
export type { DistributedEventPublisherOptions } from "./event-publisher.ts";

// WebSocket Publisher (bidirectional)
export {
  AgentController,
  createWebSocketHandler,
  WebSocketPublisher,
} from "./websocket-publisher.ts";

export type { WebSocketPublisherConfig } from "./websocket-publisher.ts";

// Workspace Sync (for cloud deployments with API-backed file operations)
export {
  createWorkspaceSync,
  withWorkspace,
  WorkspaceSync,
  WorkspaceUploadAbortError,
} from "./workspace-sync.ts";

export type {
  FileChange,
  UploadResult,
  WorkspaceConfig,
  WorkspaceFileSource,
  WorkspacePersistenceContext,
  WorkspaceSyncResult,
  WorkspaceUploadPartialResult,
} from "./workspace-sync.ts";

// Types
export type {
  ApprovalRequestEvent,
  // Bidirectional types
  ApproveCommand,
  BidirectionalPublisher,
  CancelCommand,
  CancelledEvent,
  // Streaming event types
  ClaudeCodeEvent,
  ClaudeCodeEventBase,
  ClaudeCodeEventBaseExtended,
  ClaudeCodeEventExtended,
  ClaudeCodeEventHandler,
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
  ClaudeCodeEventType,
  ClaudeCodeEventTypeExtended,
  // Core types
  ClaudeCodeMode,
  ClaudeCodeResult,
  ClaudeCodeToolInput,
  ClientCommand,
  ClientCommandDisposition,
  ClientCommandHandler,
  ClientCommandObserver,
  ClientCommandType,
  CommandAckEvent,
  CompleteEvent,
  ErrorEvent,
  InputCommand,
  InputRequestEvent,
  IterationCompleteEvent,
  IterationStartEvent,
  PingCommand,
  PongEvent,
  RejectCommand,
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
