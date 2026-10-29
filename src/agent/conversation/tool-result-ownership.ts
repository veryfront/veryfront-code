/** Trusted finalization metadata. External data chunks cannot use this name. */
export const TOOL_RESULT_OWNERSHIP_CORRECTION = "veryfront.tool_result_ownership";
/**
 * Top-level marker that finalization sets beside `name` and `value`. A data chunk can
 * only supply a name and a value, also in runs stored before the name was reserved, so an
 * event that has the name without this marker is ordinary custom data, not a correction.
 */
export const TOOL_RESULT_OWNERSHIP_ORIGIN = "veryfront.finalization";

type StoredEvent = Readonly<Record<string, unknown>>;
interface Correction {
  schemaVersion: 1;
  toolCallId: string;
  toolName: string;
  parentMessageId: string;
  providerExecuted: true;
}
function readCorrection(value: unknown): Correction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    Object.keys(record).sort((left, right) => left.localeCompare(right)).join(",") !==
      "parentMessageId,providerExecuted,schemaVersion,toolCallId,toolName"
  ) return null;
  if (record.schemaVersion !== 1 || record.providerExecuted !== true) return null;
  const { toolCallId, toolName, parentMessageId } = record;
  if (
    typeof toolCallId !== "string" || !toolCallId || typeof toolName !== "string" || !toolName ||
    typeof parentMessageId !== "string" || !parentMessageId
  ) return null;
  return { schemaVersion: 1, toolCallId, toolName, parentMessageId, providerExecuted: true };
}

function validVersion2PrefixEnd(events: readonly StoredEvent[], eventCount: number): number {
  // Authority requires a valid prefix through the correction. Later unrelated
  // failures retain the reader's existing partial-frame diagnostics.
  let sequence = 0;
  const keys = new Set<string>();
  for (const [index, event] of events.entries()) {
    const next = event.logical_sequence;
    const key = event.idempotency_key;
    if (
      event.stream_protocol_version !== 2 || typeof next !== "number" ||
      !Number.isInteger(next) || next <= sequence ||
      typeof key !== "string" || !key || keys.has(key)
    ) {
      return index;
    }
    sequence = next;
    keys.add(key);
  }
  return eventCount;
}

function collectOwnershipCorrection(
  event: StoredEvent,
  index: number,
  invalid: Set<number>,
  correctionCounts: Map<string, number>,
  corrections: Map<string, { index: number; value: Correction }[]>,
): void {
  if (
    event.type === "CUSTOM" && event.name === TOOL_RESULT_OWNERSHIP_CORRECTION &&
    event.origin === TOOL_RESULT_OWNERSHIP_ORIGIN
  ) {
    invalid.add(index);
    if (event.value && typeof event.value === "object" && !Array.isArray(event.value)) {
      const id = (event.value as Record<string, unknown>).toolCallId;
      if (typeof id === "string") correctionCounts.set(id, (correctionCounts.get(id) ?? 0) + 1);
    }
    const value = readCorrection(event.value);
    if (value) {
      const entries = corrections.get(value.toolCallId) ?? [];
      entries.push({ index, value });
      corrections.set(value.toolCallId, entries);
    }
  }
}

function matchesOriginalToolResult(
  events: readonly StoredEvent[],
  start: number,
  end: number,
  result: number,
  index: number,
  value: Correction,
): boolean {
  if (!(start < end && end < result && result < index)) return false;
  const started = events[start]!;
  const ended = events[end]!;
  const output = events[result]!;
  if ([started, ended, output].some((event) => event.providerExecuted !== undefined)) return false;
  if (
    (started.toolName ?? started.toolCallName) !== value.toolName ||
    started.parentMessageId !== value.parentMessageId ||
    output.parentMessageId !== value.parentMessageId
  ) return false;
  if (output.toolName !== undefined && output.toolName !== value.toolName) return false;
  if (ended.parentMessageId !== undefined && ended.parentMessageId !== value.parentMessageId) {
    return false;
  }
  return true;
}

type ToolOccurrences = Map<string, { starts: number[]; ends: number[]; results: number[] }>;

function collectToolOccurrence(
  event: StoredEvent,
  index: number,
  occurrences: ToolOccurrences,
): void {
  if (typeof event.toolCallId !== "string") return;
  const occurrence = occurrences.get(event.toolCallId) ?? { starts: [], ends: [], results: [] };
  if (event.type === "TOOL_CALL_START") occurrence.starts.push(index);
  if (event.type === "TOOL_CALL_END") occurrence.ends.push(index);
  if (event.type === "TOOL_CALL_RESULT") occurrence.results.push(index);
  occurrences.set(event.toolCallId, occurrence);
}

/** Bind metadata to one original result without replaying input or output. */
export function resolveToolResultOwnershipCorrections(
  events: readonly StoredEvent[],
  requireVersion2Envelope = false,
) {
  const eventCount = events.length;
  const validPrefixEnd = requireVersion2Envelope
    ? validVersion2PrefixEnd(events, eventCount)
    : eventCount;
  const ends = new Set<number>();
  const results = new Set<number>();
  const consumed = new Set<number>();
  const invalid = new Set<number>();
  const occurrences: ToolOccurrences = new Map();
  const correctionCounts = new Map<string, number>();
  const corrections = new Map<string, { index: number; value: Correction }[]>();
  for (const [index, event] of events.entries()) {
    collectOwnershipCorrection(event, index, invalid, correctionCounts, corrections);
    collectToolOccurrence(event, index, occurrences);
  }
  for (const [id, entries] of corrections) {
    const occurrence = occurrences.get(id);
    if (
      entries.length !== 1 || correctionCounts.get(id) !== 1 || occurrence?.starts.length !== 1 ||
      occurrence.ends.length !== 1 ||
      occurrence.results.length !== 1
    ) continue;
    const { index, value } = entries[0]!;
    if (index >= validPrefixEnd) continue;
    const [start, end, result] = [
      occurrence.starts[0]!,
      occurrence.ends[0]!,
      occurrence.results[0]!,
    ];
    if (!matchesOriginalToolResult(events, start, end, result, index, value)) continue;
    ends.add(end);
    results.add(result);
    consumed.add(index);
    invalid.delete(index);
  }
  return { ends, results, consumed, invalid };
}
