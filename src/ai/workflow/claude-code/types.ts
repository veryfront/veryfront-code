/**
 * Claude Code SDK Integration Types
 *
 * Type definitions for the Claude Code harness.
 */

import type { Tool } from "../../types/tool.ts";

/**
 * Tool modes for Claude Code agent
 */
export type ClaudeCodeMode =
  | "code" // bash + file editor
  | "analysis" // file reader only (read-only)
  | "full" // bash + file editor + computer
  | "custom"; // user-specified tools only

/**
 * Sandbox modes for execution isolation
 */
export type SandboxMode =
  | "strict" // Containerized, no network
  | "permissive" // Process isolation only
  | "none"; // Direct execution (dev only)

/**
 * Claude Code tool types (Anthropic API format)
 */
export type ClaudeToolType =
  | "bash_20250124"
  | "text_editor_20250124"
  | "computer_20250124";

/**
 * Anthropic tool definition format
 */
export interface AnthropicToolDefinition {
  type: ClaudeToolType;
  name: string;
  // Computer use specific
  display_width_px?: number;
  display_height_px?: number;
  display_number?: number;
}

/**
 * Tool call from Claude response
 */
export interface ClaudeToolCall {
  id: string;
  type: "tool_use";
  name: string;
  input: Record<string, unknown>;
}

/**
 * Tool result to send back
 */
export interface ClaudeToolResult {
  type: "tool_result";
  tool_use_id: string;
  content: string | Array<{ type: "text"; text: string } | { type: "image"; source: unknown }>;
  is_error?: boolean;
}

/**
 * Result from a single iteration
 */
export interface IterationResult {
  /** Iteration number */
  iteration: number;
  /** Tool calls made */
  toolCalls: ClaudeToolCall[];
  /** Tool results */
  toolResults: ClaudeToolResult[];
  /** Text response (if any) */
  text?: string;
  /** Whether agent signaled completion */
  completed: boolean;
  /** Stop reason from API */
  stopReason: string;
}

/**
 * File change from workspace sync
 */
export interface FileChange {
  path: string;
  type: "created" | "modified" | "deleted";
  originalChecksum?: string;
  newChecksum?: string;
}

/**
 * Final result from Claude Code execution
 */
export interface ClaudeCodeResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Total iterations */
  iterations: number;
  /** Final text response */
  response?: string;
  /** Files modified (tracked by editor) */
  filesModified: string[];
  /** Commands executed */
  commandsExecuted: string[];
  /** Detected file changes (from workspace sync) */
  changes?: FileChange[];
  /** Error if failed */
  error?: string;
  /** Execution time in ms */
  executionTime: number;
  /** All iteration results (for debugging) */
  iterationHistory: IterationResult[];
}

/**
 * Claude Code agent configuration
 */
export interface ClaudeCodeAgentConfig {
  /** Agent ID (optional) */
  id?: string;

  /** Model to use */
  model?: string;

  /** Tool mode */
  mode?: ClaudeCodeMode;

  /** Sandbox mode */
  sandbox?: SandboxMode;

  /** Maximum agentic loop iterations */
  maxIterations?: number;

  /** Timeout per iteration in ms */
  iterationTimeout?: number;

  /** Total timeout in ms */
  totalTimeout?: number;

  /** Custom tools to add */
  tools?: Record<string, Tool>;

  /** System prompt override */
  system?: string;

  /** Enable debug logging */
  debug?: boolean;

  /** Streaming configuration */
  streaming?: ClaudeCodeStreamingConfig;

  /** Workflow run ID (for event context) */
  runId?: string;

  /** Callbacks */
  onToolCall?: (tool: string, input: unknown) => void | Promise<void>;
  onToolResult?: (tool: string, result: unknown, error?: boolean) => void | Promise<void>;
  onIteration?: (iteration: number, result: IterationResult) => void | Promise<void>;
  onComplete?: (result: ClaudeCodeResult) => void | Promise<void>;
}

/**
 * Input for claude-code tool
 */
export interface ClaudeCodeToolInput {
  /** Task description for the agent */
  task: string;

  /** Tool mode (default: "code") */
  mode?: ClaudeCodeMode;

  /** Sandbox mode (default: from config) */
  sandbox?: SandboxMode;

  /** Maximum iterations (default: 20) */
  maxIterations?: number;

  /** Files to focus on */
  files?: string[];

  /** Additional context to include */
  context?: Record<string, unknown>;

  /** Custom system prompt */
  system?: string;
}

/**
 * Workspace sync interface (imported from workspace-sync.ts)
 * Defined here to avoid circular imports
 */
export interface WorkspaceSyncInterface {
  /** Local workspace directory */
  workspaceDir: string;
  /** Read a file from workspace */
  readFile(path: string): Promise<string>;
  /** Write a file to workspace */
  writeFile(path: string, content: string): Promise<void>;
  /** Delete a file from workspace */
  deleteFile(path: string): Promise<void>;
  /** Check if file exists */
  fileExists(path: string): Promise<boolean>;
}

/**
 * Execution context for Claude Code
 */
export interface ClaudeCodeContext {
  /** Current project slug */
  projectSlug: string;

  /** Project ID */
  projectId?: string;

  /** Working directory (for bash) */
  workingDir: string;

  /** Local workspace for file operations */
  workspace?: WorkspaceSyncInterface;

  /** Files that have been modified */
  modifiedFiles: Set<string>;

  /** Commands that have been executed */
  executedCommands: string[];

  /** Current iteration */
  iteration: number;

  /** Start time */
  startTime: number;
}

/**
 * Bash tool input (Anthropic format)
 */
export interface BashToolInput {
  command: string;
  restart?: boolean;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Text editor tool input (Anthropic format)
 */
export interface TextEditorToolInput {
  command: "view" | "create" | "str_replace" | "insert" | "undo_edit";
  path: string;
  file_text?: string;
  old_str?: string;
  new_str?: string;
  insert_line?: number;
  view_range?: [number, number];
}

/**
 * Computer tool input (Anthropic format)
 */
export interface ComputerToolInput {
  action:
    | "key"
    | "type"
    | "mouse_move"
    | "left_click"
    | "left_click_drag"
    | "right_click"
    | "middle_click"
    | "double_click"
    | "screenshot"
    | "cursor_position"
    | "scroll";
  text?: string;
  coordinate?: [number, number];
  start_coordinate?: [number, number];
  scroll_direction?: "up" | "down" | "left" | "right";
  scroll_amount?: number;
}

/**
 * File operation for tracking changes
 */
export interface FileOperation {
  type: "create" | "modify" | "delete";
  path: string;
  timestamp: Date;
}

/**
 * Command execution record
 */
export interface CommandExecution {
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  timestamp: Date;
  duration: number;
}

// =============================================================================
// Streaming Types
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

/**
 * Streaming configuration for Claude Code agent
 */
export interface ClaudeCodeStreamingConfig {
  /** Enable streaming mode */
  enabled: boolean;

  /** Event publisher for streaming */
  publisher?: ClaudeCodeEventPublisher;

  /** Stream thinking tokens (if model supports) */
  streamThinking?: boolean;

  /** Debounce text deltas (ms) - combines rapid chunks */
  textDeltaDebounce?: number;
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
export interface ClientCommandBase {
  /** Command type */
  type: ClientCommandType;
  /** Timestamp */
  timestamp: number;
  /** Run ID */
  runId: string;
}

/**
 * Cancel the running agent
 */
export interface CancelCommand extends ClientCommandBase {
  type: "cancel";
  /** Optional reason for cancellation */
  reason?: string;
}

/**
 * Approve a pending tool call
 */
export interface ApproveCommand extends ClientCommandBase {
  type: "approve";
  /** Tool call ID to approve */
  toolCallId: string;
}

/**
 * Reject a pending tool call
 */
export interface RejectCommand extends ClientCommandBase {
  type: "reject";
  /** Tool call ID to reject */
  toolCallId: string;
  /** Reason for rejection */
  reason?: string;
}

/**
 * Send user input to the agent
 */
export interface InputCommand extends ClientCommandBase {
  type: "input";
  /** User input content */
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
 * Base interface for extended events (bidirectional communication)
 */
export interface ClaudeCodeEventBaseExtended {
  /** Event type */
  type: ClaudeCodeEventTypeExtended;
  /** Timestamp */
  timestamp: number;
  /** Workflow run ID (if in workflow context) */
  runId?: string;
  /** Current iteration */
  iteration?: number;
}

/**
 * Approval request event (sent to client when tool needs approval)
 */
export interface ApprovalRequestEvent extends ClaudeCodeEventBaseExtended {
  type: "approval_request";
  /** Tool call awaiting approval */
  toolCallId: string;
  /** Tool name */
  toolName: string;
  /** Tool input */
  input: Record<string, unknown>;
  /** Why approval is needed */
  reason: string;
  /** Timeout for approval (ms) */
  timeout?: number;
}

/**
 * Input request event (sent to client when agent needs user input)
 */
export interface InputRequestEvent extends ClaudeCodeEventBaseExtended {
  type: "input_request";
  /** Prompt for the user */
  prompt: string;
  /** Optional default value */
  defaultValue?: string;
  /** Timeout for input (ms) */
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
  /** Reason for cancellation */
  reason?: string;
}

/**
 * Extended event type including bidirectional events
 */
export type ClaudeCodeEventTypeExtended =
  | ClaudeCodeEventType
  | "approval_request"
  | "input_request"
  | "pong"
  | "cancelled";

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
