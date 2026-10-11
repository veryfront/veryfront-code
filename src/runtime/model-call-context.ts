import type { AgentRunModelCallCaptureReceipt } from "./model-call-capture-receipt.ts";

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

export type ModelCallResponseFormat =
  | { type: "text" }
  | { type: "json" }
  | {
    type: "json_schema";
    name: string;
    schema: unknown;
    description?: string;
    strict?: boolean;
  };

/** Provider-neutral generation controls that materially affect one model call. */
export interface ModelCallRequest {
  maxOutputTokens?: number;
  temperature?: number;
  parallelToolCalls?: boolean;
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
  responseFormat?: ModelCallResponseFormat;
}

/**
 * Provider-agnostic input persisted before one model dispatch. System-message
 * provider options contain only validated prompt-cache metadata. Other
 * provider-specific values are excluded because run events are durable.
 */
export type AgentRunModelCallContextEvent = {
  type: "AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED";
  /** Broker-owned logical identity; this field alone grants no receipt or read authority. */
  modelCallId?: string;
  model?: ModelCallModel;
  request?: ModelCallRequest;
  messages: ModelCallMessage[];
  tools?: ModelCallTool[];
  elapsedMs?: number;
  emittedAt?: number;
};

/** Nonterminal runtime observation produced by an agent run runtime boundary. */
export type AgentRunRuntimeEventRecordedEvent = {
  type: "RUNTIME_EVENT_RECORDED";
  runtime: string;
  kind: string;
  value: unknown;
  elapsedMs?: number;
  emittedAt?: number;
};

/** Event produced by an agent run runtime boundary. */
export type AgentRunEvent = AgentRunModelCallContextEvent | AgentRunRuntimeEventRecordedEvent;

/** Receives events produced within one scoped agent run execution. */
export type AgentRunEventSink = (
  event: AgentRunEvent,
) => void | AgentRunModelCallCaptureReceipt | Promise<void | AgentRunModelCallCaptureReceipt>;

/** Shared run clock used by public and private event producers. */
export interface AgentRunEventTimingOptions {
  nowMs?: () => number;
  epochMs?: () => number;
  startedMs?: number;
}

const numberIsFinite = Number.isFinite;
const numberIsInteger = Number.isInteger;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;
const reflectApply = Reflect.apply;
const dateNow = Date.now;
const nativePerformance = performance;
const performanceNow = nativePerformance.now;
const mathMax = Math.max;
const mathRound = Math.round;

/** Create one timing anchor for every event family belonging to a run. */
export function createAgentRunEventTimingAnchor(
  options: Omit<AgentRunEventTimingOptions, "startedMs"> = {},
): AgentRunEventTimingOptions {
  const nowMs = options.nowMs ??
    (() => reflectApply(performanceNow, nativePerformance, []) as number);
  return {
    nowMs,
    epochMs: options.epochMs ?? (() => reflectApply(dateNow, Date, []) as number),
    startedMs: nowMs(),
  };
}

/** Stamp producer timing at the persistence boundary. */
export function createTimedAgentRunEventSink(
  sink: AgentRunEventSink,
  options: AgentRunEventTimingOptions = {},
): AgentRunEventSink {
  const nowMs = options.nowMs ??
    (() => reflectApply(performanceNow, nativePerformance, []) as number);
  const epochMs = options.epochMs ?? (() => reflectApply(dateNow, Date, []) as number);
  const startedMs = options.startedMs ?? nowMs();
  return (event) => {
    const elapsed = readOptionalTiming(event, "elapsedMs");
    const emitted = readOptionalTiming(event, "emittedAt");
    if (elapsed.present) assertValidElapsedMs(elapsed.value);
    if (emitted.present) assertValidEmittedAt(emitted.value);

    const elapsedMs = elapsed.present ? elapsed.value : reflectApply(mathMax, Math, [
      0,
      reflectApply(mathRound, Math, [nowMs() - startedMs]),
    ]) as number;
    const emittedAt = emitted.present
      ? emitted.value
      : reflectApply(mathRound, Math, [epochMs()]) as number;
    assertValidElapsedMs(elapsedMs);
    assertValidEmittedAt(emittedAt);

    return sink({
      ...event,
      elapsedMs,
      emittedAt,
    });
  };
}

function readOptionalTiming(
  event: AgentRunEvent,
  key: "elapsedMs" | "emittedAt",
): { present: false } | { present: true; value: unknown } {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = reflectApply(objectGetOwnPropertyDescriptor, undefined, [
      event,
      key,
    ]) as PropertyDescriptor | undefined;
  } catch {
    throw new TypeError(`${key} must be an own enumerable data property`);
  }
  if (descriptor === undefined) return { present: false };
  if (descriptor.enumerable !== true || !objectHasOwn(descriptor, "value")) {
    throw new TypeError(`${key} must be an own enumerable data property`);
  }
  return { present: true, value: descriptor.value };
}

function assertValidElapsedMs(value: unknown): asserts value is number {
  if (typeof value !== "number" || !numberIsFinite(value) || value < 0) {
    throw new TypeError("elapsedMs must be a finite non-negative number");
  }
}

function assertValidEmittedAt(value: unknown): asserts value is number {
  if (typeof value !== "number" || !numberIsInteger(value) || value < 0) {
    throw new TypeError("emittedAt must be a non-negative integer");
  }
}
