export type StreamState = "streaming" | "done";

export interface TextUIPart {
  type: "text";
  text: string;
  state?: StreamState;
}

export interface ReasoningUIPart {
  type: "reasoning";
  text: string;
  state?: StreamState;
}

export type ToolState =
  | "input-streaming"
  | "input-available"
  | "output-streaming"
  | "output-available"
  | "output-error";

export interface ToolUIPart<NAME extends string = string, INPUT = unknown, OUTPUT = unknown> {
  type: `tool-${NAME}`;
  toolCallId: string;
  toolName: NAME;
  state: ToolState;
  input?: INPUT;
  output?: OUTPUT;
  errorText?: string;
}

export interface ToolResultUIPart<RESULT = unknown> {
  type: "tool-result";
  toolCallId: string;
  toolName: string;
  result: RESULT;
  isError?: boolean;
}

export interface DynamicToolUIPart {
  type: "dynamic-tool";
  toolCallId: string;
  toolName: string;
  state: ToolState;
  input?: unknown;
  output?: unknown;
  errorText?: string;
}

export type UIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | ToolUIPart
  | ToolResultUIPart
  | DynamicToolUIPart;

export interface UIMessage {
  id: string;
  role: "system" | "user" | "assistant";
  parts: UIMessagePart[];
  metadata?: Record<string, unknown>;
  createdAt?: Date | string;
}

export type ToolOutputState = "output-available" | "output-error";

export interface ToolOutput {
  tool: string;
  toolCallId: string;
  output?: unknown;
  state?: ToolOutputState;
  errorText?: string;
}

export interface OnToolCallArg {
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    dynamic?: boolean;
  };
}

export interface UseChatOptions {
  api: string;
  initialMessages?: UIMessage[];
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  /** Override model at runtime (e.g. "openai/gpt-4o", "anthropic/claude-sonnet-4-5-20250929") */
  model?: string;
  onResponse?: (response: Response) => void;
  onFinish?: (message: UIMessage) => void;
  onError?: (error: Error) => void;
  onToolCall?: (arg: OnToolCallArg) => void | Promise<void>;
}

export interface UseChatResult {
  messages: UIMessage[];
  input: string;
  isLoading: boolean;
  error: Error | null;
  /** Current model override (undefined = use agent default) */
  model: string | undefined;
  setInput: (input: string) => void;
  /** Change the model for subsequent requests */
  setModel: (model: string | undefined) => void;
  sendMessage: (message: { text: string }) => Promise<void>;
  reload: () => Promise<void>;
  stop: () => void;
  setMessages: (messages: UIMessage[]) => void;
  addToolOutput: (output: ToolOutput) => void;
  data?: unknown;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}
