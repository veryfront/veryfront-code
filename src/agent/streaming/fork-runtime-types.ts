/** Text or reasoning delta emitted by a forked runtime. */
export interface ForkStreamPart {
  /** Stream delta kind. */
  type: "reasoning-delta" | "text-delta";
  /** Delta text. */
  text: string;
}

/** Start of streamed tool input from a forked runtime. */
export interface ForkToolInputStartPart {
  /** Part discriminator. */
  type: "tool-input-start";
  /** Tool call identifier. */
  toolCallId: string;
  /** Tool name. */
  toolName: string;
}

/** Incremental tool input emitted by a forked runtime. */
export interface ForkToolInputDeltaPart {
  /** Part discriminator. */
  type: "tool-input-delta";
  /** Tool call identifier. */
  toolCallId: string;
  /** Serialized input delta. */
  delta: string;
}

/** Complete tool call emitted by a forked runtime. */
export interface ForkToolCallPart {
  /** Part discriminator. */
  type: "tool-call";
  /** Tool name. */
  toolName: string;
  /** Tool call identifier. */
  toolCallId: string;
  /** Parsed tool input. */
  input: unknown;
}

/** Successful tool result emitted by a forked runtime. */
export interface ForkToolResultPart {
  /** Part discriminator. */
  type: "tool-result";
  /** Tool name. */
  toolName: string;
  /** Tool call identifier. */
  toolCallId: string;
  /** Parsed tool input. */
  input: unknown;
  /** Tool output. */
  output: unknown;
}

/** Failed tool result emitted by a forked runtime. */
export interface ForkToolErrorPart {
  /** Part discriminator. */
  type: "tool-error";
  /** Tool name. */
  toolName: string;
  /** Tool call identifier. */
  toolCallId: string;
  /** Parsed tool input. */
  input: unknown;
  /** Tool execution error. */
  error: Error;
}

/** Runtime error emitted by a forked execution. */
export interface ForkErrorPart {
  /** Part discriminator. */
  type: "error";
  /** Runtime error. */
  error: Error;
}

/** Public API contract for fork runtime step. */
export interface ForkRuntimeStep {
  /** Text value. */
  text: string;
  /** Messages associated with the operation. */
  messages: unknown[];
  /** Tool calls value. */
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  /** Tool results value. */
  toolResults: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    output: unknown;
  }>;
  /** Finish reason value. */
  finishReason: string | null;
}

/** Public API contract for fork part. */
export type ForkPart =
  | ForkStreamPart
  | ForkToolInputStartPart
  | ForkToolInputDeltaPart
  | ForkToolCallPart
  | ForkToolResultPart
  | ForkToolErrorPart
  | ForkErrorPart;

/** Public API contract for fork runtime stream logger. */
export type ForkRuntimeStreamLogger = {
  warn: (message: string, metadata?: Record<string, unknown>) => void;
};
