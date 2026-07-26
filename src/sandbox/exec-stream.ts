import { REQUEST_ERROR } from "#veryfront/errors";
import { parseExecStreamEvent } from "./protocol.ts";
import type { ExecStreamEvent } from "./types.ts";

export const MAX_SANDBOX_EXEC_EVENT_BYTES = 1024 * 1024;

function concatenateSegments(
  segments: readonly Uint8Array[],
  byteLength: number,
): Uint8Array {
  if (segments.length === 1 && segments[0]!.byteLength === byteLength) {
    return segments[0]!;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const segment of segments) {
    bytes.set(segment, offset);
    offset += segment.byteLength;
  }
  return bytes;
}

function cancelReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  reason?: unknown,
): void {
  try {
    const cancellation = reader.cancel(reason);
    void cancellation.catch(() => {});
  } catch {
    // Cancellation is best-effort cleanup and must not hide the protocol error.
  }
}

/**
 * Decode a sandbox NDJSON command stream.
 *
 * Lines are bounded before decoding and every event is validated. Malformed or
 * truncated data fails closed instead of returning a plausible partial command
 * result.
 */
export async function* decodeSandboxExecStream(
  body: ReadableStream<Uint8Array>,
  options: {
    operation?: string;
    maxEventBytes?: number;
  } = {},
): AsyncGenerator<ExecStreamEvent> {
  const operation = options.operation ?? "Sandbox exec stream";
  const maxEventBytes = options.maxEventBytes ?? MAX_SANDBOX_EXEC_EVENT_BYTES;
  if (!Number.isSafeInteger(maxEventBytes) || maxEventBytes <= 0) {
    throw new RangeError("Sandbox exec event byte limit must be a positive safe integer");
  }

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let segments: Uint8Array[] = [];
  let lineByteLength = 0;
  let completed = false;
  let failure: unknown;
  let sawExit = false;

  const append = (segment: Uint8Array) => {
    if (segment.byteLength === 0) return;
    if (segment.byteLength > maxEventBytes - lineByteLength) {
      throw REQUEST_ERROR.create({
        detail: `${operation} event exceeded ${maxEventBytes} bytes`,
      });
    }
    segments.push(segment);
    lineByteLength += segment.byteLength;
  };

  const parseLine = (): ExecStreamEvent | undefined => {
    let bytes = concatenateSegments(segments, lineByteLength);
    segments = [];
    lineByteLength = 0;

    if (bytes.at(-1) === 0x0d) {
      bytes = bytes.subarray(0, bytes.byteLength - 1);
    }
    if (bytes.byteLength === 0) return undefined;

    let line: string;
    try {
      line = decoder.decode(bytes);
    } catch (cause) {
      throw REQUEST_ERROR.create({
        detail: `${operation} event is not valid UTF-8`,
        cause,
      });
    }
    if (!line.trim()) return undefined;

    let value: unknown;
    try {
      value = JSON.parse(line) as unknown;
    } catch (cause) {
      throw REQUEST_ERROR.create({
        detail: `${operation} contains malformed NDJSON`,
        cause,
      });
    }
    return parseExecStreamEvent(value, operation);
  };

  const acceptEvent = (event: ExecStreamEvent): ExecStreamEvent => {
    if (sawExit) {
      throw REQUEST_ERROR.create({
        detail: `${operation} emitted data after its exit event`,
      });
    }
    if (event.type === "exit") sawExit = true;
    return event;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }

      let offset = 0;
      while (offset < value.byteLength) {
        const newlineIndex = value.indexOf(0x0a, offset);
        if (newlineIndex === -1) {
          append(value.subarray(offset));
          break;
        }

        append(value.subarray(offset, newlineIndex));
        const event = parseLine();
        if (event !== undefined) yield acceptEvent(event);
        offset = newlineIndex + 1;
      }
    }

    // Preserve an explicit decoder flush at EOF and surface an incomplete
    // multi-byte sequence even when the final NDJSON record is empty.
    try {
      decoder.decode();
    } catch (cause) {
      throw REQUEST_ERROR.create({
        detail: `${operation} event is not valid UTF-8`,
        cause,
      });
    }

    if (lineByteLength > 0) {
      const event = parseLine();
      if (event !== undefined) yield acceptEvent(event);
    }
    if (!sawExit) {
      throw REQUEST_ERROR.create({
        detail: `${operation} ended without an exit event`,
      });
    }
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    if (!completed) cancelReader(reader, failure);
    reader.releaseLock();
  }
}
