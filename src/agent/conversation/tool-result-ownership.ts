/** Trusted finalization metadata. External data chunks cannot use this name. */
export const TOOL_RESULT_OWNERSHIP_CORRECTION = "veryfront.tool_result_ownership";

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
    Object.keys(record).sort().join(",") !==
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

/** Bind metadata to one original result without replaying input or output. */
export function resolveToolResultOwnershipCorrections(
  events: readonly StoredEvent[],
  requireVersion2Envelope = false,
) {
  // Authority requires a valid prefix through the correction. Later unrelated
  // failures retain the reader's existing partial-frame diagnostics.
  let validPrefixEnd = events.length;
  if (requireVersion2Envelope) {
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
        validPrefixEnd = index;
        break;
      }
      sequence = next;
      keys.add(key);
    }
  }
  const ends = new Set<number>();
  const results = new Set<number>();
  const consumed = new Set<number>();
  const invalid = new Set<number>();
  const occurrences = new Map<string, { starts: number[]; ends: number[]; results: number[] }>();
  const correctionCounts = new Map<string, number>();
  const corrections = new Map<string, { index: number; value: Correction }[]>();
  for (const [index, event] of events.entries()) {
    if (event.type === "CUSTOM" && event.name === TOOL_RESULT_OWNERSHIP_CORRECTION) {
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
    if (typeof event.toolCallId !== "string") continue;
    const occurrence = occurrences.get(event.toolCallId) ?? { starts: [], ends: [], results: [] };
    if (event.type === "TOOL_CALL_START") occurrence.starts.push(index);
    if (event.type === "TOOL_CALL_END") occurrence.ends.push(index);
    if (event.type === "TOOL_CALL_RESULT") occurrence.results.push(index);
    occurrences.set(event.toolCallId, occurrence);
  }
  for (const [id, entries] of corrections) {
    const occurrence = occurrences.get(id);
    if (
      entries.length !== 1 || correctionCounts.get(id) !== 1 || !occurrence ||
      occurrence.starts.length !== 1 || occurrence.ends.length !== 1 ||
      occurrence.results.length !== 1
    ) continue;
    const { index, value } = entries[0]!;
    if (index >= validPrefixEnd) continue;
    const [start, end, result] = [
      occurrence.starts[0]!,
      occurrence.ends[0]!,
      occurrence.results[0]!,
    ];
    if (!(start < end && end < result && result < index)) continue;
    const started = events[start]!;
    const ended = events[end]!;
    const output = events[result]!;
    if ([started, ended, output].some((event) => event.providerExecuted !== undefined)) continue;
    if (
      (started.toolName ?? started.toolCallName) !== value.toolName ||
      started.parentMessageId !== value.parentMessageId ||
      output.parentMessageId !== value.parentMessageId
    ) continue;
    if (output.toolName !== undefined && output.toolName !== value.toolName) continue;
    if (ended.parentMessageId !== undefined && ended.parentMessageId !== value.parentMessageId) {
      continue;
    }
    ends.add(end);
    results.add(result);
    consumed.add(index);
    invalid.delete(index);
  }
  return { ends, results, consumed, invalid };
}
