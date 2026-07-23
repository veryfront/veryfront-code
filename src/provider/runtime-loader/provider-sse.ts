const MAX_SSE_EVENT_CHARACTERS = 4 * 1_024 * 1_024;
const MAX_SSE_CHUNK_CHARACTERS = 8 * 1_024 * 1_024;
const MAX_SSE_EVENTS_PER_CHUNK = 4_096;

/** Controls how malformed JSON data events are handled. */
export interface ParseSseChunkOptions {
  /** Policy for a complete `data:` event that is not valid JSON. */
  invalidEventPolicy?: "throw" | "ignore";
}

/** Parses complete JSON data events from an SSE text buffer. */
export function parseSseChunk(chunk: string, options: ParseSseChunkOptions = {}): {
  events: Array<unknown | "[DONE]">;
  remainder: string;
} {
  if (typeof chunk !== "string") {
    throw new TypeError("SSE chunk must be text");
  }
  if (chunk.length > MAX_SSE_CHUNK_CHARACTERS) {
    throw new RangeError("SSE chunk exceeded the supported size");
  }
  const blocks = chunk.split(/\r\n\r\n|\n\n|\r\r/u);
  const remainder = blocks.pop() ?? "";
  if (blocks.length > MAX_SSE_EVENTS_PER_CHUNK) {
    throw new RangeError("SSE chunk contained too many events");
  }
  if (remainder.length > MAX_SSE_EVENT_CHARACTERS) {
    throw new RangeError("SSE event exceeded the supported size");
  }
  const events = blocks.flatMap((block) => {
    if (block.length > MAX_SSE_EVENT_CHARACTERS) {
      throw new RangeError("SSE event exceeded the supported size");
    }
    const dataLines = block.split(/\r\n|\r|\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      return [];
    }

    const payload = dataLines.join("\n").trim();
    if (payload === "[DONE]") {
      return ["[DONE]" as const];
    }

    try {
      return [JSON.parse(payload) as unknown];
    } catch {
      if (options.invalidEventPolicy === "ignore") {
        return [];
      }
      throw new SyntaxError("Provider SSE event contained invalid JSON");
    }
  });

  return { events, remainder };
}
