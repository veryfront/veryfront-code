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

// Types
export type {
  // Core types
  AnthropicToolDefinition,
  BashToolInput,
  ClaudeCodeAgentConfig,
  ClaudeCodeContext,
  ClaudeCodeMode,
  ClaudeCodeResult,
  ClaudeCodeToolInput,
  ClaudeToolCall,
  ClaudeToolResult,
  CommandExecution,
  ComputerToolInput,
  FileOperation,
  IterationResult,
  SandboxMode,
  TextEditorToolInput,
  // Streaming types
  ClaudeCodeEvent,
  ClaudeCodeEventBase,
  ClaudeCodeEventHandler,
  ClaudeCodeEventPublisher,
  ClaudeCodeEventSubscriber,
  ClaudeCodeEventType,
  ClaudeCodeStreamingConfig,
  CompleteEvent,
  ErrorEvent,
  IterationCompleteEvent,
  IterationStartEvent,
  TextCompleteEvent,
  TextDeltaEvent,
  ThinkingCompleteEvent,
  ThinkingDeltaEvent,
  ThinkingStartEvent,
  ToolCallCompleteEvent,
  ToolCallInputEvent,
  ToolCallStartEvent,
  ToolResultEvent,
  // Bidirectional types
  ApprovalRequestEvent,
  BidirectionalPublisher,
  CancelCommand,
  CancelledEvent,
  ClientCommand,
  ClientCommandHandler,
  ClientCommandType,
  InputCommand,
  InputRequestEvent,
  PingCommand,
  PongEvent,
  ToolApprovalConfig,
} from "./types.ts";
