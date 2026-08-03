import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type { ConversationRunMirrorSnapshot } from "../conversation/run-mirror.ts";
import {
  getPrivateRunEventAppendRequestByteLength,
  MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
} from "../conversation/run-event-limits.ts";
import { DurableRunEventPersistenceError } from "../conversation/private-run-event.ts";
import type { AgentRunEventSink } from "../../runtime/model-call-context.ts";

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
  const current = previous.then(operation);
  persistenceTails.set(mirror, current);
  try {
    await current;
  } finally {
    if (persistenceTails.get(mirror) === current) {
      persistenceTails.delete(mirror);
    }
  }
}

function assertSupportedEventSize(event: unknown): void {
  const requestByteLength = getPrivateRunEventAppendRequestByteLength(event);
  if (!Number.isFinite(requestByteLength)) {
    throw new DurableRunEventPersistenceError("Run event is not serializable");
  }
  if (requestByteLength > MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES) {
    throw new DurableRunEventPersistenceError(
      "Run event append request exceeds the supported payload size",
    );
  }
}

async function withPersistenceDeadline<T>(input: {
  operation: (abortSignal: AbortSignal) => Promise<T>;
  abortSignal?: AbortSignal;
  timeoutMs: number;
}): Promise<T> {
  input.abortSignal?.throwIfAborted();
  const controller = new AbortController();
  const timeoutError = new DurableRunEventPersistenceError(
    "Durable run event persistence timed out",
  );
  const timeout = setTimeout(() => controller.abort(timeoutError), input.timeoutMs);
  const onCallerAbort = () => controller.abort(input.abortSignal?.reason);
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
    try {
      assertEnabled(input.mirror.getSnapshot());
      assertSupportedEventSize(event);
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
            await input.mirror.appendEvents([{ ...event }]);
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
  };
}
