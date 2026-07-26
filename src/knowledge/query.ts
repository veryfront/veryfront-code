import type { RagSearchResult } from "#veryfront/embedding/index.ts";
import { DEFAULT_QUERY_MAX_CHARS, MAX_QUERY_CHARS, MAX_RAW_QUERY_CODE_UNITS } from "./config.ts";

const MAX_CONTEXT_RESULTS = 100;
const MAX_CONTEXT_TITLE_CODE_UNITS = 4_096;
const MAX_KNOWLEDGE_CONTEXT_BYTES = 1024 * 1024;
const utf8Encoder = new TextEncoder();

function truncateWithoutSplittingSurrogate(
  value: string,
  maximumCodeUnits: number,
): string {
  if (value.length <= maximumCodeUnits) return value;
  let end = maximumCodeUnits;
  const last = value.charCodeAt(end - 1);
  const next = value.charCodeAt(end);
  if (
    last >= 0xd800 &&
    last <= 0xdbff &&
    next >= 0xdc00 &&
    next <= 0xdfff
  ) {
    end -= 1;
  }
  return value.slice(0, end);
}

/** Normalize and bound a knowledge query before retrieval. */
export function normalizeKnowledgeQuery(
  query: string,
  maxChars: number = DEFAULT_QUERY_MAX_CHARS,
): string {
  if (typeof query !== "string") {
    throw new TypeError("Knowledge query must be a string");
  }
  if (query.length > MAX_RAW_QUERY_CODE_UNITS) {
    throw new RangeError(
      `Knowledge query must not exceed ${MAX_RAW_QUERY_CODE_UNITS} input code units`,
    );
  }
  if (
    !Number.isSafeInteger(maxChars) ||
    maxChars < 1 ||
    maxChars > MAX_QUERY_CHARS
  ) {
    throw new RangeError(
      `Knowledge maxQueryChars must be a safe integer between 1 and ${MAX_QUERY_CHARS}`,
    );
  }

  const normalized = query.replace(/\s+/gu, " ").trim();
  return truncateWithoutSplittingSurrogate(normalized, maxChars);
}

/** Format search results into a deterministic, bounded prompt context block. */
export function formatKnowledgeContext(results: RagSearchResult[]): string {
  if (!Array.isArray(results) || results.length > MAX_CONTEXT_RESULTS) {
    throw new RangeError(
      `Knowledge context accepts at most ${MAX_CONTEXT_RESULTS} results`,
    );
  }

  const sections: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (
      !result ||
      typeof result !== "object" ||
      typeof result.title !== "string" ||
      result.title.length > MAX_CONTEXT_TITLE_CODE_UNITS ||
      typeof result.text !== "string" ||
      result.text.length > MAX_KNOWLEDGE_CONTEXT_BYTES ||
      typeof result.score !== "number" ||
      !Number.isFinite(result.score)
    ) {
      throw new TypeError(`Knowledge context result ${index} is malformed`);
    }
    const section = `[${result.title}] (score: ${result.score.toFixed(2)})\n${result.text}`;
    totalBytes += utf8Encoder.encode(section).byteLength;
    if (index > 0) totalBytes += "\n\n---\n\n".length;
    if (totalBytes > MAX_KNOWLEDGE_CONTEXT_BYTES) {
      throw new RangeError(
        `Knowledge context exceeds ${MAX_KNOWLEDGE_CONTEXT_BYTES} UTF-8 bytes`,
      );
    }
    sections.push(section);
  }
  return sections.join("\n\n---\n\n");
}
