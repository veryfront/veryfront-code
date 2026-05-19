const MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES = 240 * 1024;
const MAX_SUMMARY_DEPTH = 4;
const MAX_SUMMARY_ARRAY_ITEMS = 8;
const MAX_SUMMARY_OBJECT_KEYS = 24;
const MAX_SUMMARY_STRING_BYTES = 8 * 1024;

const encoder = new TextEncoder();

type ConversationRunEventRecord = Record<string, unknown> & { type: string };

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

  if (typeof event.content === "string") {
    const maxResultBytes = getStringFieldBudget(event, "content");
    return {
      ...event,
      content: truncateUtf8String(
        event.content,
        maxResultBytes,
        " [tool result truncated in conversation-run event]",
      ),
    };
  }

  const summarizedEvent = {
    ...event,
    content: summarizeValue(event.content),
  } satisfies ConversationRunEventRecord;

  if (
    getConversationRunEventJsonByteLength(summarizedEvent) <=
      MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES
  ) {
    return summarizedEvent;
  }

  return {
    ...event,
    content: {
      truncated: true,
      originalType: describeValueType(event.content),
      note:
        "Tool result omitted from the conversation-run event because it exceeded the payload size limit.",
    },
  };
}

function summarizeGenericEvent(event: ConversationRunEventRecord): ConversationRunEventRecord {
  return {
    ...event,
    truncated: true,
    note: "Conversation-run event payload was summarized to stay within storage limits.",
  };
}

function splitStringFieldEvent<TField extends "delta" | "content">(
  event: ConversationRunEventRecord & Record<TField, string>,
  field: TField,
): ConversationRunEventRecord[] {
  const maxBytes = getStringFieldBudget(event, field);
  const parts = splitUtf8String(event[field], maxBytes);
  return parts.map((part) => ({ ...event, [field]: part }));
}

function getStringFieldBudget(
  event: ConversationRunEventRecord,
  field: "delta" | "content",
): number {
  const eventWithEmptyField = {
    ...event,
    [field]: "",
  };

  return Math.max(
    1,
    MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES -
      getConversationRunEventJsonByteLength(eventWithEmptyField),
  );
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
