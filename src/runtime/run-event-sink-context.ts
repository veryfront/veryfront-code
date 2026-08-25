import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentRunEventSink } from "./model-call-context.ts";

const runEventSinkStorage = new AsyncLocalStorage<AgentRunEventSink>();
const mandatoryRunEventSinkStorage = new AsyncLocalStorage<AgentRunEventSink>();

/** Return the run event sink scoped to the current execution, if configured. */
export function getActiveRunEventSink(): AgentRunEventSink | undefined {
  return runEventSinkStorage.getStore() ?? mandatoryRunEventSinkStorage.getStore();
}

/** Return the independently scoped mandatory and public sink lanes. */
export function getActiveRunEventSinks(): {
  mandatory: AgentRunEventSink | undefined;
  public: AgentRunEventSink | undefined;
} {
  return {
    mandatory: mandatoryRunEventSinkStorage.getStore(),
    public: runEventSinkStorage.getStore(),
  };
}

/** Scope an operation to a run event sink. */
export function runWithRunEventSink<T>(sink: AgentRunEventSink, operation: () => T): T {
  return runEventSinkStorage.run(sink, operation);
}

/** Scope an operation to a mandatory run event sink without displacing public observers. */
export function runWithMandatoryRunEventSink<T>(
  sink: AgentRunEventSink,
  operation: () => T,
): T {
  return mandatoryRunEventSinkStorage.run(sink, operation);
}

function scopeAsyncIterableWithSinkStorage<T>(
  storage: AsyncLocalStorage<AgentRunEventSink>,
  sink: AgentRunEventSink,
  source: AsyncIterable<T>,
): AsyncIterable<T> {
  const run = <TResult>(operation: () => TResult): TResult => storage.run(sink, operation);
  return {
    [Symbol.asyncIterator]() {
      const iterator = run(() => source[Symbol.asyncIterator]());
      return {
        next: (value?: unknown) => run(() => iterator.next(value as never)),
        return: iterator.return
          ? (value?: unknown) =>
            run(() => iterator.return?.(value as never) as Promise<IteratorResult<T>>)
          : undefined,
        throw: iterator.throw
          ? (error?: unknown) => run(() => iterator.throw?.(error) as Promise<IteratorResult<T>>)
          : undefined,
      };
    },
  };
}

/** Keep a sink active while a lazy async iterable is consumed. */
export function scopeAsyncIterableWithRunEventSink<T>(
  sink: AgentRunEventSink,
  source: AsyncIterable<T>,
): AsyncIterable<T> {
  return scopeAsyncIterableWithSinkStorage(runEventSinkStorage, sink, source);
}

/** Keep a mandatory sink active while a lazy async iterable is consumed. */
export function scopeAsyncIterableWithMandatoryRunEventSink<T>(
  sink: AgentRunEventSink,
  source: AsyncIterable<T>,
): AsyncIterable<T> {
  return scopeAsyncIterableWithSinkStorage(mandatoryRunEventSinkStorage, sink, source);
}
