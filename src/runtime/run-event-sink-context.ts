import { AsyncLocalStorage } from "node:async_hooks";

/** Internal event passed from runtime boundaries to the active run writer. */
export interface RuntimeRunEvent {
  type: string;
  [key: string]: unknown;
}

/** Internal sink for run events produced below the hosted execution layer. */
export type RuntimeRunEventSink = (event: RuntimeRunEvent) => void | Promise<void>;

const runEventSinkStorage = new AsyncLocalStorage<RuntimeRunEventSink>();

/** Return the run event sink scoped to the current execution, if configured. */
export function getActiveRunEventSink(): RuntimeRunEventSink | undefined {
  return runEventSinkStorage.getStore();
}

/** Scope an operation to an internal run event sink. */
export function runWithRunEventSink<T>(sink: RuntimeRunEventSink, operation: () => T): T {
  return runEventSinkStorage.run(sink, operation);
}

/** Keep a sink active while a lazy async iterable is consumed. */
export function scopeAsyncIterableWithRunEventSink<T>(
  sink: RuntimeRunEventSink,
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
