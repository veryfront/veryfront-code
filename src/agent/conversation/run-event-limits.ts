import { encodePrivateText } from "#veryfront/security/private-text.ts";
import { privateByteLength } from "#veryfront/security/private-bytes.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";

/**
 * Per-event payload budget the conversation run append endpoint accepts.
 *
 * Owned by a leaf module so every producer of durable run events sizes against
 * one number instead of a duplicated literal.
 */
export const MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES = 240 * 1024;

/** Maximum JSON body accepted by the trusted conversation run-event endpoint. */
export const MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES = 10 * 1024 * 1024;

/** Maximum root writer credential size, including configured integration grants. */
export const MAX_ROOT_RUN_EVENT_WRITER_TOKEN_BYTES = 32 * 1024;

const encoder = new TextEncoder();

/** Return the conservative append-request size for one private durable event. */
export function getPrivateRunEventAppendRequestByteLength(event: unknown): number {
  try {
    return encoder.encode(privateJsonStringify(
      {
        expected_previous_event_id: Number.MAX_SAFE_INTEGER,
        events: [event],
      },
      null,
      undefined,
      MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
    )).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

const DEFAULT_MAX_CONVERSATION_RUN_BATCH_BYTES = 512 * 1024;

function getConversationRunEventJsonByteLength(event: unknown): number {
  return privateByteLength(encodePrivateText(privateJsonStringify(
    event,
    null,
    undefined,
    MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
  )));
}

/** Build ordered byte-bounded batches for normalized durable events. */
export function buildConversationRunEventBatches<T>(input: {
  events: T[];
  maxEventsPerBatch: number;
  maxBatchPayloadBytes?: number;
}): T[][] {
  const maxBatchPayloadBytes = input.maxBatchPayloadBytes ??
    DEFAULT_MAX_CONVERSATION_RUN_BATCH_BYTES;
  const batches: T[][] = [];
  let currentBatch: T[] = [];
  let currentBatchBytes = 0;

  for (const event of input.events) {
    const eventBytes = getConversationRunEventJsonByteLength(event);

    if (
      currentBatch.length > 0 &&
      (currentBatch.length >= input.maxEventsPerBatch ||
        currentBatchBytes + eventBytes > maxBatchPayloadBytes)
    ) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchBytes = 0;
    }

    currentBatch.push(event);
    currentBatchBytes += eventBytes;
  }

  if (currentBatch.length > 0) {
    batches.push(currentBatch);
  }

  return batches;
}
