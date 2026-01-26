import * as dntShim from "../../../../_dnt.shims.js";
export interface TextUIPart {
  type: "text";
  text: string;
  state?: "streaming" | "done";
}

export interface ReasoningUIPart {
  type: "reasoning";
  text: string;
  state?: "streaming" | "done";
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

export interface ToolOutput {
  tool: string;
  toolCallId: string;
  output?: unknown;
  state?: "output-available" | "output-error";
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
  onResponse?: (response: dntShim.Response) => void;
  onFinish?: (message: UIMessage) => void;
  onError?: (error: Error) => void;
  onToolCall?: (arg: OnToolCallArg) => void | Promise<void>;
}

export interface UseChatResult {
  messages: UIMessage[];
  input: string;
  isLoading: boolean;
  error: Error | null;
  setInput: (input: string) => void;
  sendMessage: (message: { text: string }) => Promise<void>;
  reload: () => Promise<void>;
  stop: () => void;
  setMessages: (messages: UIMessage[]) => void;
  addToolOutput: (output: ToolOutput) => void;
  data?: unknown;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent) => Promise<void>;
}
