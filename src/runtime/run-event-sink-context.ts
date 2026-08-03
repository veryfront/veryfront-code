import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentRunEventSink } from "./model-call-context.ts";

const runEventSinkStorage = new AsyncLocalStorage<AgentRunEventSink>();

/** Return the run event sink scoped to the current execution, if configured. */
export function getActiveRunEventSink(): AgentRunEventSink | undefined {
  return runEventSinkStorage.getStore();
}

/** Scope an operation to a run event sink. */
export function runWithRunEventSink<T>(sink: AgentRunEventSink, operation: () => T): T {
  return runEventSinkStorage.run(sink, operation);
}

/** Keep a sink active while a lazy async iterable is consumed. */
export function scopeAsyncIterableWithRunEventSink<T>(
  sink: AgentRunEventSink,
  source: AsyncIterable<T>,
): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const iterator = runWithRunEventSink(sink, () => source[Symbol.asyncIterator]());
      return {
        next: (value?: unknown) => runWithRunEventSink(sink, () => iterator.next(value as never)),
        return: iterator.return
          ? (value?: unknown) =>
            runWithRunEventSink(
              sink,
              () => iterator.return?.(value as never) as Promise<IteratorResult<T>>,
            )
          : undefined,
        throw: iterator.throw
          ? (error?: unknown) =>
            runWithRunEventSink(
              sink,
              () => iterator.throw?.(error) as Promise<IteratorResult<T>>,
            )
          : undefined,
      };
    },
  };
}
