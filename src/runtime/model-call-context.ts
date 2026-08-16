/** Provider-agnostic message supplied to a model runtime. */
export type ModelCallMessage =
  | { role: "system"; content: string; providerOptions?: Record<string, unknown> }
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

/**
 * Provider-agnostic input persisted before one model dispatch. System-message
 * provider options contain only validated prompt-cache metadata. Other
 * provider-specific values are excluded because run events are durable.
 */
export type AgentRunModelCallContextEvent = {
  type: "AGENT_RUN_MODEL_CALL_CONTEXT";
  messages: ModelCallMessage[];
  tools?: ModelCallTool[];
};

/** Event produced by an agent run runtime boundary. */
export type AgentRunEvent = AgentRunModelCallContextEvent;

/** Receives events produced within one scoped agent run execution. */
export type AgentRunEventSink = (event: AgentRunEvent) => void | Promise<void>;
