import { logger } from "#veryfront/utils";

/** Maximum decoded provider SSE data retained or parsed in one pass. */
export const MAX_PROVIDER_SSE_BUFFER_CODE_UNITS = 8 * 1024 * 1024;

function parseBoundedSseChunk(chunk: string, maximumCodeUnits: number): {
  events: Array<unknown | "[DONE]">;
  remainder: string;
} {
  if (typeof chunk !== "string") {
    throw new TypeError("Provider SSE chunk must be a string");
  }
  if (chunk.length > maximumCodeUnits) {
    throw new RangeError(
      `Provider SSE buffer exceeded ${MAX_PROVIDER_SSE_BUFFER_CODE_UNITS} code units`,
    );
  }
  return parseSseBlocks(chunk);
}

/**
 * Parse a bounded provider SSE buffer.
 *
 * CR, LF, and CRLF framing are accepted. Malformed JSON and buffers above the
 * fixed retention limit fail closed rather than being silently discarded.
 */
export function parseSseChunk(chunk: string): {
  events: Array<unknown | "[DONE]">;
  remainder: string;
} {
  return parseBoundedSseChunk(chunk, MAX_PROVIDER_SSE_BUFFER_CODE_UNITS);
}

/**
 * Parse the final unterminated SSE block without making the synthetic frame
 * delimiter count against the caller-visible retention boundary.
 */
export function parseFinalSseChunk(chunk: string): {
  events: Array<unknown | "[DONE]">;
  remainder: string;
} {
  if (typeof chunk !== "string") {
    throw new TypeError("Provider SSE chunk must be a string");
  }
  if (chunk.length > MAX_PROVIDER_SSE_BUFFER_CODE_UNITS) {
    throw new RangeError(
      `Provider SSE buffer exceeded ${MAX_PROVIDER_SSE_BUFFER_CODE_UNITS} code units`,
    );
  }
  return parseBoundedSseChunk(
    `${chunk}\n\n`,
    MAX_PROVIDER_SSE_BUFFER_CODE_UNITS + 2,
  );
}

function parseSseBlocks(chunk: string): {
  events: Array<unknown | "[DONE]">;
  remainder: string;
} {
  const blocks = chunk.split(/(?:\r\n|\r|\n)(?:\r\n|\r|\n)/);
  const remainder = blocks.pop() ?? "";
  if (remainder.length > MAX_PROVIDER_SSE_BUFFER_CODE_UNITS) {
    throw new RangeError(
      `Provider SSE remainder exceeded ${MAX_PROVIDER_SSE_BUFFER_CODE_UNITS} code units`,
    );
  }
  const events = blocks.flatMap((block) => {
    const dataLines = block.split(/\r\n|\r|\n/)
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
    } catch (error) {
      logger.debug("Rejected malformed SSE event", {
        errorName: error instanceof Error ? error.name : typeof error,
        payloadLength: payload.length,
      });
      // Native JSON parse errors can embed the rejected payload in their
      // message. Do not retain that error as a public cause.
      throw new SyntaxError("Provider SSE event contained malformed JSON");
    }
  });

  return { events, remainder };
}
