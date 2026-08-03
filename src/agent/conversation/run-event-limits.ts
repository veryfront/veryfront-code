/**
 * Per-event payload budget the conversation run append endpoint accepts.
 *
 * Owned by a leaf module so every producer of durable run events sizes against
 * one number instead of a duplicated literal.
 */
export const MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES = 240 * 1024;

/** Maximum JSON body accepted by the trusted conversation run-event endpoint. */
export const MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES = 10 * 1024 * 1024;

const encoder = new TextEncoder();

/** Return the conservative append-request size for one private durable event. */
export function getPrivateRunEventAppendRequestByteLength(event: unknown): number {
  try {
    return encoder.encode(JSON.stringify({
      expected_previous_event_id: Number.MAX_SAFE_INTEGER,
      events: [event],
    })).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}
