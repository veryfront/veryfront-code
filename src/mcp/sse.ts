/**
 * Stateless SSE formatting utilities per the Server-Sent Events standard.
 * Used by the Streamable HTTP transport for MCP.
 */

import { hasUnsafeControlCharacters } from "#veryfront/errors/text-validation.ts";

const MAX_EVENT_ID_LENGTH = 1024;
const MAX_EVENT_DATA_BYTES = 4 * 1024 * 1024;
const MAX_RETRY_INTERVAL_MS = 2_147_483_647;

function validateEventId(id: unknown): asserts id is string {
  if (
    typeof id !== "string" || id.length === 0 || id.length > MAX_EVENT_ID_LENGTH ||
    hasUnsafeControlCharacters(id)
  ) {
    throw new TypeError(
      `The SSE event ID must contain 1 to ${MAX_EVENT_ID_LENGTH} characters without control characters`,
    );
  }
}

function serializeEventData(data: unknown): string {
  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(data);
  } catch {
    throw new TypeError("SSE event data must be JSON-serializable");
  }

  if (serialized === undefined) {
    throw new TypeError("SSE event data must be JSON-serializable");
  }
  if (new TextEncoder().encode(serialized).byteLength > MAX_EVENT_DATA_BYTES) {
    throw new TypeError(
      `SSE event data must not exceed ${MAX_EVENT_DATA_BYTES} bytes`,
    );
  }
  return serialized;
}

/** Format a bounded JSON value as one Server-Sent Events data event. */
export function formatSSEEvent(data: unknown, id?: string): string {
  let event = "";
  if (id !== undefined) {
    validateEventId(id);
    event += `id: ${id}\n`;
  }
  event += `data: ${serializeEventData(data)}\n\n`;
  return event;
}

/** Formats an SSE reconnection delay directive. */
export function formatSSERetry(ms: number): string {
  if (
    !Number.isSafeInteger(ms) || ms < 0 || ms > MAX_RETRY_INTERVAL_MS
  ) {
    throw new TypeError(
      `The SSE retry interval must be an integer from 0 to ${MAX_RETRY_INTERVAL_MS}`,
    );
  }
  return `retry: ${ms}\n\n`;
}

/** Creates an SSE priming event for connection setup. */
export function formatSSEPrimingEvent(id: string): string {
  validateEventId(id);
  return `id: ${id}\ndata: \n\n`;
}
