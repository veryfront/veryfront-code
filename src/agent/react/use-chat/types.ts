import type {
  ChatDataPart,
  ChatDynamicToolPart,
  ChatFilePart,
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatStepPart,
  ChatTextPart,
  ChatToolPart,
  ChatToolResultPart,
  ChatToolState,
} from "../../../chat/protocol.ts";

/** Where inference is happening. */
export type InferenceMode = "cloud" | "server-local";

export type {
  ChatDataPart,
  ChatDynamicToolPart,
  ChatFilePart,
  ChatMessage,
  ChatMessagePart,
  ChatReasoningPart,
  ChatStepPart,
  ChatTextPart,
  ChatToolPart,
  ChatToolResultPart,
  ChatToolState,
};

type ToolOutputState = "output-available" | "output-error";

/** Output from tool. */
export interface ToolOutput {
  tool: string;
  toolCallId: string;
  output?: unknown;
  state?: ToolOutputState;
  errorText?: string;
}

/** Public API contract for on tool call arg. */
export interface OnToolCallArg {
  toolCall: {
    toolCallId: string;
    toolName: string;
    input: unknown;
    dynamic?: boolean;
  };
}

/** Options accepted by use chat. */
export interface UseChatOptions {
  /** AG-UI endpoint. Defaults to "/api/ag-ui". */
  api?: string;
  /** Streaming response protocol used by the endpoint. AG-UI is the default. */
  transport?: "ag-ui";
  initialMessages?: ChatMessage[];
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
  credentials?: RequestCredentials;
  /** Override model at runtime (e.g. "openai/gpt-4o", "Anthropic/claude-sonnet-4-5-20250929") */
  model?: string;
  onResponse?: (response: Response) => void;
  onFinish?: (message: ChatMessage) => void;
  onError?: (error: Error) => void;
  onToolCall?: (arg: OnToolCallArg) => void | Promise<void>;
}

/** Public API contract for branch info. */
export interface BranchInfo {
  current: number;
  total: number;
}

/** Result returned from use chat. */
/**
 * Streaming lifecycle of a chat turn.
 * - `submitted`: request sent, awaiting the first streamed token
 * - `streaming`: assistant tokens are arriving
 * - `ready`: idle — no turn in flight
 * - `error`: the last turn failed
 *
 * Parity with the Vercel AI SDK `status` field. Prefer this over `isLoading`
 * (which stays as a convenience alias for `submitted | streaming`).
 */
export type ChatStatus = "submitted" | "streaming" | "ready" | "error";

export interface UseChatResult {
  messages: ChatMessage[];
  input: string;
  /** @deprecated Use `status`. Equivalent to `status === "submitted" || status === "streaming"`. */
  isLoading: boolean;
  /** Streaming lifecycle of the current turn (AI-SDK parity). */
  status: ChatStatus;
  /** Id of the assistant message currently streaming, or `null` when idle. */
  streamingMessageId: string | null;
  error: Error | null;
  /** Current model override (undefined = use agent default) */
  model: string | undefined;
  /** The actual model being used after auto-upgrade (e.g. "Anthropic/claude-sonnet-4-20250514") */
  activeModel: string | undefined;
  /** Where inference is currently happening */
  inferenceMode: InferenceMode;
  setInput: (input: string) => void;
  /** Change the model for subsequent requests */
  setModel: (model: string | undefined) => void;
  sendMessage: (message: { text: string; files?: ChatFilePart[] }) => Promise<void>;
  /** Edit a user message and resubmit — truncates history to that point */
  editMessage: (messageId: string, newText: string) => Promise<void>;
  /** Get branch info for a message (returns { current, total }; total=1 if no branches) */
  getBranches: (messageId: string) => BranchInfo;
  /** Switch to a different branch at a given message */
  switchBranch: (messageId: string, branchIndex: number) => void;
  reload: () => Promise<void>;
  stop: () => void;
  setMessages: (messages: ChatMessage[]) => void;
  addToolOutput: (output: ToolOutput) => void;
  data?: unknown;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSubmit: (e?: React.FormEvent) => Promise<void>;
}
