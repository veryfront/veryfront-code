import type { ChunkOptions } from "./types.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import {
  MAX_EMBEDDING_INPUTS,
  MAX_EMBEDDING_TOTAL_LENGTH,
  validateBoundedString,
  validateChunkOptions,
} from "./validation.ts";

function assertChunkCount(count: number): void {
  if (count > MAX_EMBEDDING_INPUTS) {
    throw INVALID_ARGUMENT.create({
      detail: `Chunking supports at most ${MAX_EMBEDDING_INPUTS} chunks`,
    });
  }
}

function appendChunk(chunks: string[], value: string, totalLength: number): number {
  const nextTotalLength = totalLength + value.length;
  if (nextTotalLength > MAX_EMBEDDING_TOTAL_LENGTH) {
    throw INVALID_ARGUMENT.create({
      detail: "Chunking output exceeds the supported total size",
    });
  }
  chunks.push(value);
  assertChunkCount(chunks.length);
  return nextTotalLength;
}

/**
 * Splits text into overlapping chunks for embedding.
 *
 * Uses a recursive character splitting strategy: tries each separator in
 * order (paragraphs, lines, words, then characters) to produce semantically
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
  const stableText = validateBoundedString(
    text,
    "chunk text",
    MAX_EMBEDDING_TOTAL_LENGTH,
    { allowEmpty: true },
  );
  const { maxChars, overlap, separators } = validateChunkOptions(options);
  const effectiveSeparators = separators.includes("") ? separators : [...separators, ""];

  const chunks = splitRecursive(stableText, effectiveSeparators, maxChars, overlap);
  return stableText.length === 0 ? chunks : chunks.filter((value) => value.trim().length > 0);
}

function splitRecursive(
  text: string,
  separators: string[],
  maxChars: number,
  overlap: number,
): string[] {
  if (text.length <= maxChars) return [text];

  const sep = separators.find((s) => text.includes(s)) ?? "";
  if (sep === "") {
    return splitByCharacterRange(text, maxChars, overlap);
  }

  const chunks: string[] = [];
  let chunkTotalLength = 0;
  let currentStart = 0;
  let currentEnd = 0;
  let hasCurrent = false;
  let partStart = 0;

  while (partStart <= text.length) {
    const separatorIndex = text.indexOf(sep, partStart);
    const partEnd = separatorIndex === -1 ? text.length : separatorIndex;

    if (!hasCurrent) {
      currentStart = partStart;
      currentEnd = partEnd;
      hasCurrent = currentEnd > currentStart;
    } else if (partEnd - currentStart > maxChars) {
      chunkTotalLength = appendChunk(
        chunks,
        text.slice(currentStart, currentEnd),
        chunkTotalLength,
      );
      currentStart = overlap > 0
        ? safeTailStart(text, currentStart, currentEnd, overlap)
        : partStart;
      currentEnd = partEnd;
      hasCurrent = currentEnd > currentStart;
    } else {
      currentEnd = partEnd;
    }

    if (separatorIndex === -1) break;
    partStart = separatorIndex + sep.length;
  }
  if (hasCurrent) {
    chunkTotalLength = appendChunk(
      chunks,
      text.slice(currentStart, currentEnd),
      chunkTotalLength,
    );
  }

  // If any chunk still exceeds maxChars, recurse with next separator
  const remaining = separators.slice(separators.indexOf(sep) + 1);
  if (remaining.length === 0) return chunks;

  const results: string[] = [];
  let resultTotalLength = 0;
  for (const value of chunks) {
    const values = value.length > maxChars
      ? splitRecursive(value, remaining, maxChars, overlap)
      : [value];
    for (const nestedValue of values) {
      resultTotalLength = appendChunk(results, nestedValue, resultTotalLength);
    }
  }
  return results;
}

function splitByCharacterRange(
  text: string,
  maxChars: number,
  overlap: number,
): string[] {
  const chunks: string[] = [];
  let totalLength = 0;
  let start = 0;

  while (start < text.length) {
    let end = Math.min(text.length, start + maxChars);
    if (
      end < text.length && isHighSurrogate(text.charCodeAt(end - 1)) &&
      isLowSurrogate(text.charCodeAt(end))
    ) {
      end--;
    }
    if (end === start) {
      end = Math.min(text.length, start + 2);
    }

    totalLength = appendChunk(chunks, text.slice(start, end), totalLength);
    if (end === text.length) break;

    const nextStart = overlap > 0 ? safeTailStart(text, start, end, overlap) : end;
    start = nextStart > start ? nextStart : end;
  }

  return chunks;
}

function safeTailStart(
  text: string,
  chunkStart: number,
  chunkEnd: number,
  overlap: number,
): number {
  let start = Math.max(chunkStart, chunkEnd - overlap);
  if (
    start > chunkStart && isLowSurrogate(text.charCodeAt(start)) &&
    isHighSurrogate(text.charCodeAt(start - 1))
  ) {
    start--;
  }
  return start;
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
}
