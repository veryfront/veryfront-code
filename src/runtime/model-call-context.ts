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

/** Resolved model identity for one dispatched model call. */
export interface ModelCallModel {
  id: string;
  modelProvider?: string;
}

/** Provider-neutral generation controls that materially affect one model call. */
export interface ModelCallRequest {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  seed?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  reasoning?: {
    enabled?: boolean;
    effort?: "low" | "medium" | "high" | "max";
    budgetTokens?: number;
  };
}

/**
 * Provider-agnostic input persisted before one model dispatch. System-message
 * provider options contain only validated prompt-cache metadata. Other
 * provider-specific values are excluded because run events are durable.
 */
export type AgentRunModelCallContextEvent = {
  type: "AGENT_RUN_MODEL_CALL_CONTEXT";
  model?: ModelCallModel;
  request?: ModelCallRequest;
  messages: ModelCallMessage[];
  tools?: ModelCallTool[];
  elapsedMs?: number;
  emittedAt?: number;
};

/** Event produced by an agent run runtime boundary. */
export type AgentRunEvent = AgentRunModelCallContextEvent;

/** Receives events produced within one scoped agent run execution. */
export type AgentRunEventSink = (event: AgentRunEvent) => void | Promise<void>;

/** Shared run clock used by public and private event producers. */
export interface AgentRunEventTimingOptions {
  nowMs?: () => number;
  epochMs?: () => number;
  startedMs?: number;
}

/** Create one timing anchor for every event family belonging to a run. */
export function createAgentRunEventTimingAnchor(
  options: Omit<AgentRunEventTimingOptions, "startedMs"> = {},
): AgentRunEventTimingOptions {
  const nowMs = options.nowMs ?? (() => performance.now());
  return {
    nowMs,
    epochMs: options.epochMs ?? (() => Date.now()),
    startedMs: nowMs(),
  };
}

/** Stamp producer timing at the persistence boundary. */
export function createTimedAgentRunEventSink(
  sink: AgentRunEventSink,
  options: AgentRunEventTimingOptions = {},
): AgentRunEventSink {
  const nowMs = options.nowMs ?? (() => performance.now());
  const epochMs = options.epochMs ?? (() => Date.now());
  const startedMs = options.startedMs ?? nowMs();
  return (event) => {
    const hasElapsedMs = Object.hasOwn(event, "elapsedMs");
    const hasEmittedAt = Object.hasOwn(event, "emittedAt");
    if (hasElapsedMs) assertValidElapsedMs(event.elapsedMs);
    if (hasEmittedAt) assertValidEmittedAt(event.emittedAt);

    const elapsedMs = hasElapsedMs ? event.elapsedMs : Math.max(0, Math.round(nowMs() - startedMs));
    const emittedAt = hasEmittedAt ? event.emittedAt : Math.round(epochMs());
    assertValidElapsedMs(elapsedMs);
    assertValidEmittedAt(emittedAt);

    return sink({
      ...event,
      elapsedMs,
      emittedAt,
    });
  };
}

function assertValidElapsedMs(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new TypeError("elapsedMs must be a finite non-negative number");
  }
}

function assertValidEmittedAt(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new TypeError("emittedAt must be a non-negative integer");
  }
}
