import {
  primordialArrayFilter,
  primordialArrayFlatMap,
  primordialArrayJoin,
  primordialArrayMap,
  primordialArrayPop,
  primordialArrayValues,
} from "#veryfront/platform/compat/primordials/array.ts";
import {
  createPrivateTextDecoder,
  privateTextSlice,
  privateTextSplit,
  privateTextStartsWith,
  privateTextTrim,
  privateTextTrimStart,
} from "#veryfront/security/private-text.ts";
import { getPrivateStreamReader } from "#veryfront/security/private-stream.ts";
import { privateJsonParse } from "#veryfront/security/private-json.ts";
import { serverLogger } from "#veryfront/utils";
import type { AgUiRuntimeStreamEvent } from "../ag-ui/encoder.ts";

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
  const blocks = privateTextSplit(chunk, "\n\n");
  const remainder = primordialArrayPop(blocks) ?? "";
  const events = primordialArrayFlatMap(blocks, (block) => {
    const dataLines = primordialArrayMap(
      primordialArrayFilter(
        privateTextSplit(block, "\n"),
        (line) => privateTextStartsWith(line, "data:"),
      ),
      (line) => privateTextTrimStart(privateTextSlice(line, 5)),
    );

    if (!dataLines.length) {
      return [];
    }

    const payload = primordialArrayJoin(dataLines, "\n");
    if (privateTextTrim(payload) === "[DONE]") {
      return [];
    }

    try {
      return [privateJsonParse(payload) as AgUiRuntimeStreamEvent];
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
  const reader = getPrivateStreamReader(stream);
  const decoder = createPrivateTextDecoder();
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

      for (const event of primordialArrayValues(parsed.events)) {
        yield event;
      }
    }

    remainder += decoder.decode();
    const parsed = parseDataStreamSseEvents(`${remainder}\n\n`);
    for (const event of primordialArrayValues(parsed.events)) {
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
