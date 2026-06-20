function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Normalize provider tool input by removing transient empty-object prefixes. */
export function stripLeadingEmptyObjectPlaceholder(rawArgs: string): string {
  let normalized = rawArgs.trim();

  while (normalized.startsWith("{}")) {
    const remainder = normalized.slice(2).trimStart();
    if (remainder.startsWith("{")) {
      normalized = remainder;
      continue;
    }

    if (remainder.startsWith('"')) {
      normalized = `{${remainder}`;
      continue;
    }

    break;
  }

  return normalized;
}

/**
 * Minimum overlap length at which `mergeToolInputDelta` will accept a
 * tail-overlap as an intentional retransmission from the provider and
 * dedup the leading chunk of the next delta.
 *
 * Empirically, overlaps of 1-3 characters are almost always coincidental
 * in streamed JSON (e.g. `"`, `,`, `":`, `,"`). Accepting them as dedup
 * causes silent character drops - the exact pathology observed in staging
 * on 2026-04-15 where `create_file` tool calls arrived at the classifier
 * with 2-5 chars missing from the middle of the buffer. Requiring at
 * least 4 chars of overlap makes false matches vanishingly unlikely while
 * still honoring the real "retransmitted content-suffix" case pinned by
 * the existing "overlapping suffix dedup" regression test (which relies
 * on a 6-char `Report` overlap).
 *
 * Similarly, short deltas (< 4 chars) are treated as append-mode
 * regardless of what they look like: a 1-char delta literally cannot
 * contain enough signal to distinguish retransmission from append, and
 * it will not silently drop it.
 */
const MIN_OVERLAP_DEDUP_LENGTH = 4;

/** Merge tool input delta helper. */
export function mergeToolInputDelta(currentArguments: string, nextDelta: string): string {
  const normalizedDelta = nextDelta.trimStart();
  const candidateDeltas = normalizedDelta.startsWith('"')
    ? [normalizedDelta, `{${normalizedDelta}`]
    : [normalizedDelta];

  if (currentArguments === "{}" || currentArguments.length === 0) {
    for (const candidate of candidateDeltas) {
      if (candidate.startsWith("{")) {
        return candidate;
      }
    }
  }

  if (nextDelta.length === 0) {
    return currentArguments;
  }

  if (currentArguments.length === 0) {
    return nextDelta;
  }

  // Short deltas are trusted as append-mode. Retransmission at this size
  // is indistinguishable from append and would produce more corruption
  // than it prevents; see MIN_OVERLAP_DEDUP_LENGTH.
  if (nextDelta.length < MIN_OVERLAP_DEDUP_LENGTH) {
    return currentArguments + nextDelta;
  }

  for (const candidate of candidateDeltas) {
    // Exact duplicate: the provider resent the same full buffer.
    if (candidate === currentArguments) {
      return currentArguments;
    }

    // Cumulative mode: the delta is a strict extension of the current
    // buffer and supersedes it verbatim.
    if (candidate.startsWith(currentArguments)) {
      return candidate;
    }

    // Tail retransmission: the provider resent a suffix of the current
    // buffer as the prefix of the new delta. Only accept overlaps of
    // MIN_OVERLAP_DEDUP_LENGTH or longer. Trivial 1-3 char matches in
    // streamed JSON are overwhelmingly coincidental and deduping them
    // corrupts append-mode streams.
    const maxOverlap = Math.min(currentArguments.length, candidate.length);
    for (let overlap = maxOverlap; overlap >= MIN_OVERLAP_DEDUP_LENGTH; overlap--) {
      if (currentArguments.endsWith(candidate.slice(0, overlap))) {
        return currentArguments + candidate.slice(overlap);
      }
    }
  }

  return currentArguments + nextDelta;
}

/** Input payload for merge tool call. */
export function mergeToolCallInput(currentArguments: string, nextInput: string): string {
  if (currentArguments.length === 0) {
    return nextInput;
  }

  const normalizedCurrent = stripLeadingEmptyObjectPlaceholder(currentArguments);

  if (nextInput.trim() === "{}" && currentArguments.trim().startsWith("{")) {
    return currentArguments;
  }

  if (nextInput.trim() === "{}" && normalizedCurrent.trim().startsWith("{")) {
    return normalizedCurrent;
  }

  if (currentArguments.trim() === "{}" && nextInput.trim().startsWith("{")) {
    return nextInput;
  }

  return nextInput;
}

/** Parses tool input object. */
export function parseToolInputObject(input: unknown): Record<string, unknown> {
  if (isRecord(input)) {
    return input;
  }

  if (typeof input === "string") {
    try {
      const parsed = JSON.parse(stripLeadingEmptyObjectPlaceholder(input));
      if (isRecord(parsed)) {
        return parsed;
      }
    } catch {
      return {};
    }
  }

  return {};
}
