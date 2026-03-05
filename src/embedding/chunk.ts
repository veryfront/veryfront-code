import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import type { ChunkOptions } from "./types.ts";

/**
 * Splits text into overlapping chunks for embedding.
 *
 * Uses LangChain's `RecursiveCharacterTextSplitter` behind the facade,
 * which splits on hierarchical separators (paragraphs, then lines, then
 * words, then characters) to produce semantically coherent chunks.
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
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: options?.maxChars ?? 2000,
    chunkOverlap: options?.overlap ?? 200,
    separators: options?.separators ?? ["\n\n", "\n", " ", ""],
  });
  return splitter.splitText(text);
}
