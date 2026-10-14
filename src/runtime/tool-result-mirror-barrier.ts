import type { AgentRunEventSink, ModelCallMessage } from "./model-call-context.ts";
import type { ConversationRunChunkMirror } from "../agent/conversation/run-chunk-mirror.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import {
  IntrinsicPromise,
  primordialPromiseCatch,
  primordialPromiseThen,
} from "#veryfront/platform/compat/primordials/promise.ts";

type PendingResult = {
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: unknown) => void;
};
type MirrorState = {
  pending: Map<string, PendingResult>;
  disposed: boolean;
  rootController?: ReadableStreamDefaultController;
};
const mirrors = createPrivateWeakStore<ConversationRunChunkMirror, MirrorState>();
const sinks = createPrivateWeakStore<AgentRunEventSink, ConversationRunChunkMirror>();

/** @internal Track queued results only for hosted mirrors with private capture. */
export function enableToolResultMirrorBarrier(mirror: ConversationRunChunkMirror): void {
  mirrors.set(mirror, { pending: createPrivateMap(), disposed: false });
}

/** @internal Share one barrier state with a lifecycle wrapper around its mirror. */
export function aliasToolResultMirrorBarrier(
  mirror: ConversationRunChunkMirror,
  wrapper: ConversationRunChunkMirror,
): void {
  const state = mirrors.get(mirror);
  if (!state || state.disposed) {
    throw new TypeError("Tool result mirror barrier is unavailable for wrapper");
  }
  const existing = mirrors.get(wrapper);
  if (existing && existing !== state) {
    throw new TypeError("Tool result mirror wrapper already has another barrier");
  }
  mirrors.set(wrapper, state);
}

/** @internal Associate the private capture sink with its public result mirror. */
export function bindToolResultMirrorBarrier(
  sink: AgentRunEventSink,
  mirror: ConversationRunChunkMirror,
): void {
  sinks.set(sink, mirror);
}

/** @internal Bind only the first framework stream for an enabled hosted mirror. */
export function observeToolResultMirrorStream(
  sink: AgentRunEventSink | undefined,
  controller: ReadableStreamDefaultController,
  type: unknown,
): void {
  if (type !== "message-start") return;
  const mirror = sink ? sinks.get(sink) : undefined;
  const state = mirror ? mirrors.get(mirror) : undefined;
  if (state && !state.disposed && !state.rootController) {
    state.rootController = controller;
  }
}

/** @internal Register a result after its SSE chunk has been enqueued. */
export function registerQueuedToolResult(
  sink: AgentRunEventSink | undefined,
  controller: ReadableStreamDefaultController,
  id: string,
): void {
  const mirror = sink ? sinks.get(sink) : undefined;
  const state = mirror ? mirrors.get(mirror) : undefined;
  if (!state || state.disposed || state.rootController !== controller || state.pending.has(id)) {
    return;
  }
  let resolveResult: () => void = () => {};
  let rejectResult: (error: unknown) => void = () => {};
  const promise = new IntrinsicPromise<void>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  void primordialPromiseCatch(promise, () => {});
  state.pending.set(id, { promise, resolve: resolveResult, reject: rejectResult });
}

/** @internal Acknowledge only after the public result has entered the durable queue. */
export function acknowledgeMirroredToolResult(
  mirror: ConversationRunChunkMirror,
  id: string,
): void {
  const state = mirrors.get(mirror);
  const pending = state?.pending.get(id);
  if (!pending) return;
  state?.pending.delete(id);
  pending.resolve();
}

/** @internal Wait for fresh results in this context; historical results do not participate. */
export async function waitForQueuedToolResults(
  mirror: ConversationRunChunkMirror,
  messages: ModelCallMessage[],
  signal: AbortSignal,
): Promise<void> {
  const state = mirrors.get(mirror);
  if (!state) return;
  if (state.disposed) throw new Error("Tool result mirror disposed before context capture");
  for (const message of messages) {
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const pending = state.pending.get(part.toolCallId);
      if (!pending) continue;
      signal.throwIfAborted();
      let onAbort: () => void = () => {};
      try {
        await new IntrinsicPromise<void>((resolve, reject) => {
          onAbort = () => reject(signal.reason);
          signal.addEventListener("abort", onAbort, { once: true });
          void primordialPromiseThen(pending.promise, resolve, reject);
        });
      } finally {
        signal.removeEventListener("abort", onAbort);
      }
    }
  }
}

/** @internal Dispose fails closed rather than capturing an unmirrored result. */
export function disposeToolResultMirrorBarrier(mirror: ConversationRunChunkMirror): void {
  const state = mirrors.get(mirror);
  if (!state) return;
  state.disposed = true;
  for (const pending of state.pending.values()) {
    pending.reject(new Error("Tool result mirror disposed before its result was queued"));
  }
  state.pending.clear();
}
