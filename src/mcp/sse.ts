/**
 * Stateless SSE formatting utilities per the Server-Sent Events standard.
 * Available to custom MCP transports that expose an SSE stream.
 */

import { snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

const JsonStringify = JSON.stringify.bind(JSON);

function assertSSEEventId(id: string): void {
  if (id.includes("\0") || id.includes("\r") || id.includes("\n")) {
    throw new TypeError("SSE event id must not contain NUL, CR, or LF");
  }
}

/** Format bounded JSON data as one optional-ID SSE event. */
export function formatSSEEvent(data: unknown, id?: string): string {
  const snapshot = snapshotBoundedJsonValue(data);
  if (!snapshot.success) {
    throw new TypeError("SSE event data must be bounded, data-only JSON");
  }

  let event = "";
  if (id !== undefined) {
    assertSSEEventId(id);
    event += `id: ${id}\n`;
  }
  event += `data: ${JsonStringify(snapshot.value)}\n\n`;
  return event;
}

/** Format an SSE reconnection delay. */
export function formatSSERetry(ms: number): string {
  if (!Number.isSafeInteger(ms) || ms < 0) {
    throw new TypeError("SSE retry delay must be a non-negative safe integer");
  }
  return `retry: ${ms}\n\n`;
}

/** Format an empty SSE event that advances the event ID. */
export function formatSSEPrimingEvent(id: string): string {
  assertSSEEventId(id);
  return `id: ${id}\ndata: \n\n`;
}
