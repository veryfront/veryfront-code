interface ForkStreamPart {
  type: "reasoning-delta" | "text-delta";
  text: string;
}

interface ForkToolInputStartPart {
  type: "tool-input-start";
  toolCallId: string;
  toolName: string;
}

interface ForkToolInputDeltaPart {
  type: "tool-input-delta";
  toolCallId: string;
  delta: string;
}

interface ForkToolCallPart {
  type: "tool-call";
  toolName: string;
  toolCallId: string;
  input: unknown;
}

interface ForkToolResultPart {
  type: "tool-result";
  toolName: string;
  toolCallId: string;
  input: unknown;
  output: unknown;
}

interface ForkToolErrorPart {
  type: "tool-error";
  toolName: string;
  toolCallId: string;
  input: unknown;
  error: Error;
}

interface ForkErrorPart {
  type: "error";
  error: Error;
}

/** Public API contract for fork runtime step. */
export interface ForkRuntimeStep {
  text: string;
  messages: unknown[];
  toolCalls: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
  }>;
  toolResults: Array<{
    toolCallId: string;
    toolName: string;
    input: unknown;
    output: unknown;
  }>;
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
