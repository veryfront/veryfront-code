import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type { ConversationRunMirrorSnapshot } from "../conversation/run-mirror.ts";
import {
  getPrivateRunEventAppendRequestByteLength,
  MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
} from "../conversation/run-event-limits.ts";
import { DurableRunEventPersistenceError } from "../conversation/private-run-event.ts";
import type { AgentRunEventSink } from "../../runtime/model-call-context.ts";
import { agentLogger } from "#veryfront/utils";

const DEFAULT_DURABLE_RUN_EVENT_PERSISTENCE_TIMEOUT_MS = 30_000;
const persistenceTails = new WeakMap<ConversationRunChunkMirror, Promise<void>>();

export { DurableRunEventPersistenceError } from "../conversation/private-run-event.ts";

function assertEnabled(snapshot: ConversationRunMirrorSnapshot): void {
  if (snapshot.disabled) {
    throw new DurableRunEventPersistenceError("Required durable run event mirror is disabled");
  }
}

function isDrained(snapshot: ConversationRunMirrorSnapshot): boolean {
  return !snapshot.hasRetryTimer && !snapshot.inFlight && snapshot.pendingEventCount === 0 &&
    !snapshot.hasFlushTimer;
}

function assertDrained(snapshot: ConversationRunMirrorSnapshot): void {
  assertEnabled(snapshot);
  if (!isDrained(snapshot)) {
    throw new DurableRunEventPersistenceError("Required durable run event was not flushed");
  }
}

async function serializePersistence(
  mirror: ConversationRunChunkMirror,
  operation: () => Promise<void>,
): Promise<void> {
  const previous = persistenceTails.get(mirror) ?? Promise.resolve();
  const current = previous.then(operation, operation);
  persistenceTails.set(mirror, current);
  try {
    await current;
  } finally {
    if (persistenceTails.get(mirror) === current) {
      persistenceTails.delete(mirror);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const TRUNCATED_TEXT_SUFFIX = "… [truncated]";
const OMITTED_MESSAGE_NOTICE = "[messages omitted: model call context exceeded the payload limit]";

const utf8Encoder = new TextEncoder();

function getUtf8ByteLength(value: string): number {
  return utf8Encoder.encode(value).byteLength;
}

/** Clamp to a UTF-8 byte budget without splitting a surrogate pair. */
function truncateTextToBytes(value: string, maxBytes: number): string {
  if (getUtf8ByteLength(value) <= maxBytes) return value;
  const budget = Math.max(0, maxBytes - getUtf8ByteLength(TRUNCATED_TEXT_SUFFIX));
  let low = 0;
  let high = value.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (getUtf8ByteLength(value.slice(0, mid)) <= budget) low = mid;
    else high = mid - 1;
  }
  // Never cut between a surrogate pair; step back onto a whole code point.
  const end = low > 0 && /[\uD800-\uDBFF]/.test(value[low - 1] ?? "") ? low - 1 : low;
  return `${value.slice(0, end)}${TRUNCATED_TEXT_SUFFIX}`;
}

function truncateMessageTextParts(message: unknown, maxTextBytes: number): unknown {
  if (!isRecord(message) || !Array.isArray(message.content)) return message;
  return {
    ...message,
    content: message.content.map((part) =>
      isRecord(part) && typeof part.text === "string"
        ? { ...part, text: truncateTextToBytes(part.text, maxTextBytes) }
        : part
    ),
  };
}

/**
 * Fit an oversized model call context inside the append budget.
 *
 * Private run events are exempt from `normalizeConversationRunEvent`'s size clamp,
 * so nothing upstream shrinks them and the raw event is what gets sent. Rather
 * than lose the run's remaining events by disposing the mirror, the context is
 * reduced to fit and stamped so it never reads as a faithful record: `truncated`
 * says the content was reduced, and the original size and omitted-message count
 * say by how much. Newest messages are kept — they are the ones a reader of a
 * failed run is looking for.
 */
function truncatePrivateRunEventToLimit(event: Record<string, unknown>): Record<string, unknown> {
  const originalByteLength = getPrivateRunEventAppendRequestByteLength(event);
  const messages = Array.isArray(event.messages) ? event.messages : [];

  const stamp = (
    next: Record<string, unknown>,
    omittedMessageCount: number,
  ): Record<string, unknown> => ({
    ...next,
    truncated: true,
    originalByteLength,
    omittedMessageCount,
  });

  // Clamp text progressively; each pass halves the per-part budget.
  for (
    let maxTextBytes = 64 * 1024;
    maxTextBytes >= 256;
    maxTextBytes = Math.floor(maxTextBytes / 4)
  ) {
    const candidate = stamp(
      {
        ...event,
        messages: messages.map((message) => truncateMessageTextParts(message, maxTextBytes)),
      },
      0,
    );
    if (
      getPrivateRunEventAppendRequestByteLength(candidate) <=
        MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES
    ) {
      return candidate;
    }
  }

  // Still over: drop the oldest messages, keeping the most recent ones.
  const clamped = messages.map((message) => truncateMessageTextParts(message, 256));
  for (let keep = Math.min(clamped.length, 8); keep >= 1; keep--) {
    const candidate = stamp(
      { ...event, messages: clamped.slice(-keep) },
      clamped.length - keep,
    );
    if (
      getPrivateRunEventAppendRequestByteLength(candidate) <=
        MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES
    ) {
      return candidate;
    }
  }

  // Guaranteed-fit fallback: keep the envelope, drop the content entirely.
  return stamp(
    {
      ...event,
      messages: [{ role: "system", content: [{ type: "text", text: OMITTED_MESSAGE_NOTICE }] }],
      ...(event.tools === undefined ? {} : { tools: [] }),
    },
    clamped.length,
  );
}

function formatMebibytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * What the sink decided to write, and whether the model call may proceed.
 *
 * An oversized context is reduced and persisted so an operator can still see
 * what the run tried to send, but `oversize` is set so the caller refuses the
 * dispatch. Recording a partial context must never be mistaken for having
 * recorded the real one.
 */
type ResolvedRunEvent = {
  event: unknown;
  oversize?: { originalByteLength: number; omittedMessageCount: number };
};

function resolvePersistableEvent(event: unknown): ResolvedRunEvent {
  const requestByteLength = getPrivateRunEventAppendRequestByteLength(event);
  if (!Number.isFinite(requestByteLength)) {
    throw new DurableRunEventPersistenceError("Run event is not serializable");
  }
  if (requestByteLength <= MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES) {
    return { event };
  }
  if (!isRecord(event)) {
    throw new DurableRunEventPersistenceError(
      "Run event append request exceeds the supported payload size",
    );
  }

  const truncated = truncatePrivateRunEventToLimit(event);
  return {
    event: truncated,
    oversize: {
      originalByteLength: requestByteLength,
      omittedMessageCount: Number(truncated.omittedMessageCount ?? 0),
    },
  };
}

function buildOversizeError(
  oversize: { originalByteLength: number; omittedMessageCount: number },
): DurableRunEventPersistenceError {
  return new DurableRunEventPersistenceError(
    `Run event append request exceeds the supported payload size: model call context was ` +
      `${formatMebibytes(oversize.originalByteLength)}, limit is ` +
      `${formatMebibytes(MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES)}. ` +
      `A truncated record was persisted for audit and the model call was not dispatched. ` +
      `Reduce conversation history or large tool results before retrying.`,
  );
}

function getAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

async function withPersistenceDeadline<T>(input: {
  operation: (abortSignal: AbortSignal) => Promise<T>;
  abortSignal?: AbortSignal;
  timeoutMs: number;
}): Promise<T> {
  if (input.abortSignal?.aborted) throw getAbortReason(input.abortSignal);
  const controller = new AbortController();
  const timeoutError = new DurableRunEventPersistenceError(
    "Durable run event persistence timed out",
  );
  const timeout = setTimeout(() => controller.abort(timeoutError), input.timeoutMs);
  const onCallerAbort = () => controller.abort(getAbortReason(input.abortSignal!));
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

/** Create the internal fail-closed sink used by hosted durable runs. */
export function createDurableRunEventSink(input: {
  mirror: ConversationRunChunkMirror;
  abortSignal?: AbortSignal;
  timeoutMs?: number;
}): AgentRunEventSink {
  return async (event) => {
    let oversize: ResolvedRunEvent["oversize"];
    try {
      assertEnabled(input.mirror.getSnapshot());
      const resolved = resolvePersistableEvent(event);
      oversize = resolved.oversize;
      const persistableEvent = resolved.event as typeof event;
      await serializePersistence(input.mirror, async () => {
        await withPersistenceDeadline({
          abortSignal: input.abortSignal,
          timeoutMs: input.timeoutMs ?? DEFAULT_DURABLE_RUN_EVENT_PERSISTENCE_TIMEOUT_MS,
          operation: async (abortSignal) => {
            const snapshot = input.mirror.getSnapshot();
            assertEnabled(snapshot);
            if (!isDrained(snapshot)) {
              assertDrained(
                await input.mirror.flush({
                  abortSignal,
                  throwOnTimeoutRetry: true,
                }),
              );
            }
            await input.mirror.appendEvents([{ ...persistableEvent }]);
            abortSignal.throwIfAborted();
            assertDrained(
              await input.mirror.flush({
                abortSignal,
                throwOnTimeoutRetry: true,
              }),
            );
            assertDrained(input.mirror.getSnapshot());
          },
        });
      });
    } catch (error) {
      input.mirror.dispose();
      throw error;
    }

    if (oversize) {
      // The gate, deliberately after a successful write: the truncated record is
      // durable so an operator can see what the run tried to send, and the mirror
      // stays alive so the run's later events — including its failure — still
      // persist. Only the model dispatch is refused.
      agentLogger.warn(
        "[durableRunEventSink] Model call context exceeded the append limit; dispatch refused",
        {
          originalByteLength: oversize.originalByteLength,
          limitByteLength: MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
          omittedMessageCount: oversize.omittedMessageCount,
        },
      );
      throw buildOversizeError(oversize);
    }
  };
}
