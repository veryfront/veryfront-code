import type { StreamCancellationInput, StreamCancellationSource } from "./types.ts";

const CANCELLATION_PRECEDENCE = [
  "user",
  "parent",
  "runtime",
  "client_disconnected",
] as const;

export function createCancellationCoordinator(
  inputs: readonly StreamCancellationInput[],
  onCancel: (source: StreamCancellationSource) => void,
) {
  const controller = new AbortController();
  let source: StreamCancellationSource | null = null;
  const listeners: Array<() => void> = [];
  const select = (next: StreamCancellationSource, reason?: unknown) => {
    if (source !== null) return;
    source = next;
    onCancel(next);
    controller.abort(reason);
  };

  const preAborted = CANCELLATION_PRECEDENCE.find((candidate) =>
    inputs.some((input) => input.source === candidate && input.signal.aborted)
  );
  if (preAborted) {
    const input = inputs.find((entry) => entry.source === preAborted);
    select(preAborted, input?.signal.reason);
  } else {
    for (const input of inputs) {
      const listener = () => select(input.source, input.signal.reason);
      input.signal.addEventListener("abort", listener, { once: true });
      listeners.push(() => input.signal.removeEventListener("abort", listener));
    }
  }

  return {
    signal: controller.signal,
    get source() {
      return source;
    },
    stopConsumer() {
      select("consumer_stopped");
    },
    abortProvider(reason?: unknown) {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    dispose() {
      for (const remove of listeners) remove();
    },
  };
}
