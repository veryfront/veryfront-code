export const MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES = 240 * 1024;
const OMITTED_CONVERSATION_RUN_EVENT_TYPE = "CUSTOM";
const MAX_SUMMARY_DEPTH = 4;
const MAX_SUMMARY_ARRAY_ITEMS = 8;
const MAX_SUMMARY_OBJECT_KEYS = 24;
const MAX_SUMMARY_STRING_BYTES = 8 * 1024;

const encoder = new TextEncoder();

/** Record shape accepted by conversation run event normalization. */
export type ConversationRunEventRecord = Record<string, unknown> & { type: string };

function hasStringField<TField extends "delta" | "content">(
  event: ConversationRunEventRecord,
  field: TField,
): event is ConversationRunEventRecord & Record<TField, string> {
  return typeof event[field] === "string";
}

/** Return conversation run event JSON byte length. */
export function getConversationRunEventJsonByteLength(value: unknown): number {
  try {
    return encoder.encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Event emitted for normalize conversation run. */
export function normalizeConversationRunEvent(
  event: ConversationRunEventRecord,
): ConversationRunEventRecord[] {
  if (getConversationRunEventJsonByteLength(event) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES) {
    return [event];
  }

  // Every summarizer output passes through enforceEventSizeLimit so the byte-limit
  // invariant holds regardless of which branch (or future event type) ran.
  return summarizeOversizedEvent(event).map(enforceEventSizeLimit);
}

function summarizeOversizedEvent(
  event: ConversationRunEventRecord,
): ConversationRunEventRecord[] {
  switch (event.type) {
    case "TEXT_MESSAGE_CONTENT":
    case "REASONING_CONTENT":
    case "REASONING_MESSAGE_CONTENT":
    case "TOOL_CALL_ARGS":
      return hasStringField(event, "delta") ? splitStringFieldEvent(event, "delta") : [event];

    case "TOOL_CALL_RESULT":
      return [summarizeToolResultEvent(event)];

    default:
      return [summarizeGenericEvent(event)];
  }
}

/**
 * Final invariant guard. Forces any event a type-specific summarizer left oversized
 * (escape-heavy split parts, or a large non-string field) under the byte limit, so
 * no normalization path can emit an event the API will reject.
 */
function enforceEventSizeLimit(event: ConversationRunEventRecord): ConversationRunEventRecord {
  if (getConversationRunEventJsonByteLength(event) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES) {
    return event;
  }

  for (const field of ["delta", "content"] as const) {
    if (typeof event[field] === "string") {
      const clamped = truncateEventStringFieldToLimit(event, field, " [truncated]");
      if (clamped) {
        return clamped;
      }
    }
  }

  return buildOmittedEvent(event);
}

/** Normalizes conversation run events. */
export function normalizeConversationRunEvents(
  events: ConversationRunEventRecord[],
): ConversationRunEventRecord[] {
  return events.flatMap(normalizeConversationRunEvent);
}

function summarizeToolResultEvent(event: ConversationRunEventRecord): ConversationRunEventRecord {
  if (event.type !== "TOOL_CALL_RESULT") {
    return event;
  }

  // The original tool `input` is redundant with the TOOL_CALL_ARGS event and can
  // itself exceed the budget, so truncating only `content` would leave the event
  // oversized. Drop it before measuring.
  const { input: _input, ...eventWithoutInput } = event;

  if (typeof eventWithoutInput.content === "string") {
    const clamped = truncateEventStringFieldToLimit(
      eventWithoutInput,
      "content",
      " [tool result truncated in conversation-run event]",
    );
    if (clamped) {
      return clamped;
    }
    // The envelope alone exceeds the limit — fall through to the omitted-content placeholder.
  } else {
    const summarizedEvent = {
      ...eventWithoutInput,
      content: summarizeValue(eventWithoutInput.content),
    } satisfies ConversationRunEventRecord;

    if (
      getConversationRunEventJsonByteLength(summarizedEvent) <=
        MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
    ) {
      return summarizedEvent;
    }
  }

  return {
    ...eventWithoutInput,
    content: {
      truncated: true,
      originalType: describeValueType(event.content),
      note:
        "Tool result omitted from the conversation-run event because it exceeded the payload size limit.",
    },
  };
}

/**
 * Truncate a string field so the WHOLE event serializes within the byte limit.
 * Measures the JSON-serialized event (not the raw string), so it stays correct
 * for escape-heavy content that expands under JSON.stringify — the same unit the
 * API enforces. Returns null when the envelope alone already exceeds the limit.
 */
function truncateEventStringFieldToLimit(
  event: ConversationRunEventRecord,
  field: string,
  suffix: string,
): ConversationRunEventRecord | null {
  const value = event[field];
  if (typeof value !== "string") {
    return null;
  }

  const buildCandidate = (prefixLength: number): ConversationRunEventRecord =>
    prefixLength >= value.length
      ? event
      : { ...event, [field]: `${value.slice(0, prefixLength)}${suffix}` };

  if (
    getConversationRunEventJsonByteLength(buildCandidate(value.length)) <=
      MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
  ) {
    return event;
  }

  if (
    getConversationRunEventJsonByteLength(buildCandidate(0)) >
      MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
  ) {
    return null;
  }

  let low = 0;
  let high = value.length;
  let best = 0;
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (
      getConversationRunEventJsonByteLength(buildCandidate(mid)) <=
        MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
    ) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return buildCandidate(best);
}

function addStringFieldWithinLimit(
  event: ConversationRunEventRecord,
  field: string,
  value: string,
): ConversationRunEventRecord {
  const candidate = { ...event, [field]: value };
  if (
    getConversationRunEventJsonByteLength(candidate) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
  ) {
    return candidate;
  }

  return truncateEventStringFieldToLimit(candidate, field, " [truncated]") ?? event;
}

function buildOmittedEvent(event: ConversationRunEventRecord): ConversationRunEventRecord {
  let omitted: ConversationRunEventRecord = {
    type: OMITTED_CONVERSATION_RUN_EVENT_TYPE,
    name: "conversation-run-event-omitted",
    truncated: true,
    note: "Conversation-run event payload exceeded the size limit and was omitted.",
  };

  omitted = addStringFieldWithinLimit(omitted, "originalType", event.type);

  if (typeof event.messageId === "string") {
    omitted = addStringFieldWithinLimit(omitted, "originalMessageId", event.messageId);
  }

  if (typeof event.toolCallId === "string") {
    omitted = addStringFieldWithinLimit(omitted, "originalToolCallId", event.toolCallId);
  }

  if (getConversationRunEventJsonByteLength(omitted) <= MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES) {
    return omitted;
  }

  return {
    type: OMITTED_CONVERSATION_RUN_EVENT_TYPE,
    name: "conversation-run-event-omitted",
    truncated: true,
  };
}

function summarizeGenericEvent(event: ConversationRunEventRecord): ConversationRunEventRecord {
  const { type, ...rest } = event;
  return {
    type,
    truncated: true,
    note: "Conversation-run event payload was summarized to stay within storage limits.",
    summary: summarizeValue(rest),
  };
}

function splitStringFieldEvent<TField extends "delta" | "content">(
  event: ConversationRunEventRecord & Record<TField, string>,
  field: TField,
): ConversationRunEventRecord[] {
  const value = event[field];
  const buildPart = (slice: string): ConversationRunEventRecord => ({ ...event, [field]: slice });

  const parts: ConversationRunEventRecord[] = [];
  let startIndex = 0;

  while (startIndex < value.length) {
    // Largest prefix whose WHOLE serialized event fits the byte limit. Measuring the
    // event (not the raw slice) keeps the split correct for escape-heavy content that
    // expands under JSON.stringify — the same unit the API enforces — so every part
    // fits without the size-limit backstop having to truncate (drop) any data.
    let low = startIndex + 1;
    let high = value.length;
    let bestEndIndex = -1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (
        getConversationRunEventJsonByteLength(buildPart(value.slice(startIndex, mid))) <=
          MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
      ) {
        bestEndIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    if (bestEndIndex <= startIndex) {
      // Even a single character overflows the envelope; hand off to the size-limit
      // backstop rather than loop forever emitting zero-progress parts.
      return [event];
    }

    parts.push(buildPart(value.slice(startIndex, bestEndIndex)));
    startIndex = bestEndIndex;
  }

  return parts.length > 0 ? parts : [event];
}

function splitUtf8String(value: string, maxBytes: number): string[] {
  if (encoder.encode(value).byteLength <= maxBytes) {
    return [value];
  }

  const parts: string[] = [];
  let startIndex = 0;

  while (startIndex < value.length) {
    let low = startIndex + 1;
    let high = value.length;
    let bestEndIndex = startIndex + 1;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const slice = value.slice(startIndex, mid);
      if (encoder.encode(slice).byteLength <= maxBytes) {
        bestEndIndex = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    parts.push(value.slice(startIndex, bestEndIndex));
    startIndex = bestEndIndex;
  }

  return parts;
}

function truncateUtf8String(value: string, maxBytes: number, suffix: string): string {
  if (encoder.encode(value).byteLength <= maxBytes) {
    return value;
  }

  const suffixBytes = encoder.encode(suffix).byteLength;
  if (suffixBytes >= maxBytes) {
    return suffix.slice(0, Math.max(1, maxBytes));
  }

  const prefixBudget = maxBytes - suffixBytes;
  const [prefix] = splitUtf8String(value, prefixBudget);
  return `${prefix}${suffix}`;
}

function summarizeValue(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") {
    return truncateUtf8String(value, MAX_SUMMARY_STRING_BYTES, "… [truncated]");
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  if (seen.has(value)) {
    return "[circular]";
  }

  if (depth >= MAX_SUMMARY_DEPTH) {
    return "[truncated nested data]";
  }

  seen.add(value);

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_SUMMARY_ARRAY_ITEMS)
      .map((item) => summarizeValue(item, depth + 1, seen));
    if (value.length > MAX_SUMMARY_ARRAY_ITEMS) {
      items.push(`[truncated ${value.length - MAX_SUMMARY_ARRAY_ITEMS} more items]`);
    }
    return items;
  }

  const entries = Object.entries(value);
  const summarizedEntries = entries
    .slice(0, MAX_SUMMARY_OBJECT_KEYS)
    .map(([key, entryValue]) => [key, summarizeValue(entryValue, depth + 1, seen)] as const);
  const summarizedObject = Object.fromEntries(summarizedEntries);

  if (entries.length > MAX_SUMMARY_OBJECT_KEYS) {
    return {
      ...summarizedObject,
      _truncatedKeys: entries.length - MAX_SUMMARY_OBJECT_KEYS,
    };
  }

  return summarizedObject;
}

function describeValueType(value: unknown): string {
  if (Array.isArray(value)) {
    return "array";
  }

  if (value === null) {
    return "null";
  }

  return typeof value;
}
