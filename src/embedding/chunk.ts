import type { ChunkOptions } from "./types.ts";

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
  const maxChars = options?.maxChars ?? 2000;
  const overlap = options?.overlap ?? 200;
  const separators = options?.separators ?? ["\n\n", "\n", " ", ""];

  return splitRecursive(text, separators, maxChars, overlap);
}

function splitRecursive(
  text: string,
  separators: string[],
  maxChars: number,
  overlap: number,
): string[] {
  if (text.length <= maxChars) return [text];

  const sep = separators.find((s) => text.includes(s)) ?? "";
  const parts = sep ? text.split(sep) : [...text];

  const chunks: string[] = [];
  let current = "";

  for (const part of parts) {
    const candidate = current ? current + sep + part : part;
    if (candidate.length > maxChars && current) {
      chunks.push(current);
      // Overlap: keep the tail of the current chunk
      const tail = current.slice(-overlap);
      current = tail ? tail + sep + part : part;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);

  // If any chunk still exceeds maxChars, recurse with next separator
  const remaining = separators.slice(separators.indexOf(sep) + 1);
  if (remaining.length === 0) return chunks;

  return chunks.flatMap((c) =>
    c.length > maxChars ? splitRecursive(c, remaining, maxChars, overlap) : [c]
  );
}
