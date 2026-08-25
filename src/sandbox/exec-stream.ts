/**
 * Shared NDJSON reader for sandbox exec streams.
 * @module sandbox/exec-stream
 */

import type { ExecStreamEvent } from "./types.ts";

/**
 * Parses one NDJSON line, reporting null for anything unusable.
 *
 * A malformed line is skipped rather than thrown. This transport delivers
 * truncated network chunks, and aborting would discard every event already
 * buffered ahead of the bad line.
 */
function parseExecStreamLine(line: string): ExecStreamEvent | null {
  if (!line.trim()) return null;

  try {
    return JSON.parse(line) as ExecStreamEvent;
  } catch (_) {
    /* expected: truncated or malformed NDJSON line, skipped to keep streaming */
    return null;
  }
}

/**
 * Reads an exec response body as NDJSON, yielding one event per line.
 *
 * Sandbox and LazySandbox consume the same stream, so the loop lives here.
 * Keeping a copy in each is what let them disagree about malformed input: the
 * eager path skipped a bad line while the lazy one threw out of the generator
 * and dropped the output that had already arrived.
 */
export async function* readExecStreamEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ExecStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        completed = true;
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const event = parseExecStreamLine(line);
        if (event) yield event;
      }
    }

    buffer += decoder.decode();
    const trailing = parseExecStreamLine(buffer);
    if (trailing) yield trailing;
  } finally {
    // An early return from the caller leaves the stream open; cancel it so the
    // connection is not held until GC.
    if (!completed) {
      await reader.cancel().catch(() => {});
    }
    reader.releaseLock();
  }
}
