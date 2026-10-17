import type { ChatUiMessageChunk } from "#veryfront/chat/protocol.ts";
import type { AgentRunEventSink } from "#veryfront/runtime/model-call-context.ts";
import {
  getToolResultSequence,
  getToolResultSequenceSchema,
  isSyntheticToolResultRecovery,
  type ToolResultSequence,
} from "#veryfront/runtime/tool-result-sequence.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { DurableRunEventPersistenceError } from "../conversation/private-run-event.ts";

const fences = createPrivateWeakStore<AgentRunEventSink, ManagedToolResultFence>();
const IntrinsicPromise = Promise;
const now = Date.now;
const schedule = setTimeout;
const unschedule = clearTimeout;
const MAX_PENDING_RESULT_GAP = 1000;
const MAX_WAIT_MS = 30_000;

export interface ManagedToolResultFence {
  /** Created by the host before starting the authenticated executor stream. */
  beginSession(): string;
  /** Validate before entering the shared persistence queue. */
  waitBeforeContext(
    sequence: ToolResultSequence | undefined,
    signal: AbortSignal,
    deadline: number,
  ): Promise<void>;
  /** Call after the exact result chunk has been durably mirrored and flushed. */
  resultPersisted(chunk: ChatUiMessageChunk): void;
  fail(error: unknown): void;
}

export function bindManagedToolResultFence(
  sink: AgentRunEventSink,
  fence: ManagedToolResultFence,
): void {
  fences.set(sink, fence);
}

/** Recover the broker-owned fence only from the exact bound run-event sink. */
export function getManagedToolResultFence(
  sink: AgentRunEventSink,
): ManagedToolResultFence | undefined {
  return fences.get(sink);
}

/** One authenticated executor invocation; positions never span or identify historic messages. */
export function createManagedToolResultFence(): ManagedToolResultFence {
  let sessionId: string | undefined;
  let acknowledged = 0;
  let failed = false;
  let failure: unknown;
  const pending = createPrivateSet<{
    ordinal: number;
    resolve(): void;
    reject(error: unknown): void;
  }>();
  const bindSession = (sequence: ToolResultSequence) => {
    const parsed = getToolResultSequenceSchema().parse(sequence);
    if (!sessionId || parsed.sessionId !== sessionId) {
      throw new DurableRunEventPersistenceError(
        "Managed tool result belongs to another executor stream",
      );
    }
    return parsed;
  };
  return {
    beginSession() {
      if (sessionId || failed) {
        throw new DurableRunEventPersistenceError("Managed result session is no longer available");
      }
      sessionId = crypto.randomUUID();
      return sessionId;
    },
    async waitBeforeContext(sequence, signal, deadline) {
      if (failed) throw failure;
      signal.throwIfAborted();
      if (now() >= deadline) {
        throw new DurableRunEventPersistenceError(
          "Managed tool result persistence deadline exceeded",
        );
      }
      if (!sequence) {
        throw new DurableRunEventPersistenceError("Managed model call lacks a result position");
      }
      const target = bindSession(sequence).ordinal;
      if (target <= acknowledged) return;
      if (target - acknowledged > MAX_PENDING_RESULT_GAP) {
        throw new DurableRunEventPersistenceError("Managed model result position is too far ahead");
      }
      const waitMs = Math.min(MAX_WAIT_MS, deadline - now());
      if (waitMs <= 0) {
        throw new DurableRunEventPersistenceError(
          "Managed tool result persistence deadline exceeded",
        );
      }
      await new IntrinsicPromise<void>((resolve, reject) => {
        const waiter = {
          ordinal: target,
          resolve: () => settle(resolve),
          reject: (error: unknown) => settle(() => reject(error)),
        };
        const settle = (operation: () => void) => {
          unschedule(timeout);
          signal.removeEventListener("abort", onAbort);
          pending.delete(waiter);
          operation();
        };
        const onAbort = () => waiter.reject(signal.reason);
        const timeout = schedule(() =>
          waiter.reject(
            new DurableRunEventPersistenceError(
              "Managed tool result persistence deadline exceeded",
            ),
          ), waitMs);
        pending.add(waiter);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
        else if (failed) waiter.reject(failure);
        else if (target <= acknowledged) waiter.resolve();
      });
      if (failed) throw failure;
      signal.throwIfAborted();
    },
    resultPersisted(chunk) {
      if (failed) throw failure;
      if (
        chunk.type !== "tool-output-available" &&
        chunk.type !== "tool-output-error" &&
        chunk.type !== "tool-output-denied" &&
        chunk.type !== "tool-input-error"
      ) return;
      if (chunk.type === "tool-output-available" && chunk.preliminary === true) return;
      if (isSyntheticToolResultRecovery(chunk)) return;
      const sequence = getToolResultSequence(chunk);
      if (!sequence) {
        throw new DurableRunEventPersistenceError("Managed tool result lacks a producer position");
      }
      const ordinal = bindSession(sequence).ordinal;
      if (ordinal !== acknowledged + 1) {
        throw new DurableRunEventPersistenceError("Managed tool result position is out of order");
      }
      acknowledged = ordinal;
      for (const waiter of [...pending]) {
        if (waiter.ordinal <= acknowledged) waiter.resolve();
      }
    },
    fail(error) {
      if (!failed) {
        failed = true;
        failure = error;
      }
      for (const waiter of [...pending]) waiter.reject(failure);
    },
  };
}
