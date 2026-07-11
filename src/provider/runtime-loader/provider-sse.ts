import { logger } from "#veryfront/utils";

/** Parses sse chunk. */
export function parseSseChunk(chunk: string): {
  events: Array<unknown | "[DONE]">;
  remainder: string;
} {
  const blocks = chunk.split(/\r?\n\r?\n/);
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const dataLines = block.split(/\r?\n/)
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
      logger.debug("Dropped malformed SSE event", {
        error: error instanceof Error ? error.message : String(error),
        payload: payload.slice(0, 200),
      });
      return [];
    }
  });

  return { events, remainder };
}
