import type { ChunkOptions } from "./types.ts";

/** Default maximum characters per chunk (~512 tokens). */
const DEFAULT_CHUNK_MAX_CHARS = 2_000;

/** Default character overlap between consecutive chunks. */
const DEFAULT_CHUNK_OVERLAP = 200;

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
  return (await chunkWithOffsets(text, options)).map((part) => part.content);
}

/** @internal Canonical UTF-16 source positions, retained during recursive splitting. */
export interface PositionedTextChunk {
  content: string;
  startOffset: number;
  endOffset: number;
}

/** @internal Split without ambiguously searching for repeated text afterward. */
export async function chunkWithOffsets(
  text: string,
  options?: ChunkOptions,
): Promise<PositionedTextChunk[]> {
  return splitRecursive(
    text,
    options?.separators ?? ["\n\n", "\n", " ", ""],
    options?.maxChars ?? DEFAULT_CHUNK_MAX_CHARS,
    options?.overlap ?? DEFAULT_CHUNK_OVERLAP,
    0,
  );
}

function splitRecursive(
  text: string,
  separators: string[],
  maxChars: number,
  overlap: number,
  sourceOffset: number,
): PositionedTextChunk[] {
  if (text.length <= maxChars) {
    return [{ content: text, startOffset: sourceOffset, endOffset: sourceOffset + text.length }];
  }
  const sep = separators.find((s) => text.includes(s)) ?? "";
  const parts = sep ? text.split(sep) : [...text];
  const chunks: PositionedTextChunk[] = [];
  let current = "";
  let currentStart = sourceOffset;
  let partOffset = sourceOffset;
  for (const part of parts) {
    const candidate = current ? current + sep + part : part;
    if (candidate.length > maxChars && current) {
      chunks.push({
        content: current,
        startOffset: currentStart,
        endOffset: currentStart + current.length,
      });
      const tail = overlap > 0 ? current.slice(-overlap) : "";
      currentStart = tail ? currentStart + current.length - tail.length : partOffset;
      current = tail ? tail + sep + part : part;
    } else {
      if (!current) currentStart = partOffset;
      current = candidate;
    }
    partOffset += part.length + sep.length;
  }
  if (current) {
    chunks.push({
      content: current,
      startOffset: currentStart,
      endOffset: currentStart + current.length,
    });
  }
  const remaining = separators.slice(separators.indexOf(sep) + 1);
  if (remaining.length === 0) return chunks;
  return chunks.flatMap((part) =>
    part.content.length > maxChars
      ? splitRecursive(part.content, remaining, maxChars, overlap, part.startOffset)
      : [part]
  );
}
