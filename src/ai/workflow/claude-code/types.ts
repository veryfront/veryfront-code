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
 * Final result from Claude Code execution
 */
export interface ClaudeCodeResult {
  /** Whether execution succeeded */
  success: boolean;
  /** Total iterations */
  iterations: number;
  /** Final text response */
  response?: string;
  /** Files modified */
  filesModified: string[];
  /** Commands executed */
  commandsExecuted: string[];
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
 * Execution context for Claude Code
 */
export interface ClaudeCodeContext {
  /** Current project slug */
  projectSlug: string;

  /** Project ID */
  projectId?: string;

  /** Working directory (for bash) */
  workingDir: string;

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
