/**
 * useChat Types
 *
 * Type definitions for the useChat hook - AI SDK v5 compatible.
 *
 * @module ai/react/hooks/use-chat/types
 */

/**
 * Text part - AI SDK v5 compatible
 */
export interface TextUIPart {
  type: "text";
  text: string;
  state?: "streaming" | "done";
}

/**
 * Reasoning part - AI SDK v5 compatible
 */
export interface ReasoningUIPart {
  type: "reasoning";
  text: string;
  state?: "streaming" | "done";
}

/**
 * Tool call state - AI SDK v5 compatible
 */
export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-streaming"
  | "output-available"
  | "output-error";

/**
 * Tool UI part - AI SDK v5 compatible
 * Uses `tool-${toolName}` type pattern for static tools (e.g., "tool-weather")
 * Generic type allows typed tool inputs/outputs
 */
export interface ToolUIPart<NAME extends string = string, INPUT = unknown, OUTPUT = unknown> {
  type: `tool-${NAME}`;
  toolCallId: string;
  toolName: NAME;
  state: ToolState;
  input?: INPUT;
  output?: OUTPUT;
  errorText?: string;
}

/**
 * Tool result part - AI SDK v5 compatible
 */
export interface ToolResultUIPart<RESULT = unknown> {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: RESULT;
  isError?: boolean;
}

/**
 * Dynamic tool UI part - AI SDK v5 compatible
 * Used for MCP tools, user-defined functions, and runtime-loaded tools
 * where input/output types are unknown at compile time
 */
export interface DynamicToolUIPart {
  type: "dynamic-tool";
  toolCallId: string;
  toolName: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

/**
 * All possible UI message parts - AI SDK v5 compatible
 */
export type UIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | ToolUIPart
  | ToolResultUIPart
  | DynamicToolUIPart;

/**
 * UI Message - AI SDK v5 compatible
 * Uses parts array as primary content structure
 */
export interface UIMessage {
  id: string;
  role: "system" | "user" | "assistant";
  parts: UIMessagePart[];
  metadata?: Record<string, unknown>;
  /** Message creation timestamp (optional) */
  createdAt?: Date | string;
}

/**
 * Tool output for addToolOutput - AI SDK v5 compatible
 */
export interface ToolOutput {
  tool: string;
  toolCallId: string;
  output?: unknown;
  state?: "output-available" | "output-error";
  errorText?: string;
}

/**
 * Tool call argument for onToolCall callback - AI SDK v5 compatible
 */
export interface OnToolCallArg {
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    /** Whether this is a dynamic tool (MCP, user-defined, etc.) */
    dynamic?: boolean;
  };
}

/**
 * Options for the useChat hook
 */
export interface UseChatOptions {
  /** API endpoint for chat */
  api: string;

  /** Initial messages */
  initialMessages?: UIMessage[];

  /** Additional data to send */
  body?: Record<string, unknown>;

  /** Custom headers */
  headers?: Record<string, string>;

  /** Credentials mode */
  credentials?: RequestCredentials;

  /** Callback when response received */
  onResponse?: (response: Response) => void;

  /** Callback when message finished */
  onFinish?: (message: UIMessage) => void;

  /** Callback when error occurs */
  onError?: (error: Error) => void;

  /**
   * Callback when tool call is available - AI SDK v5 compatible
   * Use addToolOutput to provide results (don't await inside callback)
   */
  onToolCall?: (arg: OnToolCallArg) => void | Promise<void>;
}

/**
 * Result of the useChat hook
 */
export interface UseChatResult {
  /** Message history - AI SDK v5 UIMessage format */
  messages: UIMessage[];

  /** Current input value */
  input: string;

  /** Loading state */
  isLoading: boolean;

  /** Error state */
  error: Error | null;

  /** Set input value */
  setInput: (input: string) => void;

  /** Send a message - AI SDK v5 compatible */
  sendMessage: (message: { text: string }) => Promise<void>;

  /** Retry last message */
  reload: () => Promise<void>;

  /** Stop generation */
  stop: () => void;

  /** Manually set messages */
  setMessages: (messages: UIMessage[]) => void;

  /**
   * Add tool output - AI SDK v5 compatible
   * Call this from onToolCall to provide tool results
   */
  addToolOutput: (output: ToolOutput) => void;

  /** Additional data from server */
  data?: unknown;

  /** Handle input change */
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;

  /** Handle form submit */
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}
