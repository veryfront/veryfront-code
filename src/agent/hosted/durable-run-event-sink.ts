import type { ConversationRunChunkMirror } from "../conversation/run-chunk-mirror.ts";
import type { ConversationRunMirrorSnapshot } from "../conversation/run-mirror.ts";
import {
  getPrivateRunEventAppendRequestByteLength,
  MAX_CONVERSATION_RUN_EVENT_APPEND_REQUEST_BYTES,
} from "../conversation/run-event-limits.ts";
import { DurableRunEventPersistenceError } from "../conversation/private-run-event.ts";
import type { RuntimeRunEventSink } from "../../runtime/run-event-sink-context.ts";

const DEFAULT_DURABLE_RUN_EVENT_PERSISTENCE_TIMEOUT_MS = 30_000;

export { DurableRunEventPersistenceError } from "../conversation/private-run-event.ts";

function assertWritable(snapshot: ConversationRunMirrorSnapshot): void {
  if (snapshot.disabled) {
    throw new DurableRunEventPersistenceError("Required durable run event mirror is disabled");
  }
  if (
    snapshot.hasRetryTimer || snapshot.inFlight || snapshot.pendingEventCount !== 0 ||
    snapshot.hasFlushTimer
  ) {
    throw new DurableRunEventPersistenceError("Required durable run event was not flushed");
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
}): RuntimeRunEventSink {
  return async (event) => {
    try {
      assertWritable(input.mirror.getSnapshot());
      assertSupportedEventSize(event);
      await withPersistenceDeadline({
        abortSignal: input.abortSignal,
        timeoutMs: input.timeoutMs ?? DEFAULT_DURABLE_RUN_EVENT_PERSISTENCE_TIMEOUT_MS,
        operation: async (abortSignal) => {
          await input.mirror.appendEvents([event]);
          abortSignal.throwIfAborted();
          assertWritable(
            await input.mirror.flush({
              abortSignal,
              throwOnTimeoutRetry: true,
            }),
          );
          assertWritable(input.mirror.getSnapshot());
        },
      });
    } catch (error) {
      input.mirror.dispose();
      throw error;
    }
  };
}
