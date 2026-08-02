/** Provider-agnostic message supplied to a model runtime. */
export type ModelCallMessage =
  | { role: "system"; content: string }
  | {
    role: "user";
    content: Array<
      | { type: "text"; text: string }
      | { type: "image" | "file"; mediaType: string; url: string; filename?: string }
    >;
  }
  | {
    role: "assistant";
    content: Array<
      | { type: "text"; text: string }
      | {
        type: "tool-call";
        toolCallId: string;
        toolName: string;
        input: unknown;
        providerExecuted?: boolean;
      }
    >;
  }
  | {
    role: "tool";
    content: Array<{
      type: "tool-result";
      toolCallId: string;
      toolName: string;
      output: { type: "json"; value: unknown };
    }>;
  };

/** Resolved provider-agnostic tool definition supplied to a model runtime. */
export type ModelCallTool =
  | {
    type: "function";
    name: string;
    description?: string;
    inputSchema: unknown;
  }
  | {
    type: "provider";
    name: string;
    id: `${string}.${string}`;
    args: Record<string, unknown>;
  };

/** Exact provider-agnostic input supplied at one model dispatch boundary. */
export interface ModelCallContext {
  prompt: ModelCallMessage[];
  tools?: ModelCallTool[];
}

/** Records the exact provider-agnostic input before model dispatch. */
export type ModelCallRecorder = (context: ModelCallContext) => void | Promise<void>;
