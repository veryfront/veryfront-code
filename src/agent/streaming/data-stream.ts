import { serverLogger } from "#veryfront/utils";
import type { AgUiRuntimeStreamEvent } from "../ag-ui/browser-encoder.ts";

export {
  mergeToolCallInput,
  mergeToolInputDelta,
  parseToolInputObject,
  stripLeadingEmptyObjectPlaceholder,
} from "./tool-input.ts";

const logger = serverLogger.component("agent-data-stream");

/** Parses data stream sse events. */
export function parseDataStreamSseEvents(chunk: string): {
  events: AgUiRuntimeStreamEvent[];
  remainder: string;
} {
  const blocks = chunk.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks.flatMap((block) => {
    const dataLines = block.split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());

    if (!dataLines.length) {
      return [];
    }

    const payload = dataLines.join("\n");
    if (payload.trim() === "[DONE]") {
      return [];
    }

    try {
      return [JSON.parse(payload) as AgUiRuntimeStreamEvent];
    } catch (error) {
      logger.warn("Dropped malformed SSE data block", {
        errorName: error instanceof Error ? error.name : typeof error,
        payloadLength: payload.length,
      });
      return [];
    }
  });

  return { events, remainder };
}

/** Stream data stream events helper. */
export async function* streamDataStreamEvents(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<AgUiRuntimeStreamEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }

      remainder += decoder.decode(value, { stream: true });
      const parsed = parseDataStreamSseEvents(remainder);
      remainder = parsed.remainder;

      for (const event of parsed.events) {
        yield event;
      }
    }

    remainder += decoder.decode();
    const parsed = parseDataStreamSseEvents(`${remainder}\n\n`);
    for (const event of parsed.events) {
      yield event;
    }
  } finally {
    if (!completed) {
      try {
        await reader.cancel();
      } catch (error) {
        logger.debug("Data stream reader cancellation failed during cleanup", { error });
      }
    }
    reader.releaseLock();
  }
}
