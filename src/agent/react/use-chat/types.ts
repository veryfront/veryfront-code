export type StreamState = "streaming" | "done";

/** Where inference is happening */
export type InferenceMode = "cloud" | "server-local" | "browser";

/** Browser-side model loading and inference status */
export type BrowserInferenceStatus =
  | "idle"
  | "loading-runtime"
  | "downloading-model"
  | "ready"
  | "generating"
  | "error";

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

export interface StepUIPart {
  type: "step-start" | "step-end";
  stepIndex: number;
}

export type UIMessagePart =
  | TextUIPart
  | ReasoningUIPart
  | ToolUIPart
  | ToolResultUIPart
  | DynamicToolUIPart
  | StepUIPart;

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
  /** System prompt for browser-side inference (server uses agent config) */
  systemPrompt?: string;
  /** Enable/disable browser fallback when server can't provide AI. Default: true */
  browserFallback?: boolean;
  onResponse?: (response: Response) => void;
  onFinish?: (message: UIMessage) => void;
  onError?: (error: Error) => void;
  onToolCall?: (arg: OnToolCallArg) => void | Promise<void>;
}

export interface BranchInfo {
  current: number;
  total: number;
}

export interface UseChatResult {
  messages: UIMessage[];
  input: string;
  isLoading: boolean;
  error: Error | null;
  /** Current model override (undefined = use agent default) */
  model: string | undefined;
  /** Where inference is currently happening */
  inferenceMode: InferenceMode;
  /** Browser-side model loading/inference status (null when not using browser fallback) */
  browserStatus: BrowserInferenceStatus | null;
  setInput: (input: string) => void;
  /** Change the model for subsequent requests */
  setModel: (model: string | undefined) => void;
  sendMessage: (message: { text: string }) => Promise<void>;
  /** Edit a user message and resubmit — truncates history to that point */
  editMessage: (messageId: string, newText: string) => Promise<void>;
  /** Get branch info for a message (returns { current, total }; total=1 if no branches) */
  getBranches: (messageId: string) => BranchInfo;
  /** Switch to a different branch at a given message */
  switchBranch: (messageId: string, branchIndex: number) => void;
  reload: () => Promise<void>;
  stop: () => void;
  setMessages: (messages: UIMessage[]) => void;
  addToolOutput: (output: ToolOutput) => void;
  data?: unknown;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
  /** Alias for `handleInputChange` — matches `ChatProps.onChange` for easy spreading */
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  /** Alias for `handleSubmit` — matches `ChatProps.onSubmit` for easy spreading */
  onSubmit: (e: React.FormEvent) => Promise<void>;
  /** Alias for `setModel` — matches `ChatProps.onModelChange` for easy spreading */
  onModelChange: (model: string | undefined) => void;
}
