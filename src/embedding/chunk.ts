import type { ChunkOptions } from "./types.ts";

/** Default maximum characters per chunk (~512 tokens). */
const DEFAULT_CHUNK_MAX_CHARS = 2_000;

/** Default character overlap between consecutive chunks. */
const DEFAULT_CHUNK_OVERLAP = 200;
const MAX_CHUNK_OVERLAP_RATIO = 0.5;
const MAX_SEPARATOR_COUNT = 128;
const MAX_SEPARATOR_LENGTH = 1_024;

/**
 * Splits text into overlapping chunks for embedding.
 *
 * Uses a recursive character splitting strategy: tries each separator in
 * order (paragraphs → lines → words → characters) to produce semantically
 * coherent chunks within the size limit.
 *
 * Default chunk size is 2000 characters (~512 tokens), aligned with
 * common embedding model context limits (e.g. OpenAI's 8191-token max).
 *
 * @example
 * ```ts
 * const chunks = await chunk("long document...", { maxChars: 2000, overlap: 200 });
 * ```
 */
export async function chunk(text: string, options?: ChunkOptions): Promise<string[]> {
  if (typeof text !== "string") {
    throw new TypeError("chunk text must be a string");
  }
  const maxChars = options?.maxChars ?? DEFAULT_CHUNK_MAX_CHARS;
  const overlap = options?.overlap ??
    (Number.isSafeInteger(maxChars) && maxChars > 0
      ? Math.min(DEFAULT_CHUNK_OVERLAP, Math.floor(maxChars / 10))
      : DEFAULT_CHUNK_OVERLAP);
  if (options?.separators !== undefined && !Array.isArray(options.separators)) {
    throw new TypeError("chunk separators must be an array");
  }
  const separators = [...(options?.separators ?? ["\n\n", "\n", " ", ""])];

  validateChunkOptions(maxChars, overlap, separators);
  return splitIterative(text, separators, maxChars, overlap);
}

function validateChunkOptions(
  maxChars: number,
  overlap: number,
  separators: string[],
): void {
  if (!Number.isSafeInteger(maxChars) || maxChars < 1) {
    throw new RangeError("chunk maxChars must be a positive safe integer");
  }
  if (
    !Number.isSafeInteger(overlap) ||
    overlap < 0 ||
    overlap > Math.floor(maxChars * MAX_CHUNK_OVERLAP_RATIO)
  ) {
    throw new RangeError(
      `chunk overlap must be a non-negative safe integer no greater than ${
        Math.floor(MAX_CHUNK_OVERLAP_RATIO * 100)
      }% of maxChars`,
    );
  }
  if (separators.length > MAX_SEPARATOR_COUNT) {
    throw new RangeError(
      `chunk separators must contain at most ${MAX_SEPARATOR_COUNT} entries`,
    );
  }
  for (let index = 0; index < separators.length; index++) {
    const separator = separators[index];
    if (typeof separator !== "string") {
      throw new TypeError(`chunk separators[${index}] must be a string`);
    }
    if (codePointLength(separator) > MAX_SEPARATOR_LENGTH) {
      throw new RangeError(
        `chunk separators[${index}] must contain at most ${MAX_SEPARATOR_LENGTH} characters`,
      );
    }
  }
}

interface PendingSplit {
  text: string;
  separatorIndex: number;
}

function splitIterative(
  text: string,
  separators: string[],
  maxChars: number,
  overlap: number,
): string[] {
  const pending: PendingSplit[] = [{ text, separatorIndex: 0 }];
  const result: string[] = [];

  while (pending.length > 0) {
    const item = pending.pop()!;
    if (codePointLength(item.text) <= maxChars) {
      result.push(item.text);
      continue;
    }

    let selectedIndex = separators.length;
    let separator = "";
    for (let index = item.separatorIndex; index < separators.length; index++) {
      const candidate = separators[index]!;
      if (candidate === "" || item.text.includes(candidate)) {
        selectedIndex = index;
        separator = candidate;
        break;
      }
    }

    const chunks = splitOnce(item.text, separator, maxChars, overlap);
    const nextSeparatorIndex = selectedIndex < separators.length
      ? selectedIndex + 1
      : separators.length;
    for (let index = chunks.length - 1; index >= 0; index--) {
      pending.push({
        text: chunks[index]!,
        separatorIndex: nextSeparatorIndex,
      });
    }
  }

  return result;
}

function splitOnce(
  text: string,
  separator: string,
  maxChars: number,
  overlap: number,
): string[] {
  const parts = separator ? text.split(separator) : Array.from(text);
  const separatorLength = codePointLength(separator);
  const chunks: string[] = [];
  let current = "";
  let currentLength = 0;

  for (const part of parts) {
    const partLength = codePointLength(part);
    const candidateLength = current ? currentLength + separatorLength + partLength : partLength;
    if (candidateLength > maxChars && current) {
      chunks.push(current);
      const tail = overlap > 0 ? takeLastCodePoints(current, overlap) : "";
      current = tail ? tail + separator + part : part;
      currentLength = codePointLength(current);
    } else {
      current = current ? current + separator + part : part;
      currentLength = candidateLength;
    }
  }
  if (current) chunks.push(current);

  return chunks;
}

function codePointLength(value: string): number {
  let length = 0;
  for (const _character of value) length++;
  return length;
}

function takeLastCodePoints(value: string, count: number): string {
  const points = Array.from(value);
  return points.slice(Math.max(0, points.length - count)).join("");
}
