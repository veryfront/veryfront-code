import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type { ConversationRunEvent } from "../conversation/run-events.ts";
import type { ConversationRunMirrorSnapshot } from "../conversation/run-mirror.ts";
import type { ModelCallContext, ModelCallRecorder } from "../../runtime/model-call-context.ts";
import { runWithModelCallRecorder } from "../../runtime/model-call-recorder-context.ts";
import {
  recordModelCallContextBarrierOutcome,
  recordModelCallContextMeasurements,
  recordModelCallContextWriterOutcome,
} from "../../observability/metrics/index.ts";
import type {
  ModelCallContextBarrierOutcome,
  ModelCallContextWriterOutcome,
} from "../../observability/metrics/types.ts";
import { isVeryfrontError } from "#veryfront/errors";

/** Private durable event type used to persist exact model-call inputs. */
export const AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE = "AGENT_RUN_MODEL_CALL_CONTEXT";
/** Maximum serialized model-call context size. */
export const MAX_MODEL_CALL_CONTEXT_BYTES = 4 * 1024 * 1024;
/** Maximum number of durable parts for one model-call context. */
export const MAX_MODEL_CALL_CONTEXT_PARTS = 32;
/** Maximum full-event size for an unchunked model-call context. */
export const MAX_SINGLE_MODEL_CALL_CONTEXT_EVENT_BYTES = 2 * 1024 * 1024;
/** Exclusive maximum full-event size for each chunked model-call context part. */
export const MAX_CHUNKED_MODEL_CALL_CONTEXT_EVENT_BYTES = 240 * 1024;
/** Maximum time a required model-call context append may block dispatch. */
export const DEFAULT_MODEL_CALL_CONTEXT_PERSISTENCE_TIMEOUT_MS = 30_000;

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

export type {
  ModelCallContextBarrierOutcome,
  ModelCallContextWriterOutcome,
} from "../../observability/metrics/types.ts";

/** Content-free, fail-open projection of required persistence telemetry. */
export interface ModelCallContextMetricsSink {
  writerOutcome(outcome: ModelCallContextWriterOutcome): void;
  barrierOutcome(outcome: ModelCallContextBarrierOutcome): void;
  measurements(input: {
    logicalByteLength: number;
    partCount: number;
    appendRequestCount: number;
    durationMs: number;
  }): void;
}

const defaultMetricsSink: ModelCallContextMetricsSink = {
  writerOutcome: recordModelCallContextWriterOutcome,
  barrierOutcome: recordModelCallContextBarrierOutcome,
  measurements: recordModelCallContextMeasurements,
};

function emitMetric(operation: () => void): void {
  try {
    operation();
  } catch {
    // Metrics must never alter required persistence or provider dispatch.
  }
}

/** Keep a recorder active for every operation that consumes a lazy hosted stream. */
export function scopeAsyncIterableWithModelCallRecorder<T>(
  recorder: ModelCallRecorder,
  source: AsyncIterable<T>,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = runWithModelCallRecorder(recorder, () => source[Symbol.asyncIterator]());
      return {
        next: (value?: unknown) =>
          runWithModelCallRecorder(recorder, () => iterator.next(value as never)),
        return: iterator.return
          ? (value?: unknown) =>
            runWithModelCallRecorder(
              recorder,
              () => iterator.return?.(value as never) as Promise<IteratorResult<T>>,
            )
          : undefined,
        throw: iterator.throw
          ? (error?: unknown) =>
            runWithModelCallRecorder(
              recorder,
              () => iterator.throw?.(error) as Promise<IteratorResult<T>>,
            )
          : undefined,
      };
    },
  };
}

function jsonByteLength(value: unknown): number {
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
  const byteLength = jsonByteLength(event);
  const withinLimit = event.partCount === 1
    ? byteLength <= MAX_SINGLE_MODEL_CALL_CONTEXT_EVENT_BYTES
    : byteLength < MAX_CHUNKED_MODEL_CALL_CONTEXT_EVENT_BYTES;
  if (!withinLimit) {
    throw new ModelCallContextPersistenceError("Model-call context event exceeds its size limit");
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function safeSliceEnd(value: string, start: number, candidateEnd: number): number {
  let end = candidateEnd;
  if (
    end > start && end < value.length &&
    /[\uD800-\uDBFF]/.test(value[end - 1] ?? "") &&
    /[\uDC00-\uDFFF]/.test(value[end] ?? "")
  ) {
    end -= 1;
  }
  return end;
}

function buildEvent(input: {
  contextId: string;
  partIndex: number;
  partCount: number;
  totalByteLength: number;
  sha256: string;
  serializedSegment: string;
}): ModelCallContextRunEvent {
  return { type: AGENT_RUN_MODEL_CALL_CONTEXT_EVENT_TYPE, ...input };
}

function splitSerializedContext(input: {
  serialized: string;
  contextId: string;
  totalByteLength: number;
  sha256: string;
  chunkEventByteLimit: number;
}): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < input.serialized.length) {
    let low = start + 1;
    let high = input.serialized.length;
    let best = start;
    while (low <= high) {
      const midpoint = Math.floor((low + high) / 2);
      const candidateEnd = safeSliceEnd(input.serialized, start, midpoint);
      if (candidateEnd <= start) {
        low = midpoint + 1;
        continue;
      }
      const candidate = buildEvent({
        contextId: input.contextId,
        partIndex: MAX_MODEL_CALL_CONTEXT_PARTS - 1,
        partCount: MAX_MODEL_CALL_CONTEXT_PARTS,
        totalByteLength: input.totalByteLength,
        sha256: input.sha256,
        serializedSegment: input.serialized.slice(start, candidateEnd),
      });
      if (jsonByteLength(candidate) < input.chunkEventByteLimit) {
        best = candidateEnd;
        low = midpoint + 1;
      } else {
        high = midpoint - 1;
      }
    }
    if (best === start) {
      throw new ModelCallContextPersistenceError("Unable to split model-call context safely");
    }
    parts.push(input.serialized.slice(start, best));
    if (parts.length > MAX_MODEL_CALL_CONTEXT_PARTS) {
      throw new ModelCallContextPersistenceError("Model-call context requires too many parts");
    }
    start = best;
  }
  return parts;
}

/** Serialize, hash, and losslessly envelope one exact model-call context. */
export async function createModelCallContextRunEvents(
  context: ModelCallContext,
  internalLimits: {
    singleEventByteLimit: number;
    chunkEventByteLimit: number;
  } = {
    singleEventByteLimit: MAX_SINGLE_MODEL_CALL_CONTEXT_EVENT_BYTES,
    chunkEventByteLimit: MAX_CHUNKED_MODEL_CALL_CONTEXT_EVENT_BYTES,
  },
): Promise<ModelCallContextRunEvent[]> {
  const serialized = JSON.stringify(context);
  const totalByteLength = encoder.encode(serialized).byteLength;
  if (totalByteLength < 1 || totalByteLength > MAX_MODEL_CALL_CONTEXT_BYTES) {
    throw new ModelCallContextPersistenceError("Model-call context exceeds the 4 MiB limit");
  }
  const contextId = crypto.randomUUID();
  const digest = await sha256(serialized);
  const single = buildEvent({
    contextId,
    partIndex: 0,
    partCount: 1,
    totalByteLength,
    sha256: digest,
    serializedSegment: serialized,
  });
  if (jsonByteLength(single) <= internalLimits.singleEventByteLimit) {
    return [single];
  }

  const segments = splitSerializedContext({
    serialized,
    contextId,
    totalByteLength,
    sha256: digest,
    chunkEventByteLimit: internalLimits.chunkEventByteLimit,
  });
  const events = segments.map((serializedSegment, partIndex) =>
    buildEvent({
      contextId,
      partIndex,
      partCount: segments.length,
      totalByteLength,
      sha256: digest,
      serializedSegment,
    })
  );
  for (const event of events) {
    assertValidModelCallContextRunEvent(event);
  }
  return events;
}

function getNonQuiescentOutcome(
  snapshot: ConversationRunMirrorSnapshot,
  phase: "before" | "after",
): ModelCallContextWriterOutcome | undefined {
  if (snapshot.disabled) {
    if (snapshot.disableReason === "cursor_mismatch_ambiguous") {
      return "ambiguous_durable_replay";
    }
    return phase === "before" ? "disabled" : "stopped";
  }
  if (snapshot.hasRetryTimer) return "retry_scheduled";
  if (snapshot.inFlight) return "successor_in_flight";
  if (snapshot.pendingEventCount !== 0 || snapshot.hasFlushTimer) {
    return "pending_after_flush";
  }
  return undefined;
}

function createWriterOutcomeError(
  message: string,
  writerOutcome: ModelCallContextWriterOutcome,
): ModelCallContextPersistenceError {
  return Object.assign(new ModelCallContextPersistenceError(message), { writerOutcome });
}

function assertQuiescent(
  snapshot: ConversationRunMirrorSnapshot,
  phase: "before" | "after",
): void {
  const outcome = getNonQuiescentOutcome(snapshot, phase);
  if (outcome) {
    throw createWriterOutcomeError(
      "Required model-call context was not durably flushed",
      outcome,
    );
  }
}

function assertEnabled(snapshot: ConversationRunMirrorSnapshot): void {
  if (!snapshot.disabled) return;
  throw createWriterOutcomeError(
    "Required model-call context mirror is disabled",
    snapshot.disableReason === "cursor_mismatch_ambiguous"
      ? "ambiguous_durable_replay"
      : "disabled",
  );
}

async function withRequiredPersistenceDeadline<T>(input: {
  operation: (abortSignal: AbortSignal) => Promise<T>;
  abortSignal?: AbortSignal;
  timeoutMs: number;
}): Promise<T> {
  if (input.abortSignal?.aborted) {
    throw input.abortSignal.reason ?? new DOMException("This operation was aborted", "AbortError");
  }
  const controller = new AbortController();
  const timeoutError = new ModelCallContextPersistenceError(
    "Model-call context persistence timed out",
  );
  const timeout = setTimeout(() => controller.abort(timeoutError), input.timeoutMs);
  const onCallerAbort = () => {
    controller.abort(
      input.abortSignal?.reason ?? new DOMException("This operation was aborted", "AbortError"),
    );
  };
  input.abortSignal?.addEventListener("abort", onCallerAbort, { once: true });
  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
      once: true,
    });
  });
  try {
    return await Promise.race([input.operation(controller.signal), aborted]);
  } finally {
    clearTimeout(timeout);
    input.abortSignal?.removeEventListener("abort", onCallerAbort);
  }
}

/** Create the fail-closed recorder used by hosted durable root and child runs. */
export function createModelCallContextRunEventRecorder(input: {
  mirror: ConversationRunChunkMirror;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
  metrics?: ModelCallContextMetricsSink;
}): ModelCallRecorder {
  return async (context) => {
    const metrics = input.metrics ?? defaultMetricsSink;
    const startedAt = performance.now();
    const before = input.mirror.getSnapshot();
    const appendRequestsBefore = before.appendRequestCount ?? 0;
    let logicalByteLength = 0;
    let partCount = 0;
    let writerOutcome: ModelCallContextWriterOutcome | undefined;
    let barrierOutcome: ModelCallContextBarrierOutcome | undefined;
    try {
      assertEnabled(before);
      await withRequiredPersistenceDeadline({
        abortSignal: input.abortSignal,
        timeoutMs: input.timeoutMs ?? DEFAULT_MODEL_CALL_CONTEXT_PERSISTENCE_TIMEOUT_MS,
        operation: async (abortSignal) => {
          const events = await createModelCallContextRunEvents(context);
          abortSignal.throwIfAborted();
          logicalByteLength = events[0]?.totalByteLength ?? 0;
          partCount = events.length;
          await input.mirror.appendEvents(events);
          abortSignal.throwIfAborted();
          const resolvedSnapshot = await input.mirror.flush({ abortSignal });
          assertQuiescent(resolvedSnapshot, "after");
          assertQuiescent(input.mirror.getSnapshot(), "after");
        },
      });
      writerOutcome = "recorded";
    } catch (error) {
      if (input.abortSignal?.aborted || error instanceof DOMException) {
        barrierOutcome = "aborted";
      } else if (
        (error instanceof ModelCallContextPersistenceError &&
          error.message.includes("timed out")) ||
        (isVeryfrontError(error) && error.slug === "timeout-error")
      ) {
        barrierOutcome = "timeout";
      } else {
        writerOutcome =
          (error instanceof ModelCallContextPersistenceError ? error.writerOutcome : undefined) ??
            ((input.mirror.getSnapshot().appendRequestCount ?? 0) - appendRequestsBefore > 1
              ? "partial_append_failed"
              : "append_failed");
      }
      input.mirror.dispose();
      throw error;
    } finally {
      const appendRequestCount = Math.max(
        0,
        (input.mirror.getSnapshot().appendRequestCount ?? 0) - appendRequestsBefore,
      );
      const finalWriterOutcome = writerOutcome;
      const finalBarrierOutcome = barrierOutcome;
      if (finalWriterOutcome) {
        emitMetric(() => metrics.writerOutcome(finalWriterOutcome));
      }
      if (finalBarrierOutcome) {
        emitMetric(() => metrics.barrierOutcome(finalBarrierOutcome));
      }
      emitMetric(() =>
        metrics.measurements({
          logicalByteLength,
          partCount,
          appendRequestCount,
          durationMs: performance.now() - startedAt,
        })
      );
    }
  };
}
