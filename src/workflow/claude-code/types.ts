/**
 * Claude Agent SDK Integration Types
 *
 * Type definitions for the Claude Agent SDK workflow tools.
 */

/**
 * Tool modes for Claude Code agent
 */
export type ClaudeCodeMode =
  | "code" // read-write (maps to SDK acceptEdits)
  | "analysis" // read-only (maps to SDK plan)
  | "custom"; // user-specified (maps to SDK default)

/**
 * File change from workspace operations
 */
export interface FileChange {
  path: string;
  type: "created" | "modified" | "deleted";
  originalChecksum?: string;
  newChecksum?: string;
}

/**
 * Final result from agent execution
 */
export interface ClaudeCodeResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Total turns */
  iterations: number;
  /** Final text response */
  response?: string;
  /** Files modified */
  filesModified: string[];
  /** Commands executed */
  commandsExecuted: string[];
  /** Detected file changes (from workspace sync) */
  changes?: FileChange[];
  /** Error if failed */
  error?: string;
  /** Execution time in ms */
  executionTime: number;
}

/**
 * Input schema type for claude-code workflow tools
 */
export interface ClaudeCodeToolInput {
  /** Task description for the agent */
  task: string;
  /** Tool mode (default: "code") */
  mode?: ClaudeCodeMode;
  /** Maximum turns (default: 20) */
  maxTurns?: number;
  /** Files to focus on */
  files?: string[];
  /** Additional context to include */
  context?: Record<string, unknown>;
  /** Custom system prompt */
  system?: string;
}

// =============================================================================
// Streaming Event Types
// (used by event-publisher.ts and websocket-publisher.ts)
// =============================================================================

/**
 * Event types for streaming Claude Code execution
 */
export type ClaudeCodeEventType =
  | "iteration_start"
  | "text_delta"
  | "text_complete"
  | "tool_call_start"
  | "tool_call_input"
  | "tool_call_complete"
  | "tool_result"
  | "iteration_complete"
  | "thinking_start"
  | "thinking_delta"
  | "thinking_complete"
  | "complete"
  | "error";

/**
 * Base event interface
 */
export interface ClaudeCodeEventBase {
  /** Event type */
  type: ClaudeCodeEventType;
  /** Timestamp */
  timestamp: number;
  /** Workflow run ID (if in workflow context) */
  runId?: string;
  /** Current iteration */
  iteration?: number;
}

/**
 * Iteration start event
 */
export interface IterationStartEvent extends ClaudeCodeEventBase {
  type: "iteration_start";
  iteration: number;
  maxIterations: number;
}

/**
 * Text delta event (streaming text chunk)
 */
export interface TextDeltaEvent extends ClaudeCodeEventBase {
  type: "text_delta";
  content: string;
}

/**
 * Text complete event
 */
export interface TextCompleteEvent extends ClaudeCodeEventBase {
  type: "text_complete";
  content: string;
}

/**
 * Tool call start event
 */
export interface ToolCallStartEvent extends ClaudeCodeEventBase {
  type: "tool_call_start";
  toolCallId: string;
  toolName: string;
}

/**
 * Tool call input delta (streaming input JSON)
 */
export interface ToolCallInputEvent extends ClaudeCodeEventBase {
  type: "tool_call_input";
  toolCallId: string;
  inputDelta: string;
}

/**
 * Tool call complete event
 */
export interface ToolCallCompleteEvent extends ClaudeCodeEventBase {
  type: "tool_call_complete";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
}

/**
 * Tool result event
 */
export interface ToolResultEvent extends ClaudeCodeEventBase {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  output: string;
  isError: boolean;
}

/**
 * Iteration complete event
 */
export interface IterationCompleteEvent extends ClaudeCodeEventBase {
  type: "iteration_complete";
  iteration: number;
  toolCallCount: number;
  hasMoreWork: boolean;
}

/**
 * Thinking start event (extended thinking)
 */
export interface ThinkingStartEvent extends ClaudeCodeEventBase {
  type: "thinking_start";
}

/**
 * Thinking delta event
 */
export interface ThinkingDeltaEvent extends ClaudeCodeEventBase {
  type: "thinking_delta";
  content: string;
}

/**
 * Thinking complete event
 */
export interface ThinkingCompleteEvent extends ClaudeCodeEventBase {
  type: "thinking_complete";
  content: string;
}

/**
 * Complete event (agent finished)
 */
export interface CompleteEvent extends ClaudeCodeEventBase {
  type: "complete";
  result: ClaudeCodeResult;
}

/**
 * Error event
 */
export interface ErrorEvent extends ClaudeCodeEventBase {
  type: "error";
  message: string;
  code?: string;
  recoverable: boolean;
}

/**
 * Union of all event types
 */
export type ClaudeCodeEvent =
  | IterationStartEvent
  | TextDeltaEvent
  | TextCompleteEvent
  | ToolCallStartEvent
  | ToolCallInputEvent
  | ToolCallCompleteEvent
  | ToolResultEvent
  | IterationCompleteEvent
  | ThinkingStartEvent
  | ThinkingDeltaEvent
  | ThinkingCompleteEvent
  | CompleteEvent
  | ErrorEvent;

/**
 * Event publisher interface for streaming events
 */
export interface ClaudeCodeEventPublisher {
  /** Publish an event */
  publish(event: ClaudeCodeEvent): void | Promise<void>;
  /** Close the publisher */
  close(): void | Promise<void>;
}

/**
 * Event subscriber callback
 */
export type ClaudeCodeEventHandler = (event: ClaudeCodeEvent) => void | Promise<void>;

/**
 * Event subscriber interface for receiving events
 */
export interface ClaudeCodeEventSubscriber {
  /** Subscribe to events for a run */
  subscribe(runId: string, handler: ClaudeCodeEventHandler): Promise<() => void>;
}

// =============================================================================
// Bidirectional Communication Types (WebSocket)
// =============================================================================

/**
 * Client command types for WebSocket communication
 */
export type ClientCommandType =
  | "cancel"
  | "approve"
  | "reject"
  | "input"
  | "ping";

/**
 * Base client command interface
 */
interface ClientCommandBase {
  type: ClientCommandType;
  timestamp: number;
  runId: string;
}

/**
 * Cancel the running agent
 */
export interface CancelCommand extends ClientCommandBase {
  type: "cancel";
  reason?: string;
}

/**
 * Approve a pending tool call
 */
interface ApproveCommand extends ClientCommandBase {
  type: "approve";
  toolCallId: string;
}

/**
 * Reject a pending tool call
 */
interface RejectCommand extends ClientCommandBase {
  type: "reject";
  toolCallId: string;
  reason?: string;
}

/**
 * Send user input to the agent
 */
export interface InputCommand extends ClientCommandBase {
  type: "input";
  content: string;
}

/**
 * Keepalive ping
 */
export interface PingCommand extends ClientCommandBase {
  type: "ping";
}

/**
 * Union of all client commands
 */
export type ClientCommand =
  | CancelCommand
  | ApproveCommand
  | RejectCommand
  | InputCommand
  | PingCommand;

/**
 * Handler for client commands
 */
export type ClientCommandHandler = (command: ClientCommand) => void | Promise<void>;

/**
 * Extended event type including bidirectional events
 */
type ClaudeCodeEventTypeExtended =
  | ClaudeCodeEventType
  | "approval_request"
  | "input_request"
  | "pong"
  | "cancelled";

/**
 * Base interface for extended events (bidirectional communication)
 */
interface ClaudeCodeEventBaseExtended {
  type: ClaudeCodeEventTypeExtended;
  timestamp: number;
  runId?: string;
  iteration?: number;
}

/**
 * Approval request event (sent to client when tool needs approval)
 */
export interface ApprovalRequestEvent extends ClaudeCodeEventBaseExtended {
  type: "approval_request";
  toolCallId: string;
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  timeout?: number;
}

/**
 * Input request event (sent to client when agent needs user input)
 */
export interface InputRequestEvent extends ClaudeCodeEventBaseExtended {
  type: "input_request";
  prompt: string;
  defaultValue?: string;
  timeout?: number;
}

/**
 * Pong response to ping
 */
export interface PongEvent extends ClaudeCodeEventBaseExtended {
  type: "pong";
}

/**
 * Cancelled event
 */
export interface CancelledEvent extends ClaudeCodeEventBaseExtended {
  type: "cancelled";
  reason?: string;
}

/**
 * Extended event union including bidirectional events
 */
export type ClaudeCodeEventExtended =
  | ClaudeCodeEvent
  | ApprovalRequestEvent
  | InputRequestEvent
  | PongEvent
  | CancelledEvent;

/**
 * Bidirectional publisher interface (WebSocket)
 */
export interface BidirectionalPublisher extends ClaudeCodeEventPublisher {
  /** Subscribe to client commands */
  onCommand(handler: ClientCommandHandler): () => void;
  /** Send an event to the client */
  send(event: ClaudeCodeEventExtended): void | Promise<void>;
}

/**
 * Tool approval configuration
 */
export interface ToolApprovalConfig {
  /** Tools that require approval before execution */
  requireApproval?: string[];
  /** Patterns for commands that require approval (for bash) */
  dangerousPatterns?: RegExp[];
  /** Auto-approve after timeout (ms), or reject if undefined */
  autoApproveTimeout?: number;
  /** Default action on timeout: 'approve' | 'reject' */
  timeoutAction?: "approve" | "reject";
}
