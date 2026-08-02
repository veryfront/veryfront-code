import type { ConversationRunEvent } from "./run-events.ts";
import { MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES } from "./run-event-limits.ts";
import type { ModelCallContextWriterOutcome } from "../../observability/metrics/types.ts";

/** Private durable event type used to persist exact model-call inputs. */
export const AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE = "AGENT_RUN_MODEL_CALL_CONTEXT";
/** Maximum serialized model-call context size. */
export const MAX_MODEL_CALL_CONTEXT_BYTES = 4 * 1024 * 1024;
/** Maximum number of durable parts for one model-call context. */
export const MAX_MODEL_CALL_CONTEXT_PARTS = 32;
/**
 * Maximum full-event size for an unchunked model-call context.
 *
 * Model-call context events bypass normalization's summarizer (they are lossless
 * by contract), so anything above the append budget would be rejected by the API
 * and fail the run closed before dispatch. Tie the unchunked ceiling to the same
 * budget so oversized contexts are always chunked instead.
 */
export const MAX_SINGLE_MODEL_CALL_CONTEXT_EVENT_BYTES = MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES;
/** Exclusive maximum full-event size for each chunked model-call context part. */
export const MAX_CHUNKED_MODEL_CALL_CONTEXT_EVENT_BYTES = MAX_CONVERSATION_RUN_EVENT_PAYLOAD_BYTES;

const encoder = new TextEncoder();
const MODEL_CALL_CONTEXT_RUN_EVENT_KEYS = new Set([
  "type",
  "contextId",
  "partIndex",
  "partCount",
  "totalByteLength",
  "sha256",
  "serializedSegment",
]);

/** Durable lossless envelope for a model-call context segment. */
export interface ModelCallContextRunEvent extends ConversationRunEvent {
  type: typeof AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE;
  contextId: string;
  partIndex: number;
  partCount: number;
  totalByteLength: number;
  sha256: string;
  serializedSegment: string;
}

/** Failure to durably persist a required model-call context before dispatch. */
export class ModelCallContextPersistenceError extends Error {
  override name = "ModelCallContextPersistenceError";
  declare readonly writerOutcome?: ModelCallContextWriterOutcome;
}

/** Return the serialized byte length of a durable run event envelope. */
export function modelCallContextEventByteLength(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    .test(value);
}

/** Return whether a value is a model-call context durable event. */
export function isModelCallContextRunEvent(
  value: unknown,
): value is ModelCallContextRunEvent {
  return Boolean(
    value && typeof value === "object" &&
      (value as Record<string, unknown>).type === AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE,
  );
}

/** Validate one model-call context durable envelope without rewriting it. */
export function assertValidModelCallContextRunEvent(
  value: unknown,
): asserts value is ModelCallContextRunEvent {
  if (!isModelCallContextRunEvent(value)) {
    throw new ModelCallContextPersistenceError("Invalid model-call context event type");
  }
  const event = value as ModelCallContextRunEvent;
  const eventKeys = Object.keys(event);
  const valid = eventKeys.every((key) => MODEL_CALL_CONTEXT_RUN_EVENT_KEYS.has(key)) &&
    eventKeys.length === MODEL_CALL_CONTEXT_RUN_EVENT_KEYS.size && isUuid(event.contextId) &&
    Number.isInteger(event.partIndex) && event.partIndex >= 0 &&
    event.partIndex < MAX_MODEL_CALL_CONTEXT_PARTS &&
    Number.isInteger(event.partCount) && event.partCount >= 1 &&
    event.partCount <= MAX_MODEL_CALL_CONTEXT_PARTS &&
    event.partIndex < event.partCount &&
    Number.isInteger(event.totalByteLength) && event.totalByteLength >= 1 &&
    event.totalByteLength <= MAX_MODEL_CALL_CONTEXT_BYTES &&
    /^[0-9a-f]{64}$/.test(event.sha256) &&
    typeof event.serializedSegment === "string" && event.serializedSegment.length > 0;
  if (!valid) {
    throw new ModelCallContextPersistenceError("Invalid model-call context event envelope");
  }
  const byteLength = modelCallContextEventByteLength(event);
  const withinLimit = event.partCount === 1
    ? byteLength <= MAX_SINGLE_MODEL_CALL_CONTEXT_EVENT_BYTES
    : byteLength < MAX_CHUNKED_MODEL_CALL_CONTEXT_EVENT_BYTES;
  if (!withinLimit) {
    throw new ModelCallContextPersistenceError("Model-call context event exceeds its size limit");
  }
}
