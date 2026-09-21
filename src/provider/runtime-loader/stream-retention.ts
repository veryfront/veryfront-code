import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

/**
 * Retention bounds for content a provider stream adapter keeps while it
 * assembles a response: tool-call arguments, and raw text or reasoning kept for
 * replay.
 *
 * The provider chooses how finely it chunks a stream, and fine-grained tool
 * streaming emits dozens of deltas per second. A limit on the number of deltas
 * is therefore a wall-clock limit in disguise: 4,096 deltas is about 110
 * seconds of Claude tool-input streaming. Retained content is bounded by UTF-8
 * bytes instead. Only zero-byte fragments are counted, because they are the
 * only ones that can arrive without advancing the byte budget.
 */
export interface StreamRetentionLimits {
  /** Maximum UTF-8 bytes retained for this budget. */
  readonly maxBytes: number;
  /** Maximum zero-byte fragments accepted for this budget. */
  readonly maxEmptyFragments: number;
}

/** Running totals for one retention budget. Create with {@link createStreamRetentionBudget}. */
export interface StreamRetentionBudget {
  bytes: number;
  emptyFragments: number;
}

/** Which limit a fragment would exceed. */
export type StreamRetentionOverflow = "bytes" | "empty-fragments";

/** Create an empty retention budget. */
export function createStreamRetentionBudget(): StreamRetentionBudget {
  return { bytes: 0, emptyFragments: 0 };
}

/**
 * Reserve room for one streamed fragment. Returns the exceeded limit without
 * changing the budget, or `undefined` once the fragment is accounted for.
 */
export function reserveStreamRetention(
  budget: StreamRetentionBudget,
  fragment: string,
  limits: StreamRetentionLimits,
): StreamRetentionOverflow | undefined {
  const remainingBytes = limits.maxBytes - budget.bytes;
  const fragmentBytes = utf8ByteLength(fragment, Math.max(0, remainingBytes));
  if (fragmentBytes === 0) {
    if (budget.emptyFragments >= limits.maxEmptyFragments) return "empty-fragments";
    budget.emptyFragments++;
    return undefined;
  }
  if (fragmentBytes > remainingBytes) return "bytes";
  budget.bytes += fragmentBytes;
  return undefined;
}

/** Fragments joined into one string at a time, bounding array growth. */
export const STREAM_FRAGMENT_COMPACTION_SIZE = 256;

/**
 * Accumulates streamed string fragments with storage proportional to their
 * content rather than to how many fragments the provider sent. Every
 * {@link STREAM_FRAGMENT_COMPACTION_SIZE} fragments are joined into one string,
 * so millions of one-byte deltas do not become millions of array entries.
 */
export class StreamFragmentBuffer {
  readonly #compacted: string[] = [];
  readonly #pending: string[] = [];

  constructor(initial = "") {
    this.append(initial);
  }

  /** Append one streamed fragment. Empty fragments are ignored. */
  append(fragment: string): void {
    if (fragment.length === 0) return;
    this.#pending.push(fragment);
    if (this.#pending.length >= STREAM_FRAGMENT_COMPACTION_SIZE) {
      this.#compacted.push(this.#pending.join(""));
      this.#pending.length = 0;
    }
  }

  /** Number of retained storage entries, for tests and diagnostics. */
  get storageEntries(): number {
    return this.#compacted.length + this.#pending.length;
  }

  /** The accumulated content. */
  toString(): string {
    return this.#compacted.join("") + this.#pending.join("");
  }
}
