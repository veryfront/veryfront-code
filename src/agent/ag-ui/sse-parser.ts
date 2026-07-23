import { isRecord } from "#veryfront/chat/conversation.ts";
import { safeJsonParse } from "#veryfront/chat/provider-errors.ts";

/** AG-UI runtime event type constants normalized from browser-wire SSE events. */
export const agUiSseEventTypes = {
  custom: "CUSTOM",
  textMessageStart: "TEXT_MESSAGE_START",
  textMessageContent: "TEXT_MESSAGE_CONTENT",
  textMessageEnd: "TEXT_MESSAGE_END",
  reasoningMessageStart: "REASONING_MESSAGE_START",
  reasoningMessageContent: "REASONING_MESSAGE_CONTENT",
  reasoningMessageEnd: "REASONING_MESSAGE_END",
  toolCallStart: "TOOL_CALL_START",
  toolCallArgs: "TOOL_CALL_ARGS",
  toolCallEnd: "TOOL_CALL_END",
  toolCallResult: "TOOL_CALL_RESULT",
  runStarted: "RUN_STARTED",
  stateSnapshot: "STATE_SNAPSHOT",
  messagesSnapshot: "MESSAGES_SNAPSHOT",
  stepStarted: "STEP_STARTED",
  stepFinished: "STEP_FINISHED",
  runError: "RUN_ERROR",
  runFinished: "RUN_FINISHED",
} as const;

/** Normalized AG-UI runtime event type value. */
export type AgUiSseEventType = (typeof agUiSseEventTypes)[keyof typeof agUiSseEventTypes];

/** Parsed AG-UI SSE response summary for evals, canaries, and host tests. */
export interface ParsedAgUiSseRun {
  /** Response status value. */
  responseStatus: number;
  /** Events value. */
  events: Array<Record<string, unknown>>;
  /** Event types value. */
  eventTypes: string[];
  /** Tool starts value. */
  toolStarts: string[];
  /** Tool args value. */
  toolArgs: string[];
  /** Text value. */
  text: string;
  /** Run error value. */
  runError: string | null;
}

/** Progress snapshot emitted while parsing an AG-UI SSE response. */
export interface AgUiSseProgressSnapshot {
  /** Event count value. */
  eventCount: number;
  /** Last event type value. */
  lastEventType: string | null;
  /** Last tool call name value. */
  lastToolCallName: string | null;
  /** Tool starts value. */
  toolStarts: string[];
  /** Text length value. */
  textLength: number;
}

/** Options for `parseAgUiSseResponse()`. */
export interface ParseAgUiSseResponseOptions {
  /** Callback invoked when progress. */
  onProgress?: (snapshot: AgUiSseProgressSnapshot) => void;
  /** Progress throttle ms value. */
  progressThrottleMs?: number;
}

/** Stringify an AG-UI SSE event or fallback value for diagnostics. */
export function stringifyAgUiSseEvent(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/** Return a string field from a parsed AG-UI SSE event record. */
export function getAgUiSseStringField(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

/** Filter parsed AG-UI SSE events by normalized event type. */
export function getAgUiSseEventsOfType(
  events: Array<Record<string, unknown>>,
  eventType: string,
): Array<Record<string, unknown>> {
  return events.filter((event) => getAgUiSseStringField(event, "type") === eventType);
}

/** Build a compact ordered event-type signature for regression checks. */
export function buildAgUiSseTraceSignature(eventTypes: string[]): string {
  return eventTypes.join(" > ");
}

function serializeToolResult(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value ?? null);
  } catch {
    return String(value);
  }
}

function createEmptyParsedRun(responseStatus: number): ParsedAgUiSseRun {
  return {
    responseStatus,
    events: [],
    eventTypes: [],
    toolStarts: [],
    toolArgs: [],
    text: "",
    runError: null,
  };
}

function createProgressSnapshot(run: ParsedAgUiSseRun): AgUiSseProgressSnapshot {
  const lastEvent = run.events.at(-1);
  const lastToolStart = [...run.events]
    .reverse()
    .find((event) => getAgUiSseStringField(event, "type") === agUiSseEventTypes.toolCallStart);

  return {
    eventCount: run.events.length,
    lastEventType: lastEvent ? getAgUiSseStringField(lastEvent, "type") : null,
    lastToolCallName: lastToolStart ? getAgUiSseStringField(lastToolStart, "toolCallName") : null,
    toolStarts: [...run.toolStarts],
    textLength: run.text.length,
  };
}

function applyParsedEvent(run: ParsedAgUiSseRun, event: Record<string, unknown>) {
  run.events.push(event);

  const type = getAgUiSseStringField(event, "type");
  if (type) {
    run.eventTypes.push(type);
  }

  if (type === agUiSseEventTypes.toolCallStart) {
    const toolCallName = getAgUiSseStringField(event, "toolCallName");
    if (toolCallName) {
      run.toolStarts.push(toolCallName);
    }
  }

  if (type === agUiSseEventTypes.toolCallArgs) {
    const delta = getAgUiSseStringField(event, "delta");
    if (delta) {
      run.toolArgs.push(delta);
    }
  }

  if (type === agUiSseEventTypes.textMessageContent) {
    const delta = getAgUiSseStringField(event, "delta");
    if (delta) {
      run.text += delta;
    }
  }
}

function coerceBrowserWireEvent(
  eventName: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (eventName) {
    case "RunStarted":
      return { type: agUiSseEventTypes.runStarted, ...payload };
    case "StateSnapshot":
      return { type: agUiSseEventTypes.stateSnapshot, ...payload };
    case "MessagesSnapshot":
      return { type: agUiSseEventTypes.messagesSnapshot, ...payload };
    case "TextMessageStart":
      return { type: agUiSseEventTypes.textMessageStart, ...payload };
    case "TextMessageContent":
      return { type: agUiSseEventTypes.textMessageContent, ...payload };
    case "TextMessageEnd":
      return { type: agUiSseEventTypes.textMessageEnd, ...payload };
    case "ReasoningMessageStart":
      return { type: agUiSseEventTypes.reasoningMessageStart, ...payload };
    case "ReasoningMessageContent":
      return { type: agUiSseEventTypes.reasoningMessageContent, ...payload };
    case "ReasoningMessageEnd":
      return { type: agUiSseEventTypes.reasoningMessageEnd, ...payload };
    case "StepStarted":
      return { type: agUiSseEventTypes.stepStarted, ...payload };
    case "StepFinished":
      return { type: agUiSseEventTypes.stepFinished, ...payload };
    case "ToolCallStart":
      return { type: agUiSseEventTypes.toolCallStart, ...payload };
    case "ToolCallArgs":
      return { type: agUiSseEventTypes.toolCallArgs, ...payload };
    case "ToolCallEnd":
      return { type: agUiSseEventTypes.toolCallEnd, ...payload };
    case "ToolCallResult":
      return {
        type: agUiSseEventTypes.toolCallResult,
        ...payload,
        ...(payload.result !== undefined ? { content: serializeToolResult(payload.result) } : {}),
      };
    case "Custom":
      return { type: agUiSseEventTypes.custom, ...payload };
    case "RunError":
      return { type: agUiSseEventTypes.runError, ...payload };
    case "RunFinished":
      return { type: agUiSseEventTypes.runFinished, ...payload };
    default:
      return { type: eventName, ...payload };
  }
}

function normalizeParsedEvent(
  payload: Record<string, unknown>,
  eventName: string | null,
): Record<string, unknown> | null {
  if (typeof payload.type === "string") {
    return payload;
  }

  if (!eventName) {
    return null;
  }

  return coerceBrowserWireEvent(eventName, payload);
}

function consumeSseBuffer(
  run: ParsedAgUiSseRun,
  buffer: string,
  options: ParseAgUiSseResponseOptions,
  state: { lastProgressAt: number; progressThrottleMs: number },
): string {
  let nextBuffer = buffer;
  let separatorIndex = nextBuffer.indexOf("\n\n");

  while (separatorIndex !== -1) {
    const entry = nextBuffer.slice(0, separatorIndex).trim();
    nextBuffer = nextBuffer.slice(separatorIndex + 2);
    const eventName = entry
      .split("\n")
      .flatMap((line) =>
        line.startsWith("event:") ? [line.slice("event:".length).trimStart()] : []
      )[0] ?? null;

    const data = entry
      .split("\n")
      .flatMap((line) => line.startsWith("data:") ? [line.slice("data:".length).trimStart()] : [])
      .join("\n");

    if (data.length > 0 && data !== "[DONE]") {
      const parsed = safeJsonParse(data);
      if (parsed.ok && isRecord(parsed.value)) {
        const normalizedEvent = normalizeParsedEvent(parsed.value, eventName);
        if (normalizedEvent) {
          applyParsedEvent(run, normalizedEvent);
          const now = Date.now();
          if (options.onProgress && now - state.lastProgressAt >= state.progressThrottleMs) {
            options.onProgress(createProgressSnapshot(run));
            state.lastProgressAt = now;
          }
        }
      }
    }

    separatorIndex = nextBuffer.indexOf("\n\n");
  }

  return nextBuffer;
}

/** Parse an AG-UI SSE `Response` into normalized events, text, tool starts, and terminal error state. */
export async function parseAgUiSseResponse(
  response: Response,
  options: ParseAgUiSseResponseOptions = {},
): Promise<ParsedAgUiSseRun> {
  const run = createEmptyParsedRun(response.status);
  const decoder = new TextDecoder();
  const rawChunks: string[] = [];
  const state = { lastProgressAt: 0, progressThrottleMs: options.progressThrottleMs ?? 15_000 };

  if (!response.body) {
    const body = await response.text();
    rawChunks.push(body);
  } else {
    const reader = response.body.getReader();
    let buffer = "";

    // try/finally so an error/abort mid-read still releases the reader lock;
    // otherwise the underlying ReadableStream stays locked and the response
    // body leaks.
    try {
      while (true) {
        const result = await reader.read();
        if (result.done) {
          const tail = decoder.decode();
          if (tail.length > 0) {
            rawChunks.push(tail);
            buffer += tail;
          }
          break;
        }

        const decoded = decoder.decode(result.value, { stream: true });
        rawChunks.push(decoded);
        buffer += decoded;
        buffer = consumeSseBuffer(run, buffer, options, state);
      }
    } finally {
      reader.releaseLock();
    }
  }

  if (options.onProgress) {
    options.onProgress(createProgressSnapshot(run));
  }

  run.text = run.text.trim();

  const runErrorEvent = getAgUiSseEventsOfType(run.events, agUiSseEventTypes.runError)[0];
  run.runError = runErrorEvent && typeof runErrorEvent.message === "string"
    ? runErrorEvent.message
    : response.ok
    ? null
    : rawChunks.join("").trim() || `${response.status}`;

  return run;
}
