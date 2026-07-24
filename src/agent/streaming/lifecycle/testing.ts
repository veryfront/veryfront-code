import type {
  MonotonicClock,
  StreamProviderAdapter,
  StreamProviderError,
  StreamSignal,
  StreamSnapshot,
} from "./types.ts";

export class ManualMonotonicClock implements MonotonicClock {
  #nowMs = 0;
  #waiters = new Set<{
    deadlineMs: number;
    finish: (value: "deadline" | "aborted") => void;
  }>();

  get pendingWaitCount(): number {
    return this.#waiters.size;
  }

  nowMs(): number {
    return this.#nowMs;
  }

  waitUntil(
    deadlineMs: number,
    signal?: AbortSignal,
  ): Promise<"deadline" | "aborted"> {
    if (signal?.aborted) return Promise.resolve("aborted");
    if (deadlineMs <= this.#nowMs) return Promise.resolve("deadline");
    return new Promise((resolve) => {
      const waiter = {
        deadlineMs,
        finish: (value: "deadline" | "aborted") => {
          this.#waiters.delete(waiter);
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
      };
      const onAbort = () => waiter.finish("aborted");
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#waiters.add(waiter);
      if (signal?.aborted) waiter.finish("aborted");
    });
  }

  advanceBy(durationMs: number): void {
    if (durationMs < 0) {
      throw new RangeError("Clock duration must be non-negative");
    }
    this.#nowMs += durationMs;
    for (const waiter of [...this.#waiters]) {
      if (waiter.deadlineMs <= this.#nowMs) waiter.finish("deadline");
    }
  }
}

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly settled: boolean;
  resolve(value: T): void;
  reject(error: unknown): void;
}

export function createDeferred<T>(): Deferred<T> {
  let settled = false;
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return {
    promise,
    get settled() {
      return settled;
    },
    resolve(value) {
      if (settled) return;
      settled = true;
      resolvePromise(value);
    },
    reject(error) {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    },
  };
}

export interface ScriptedStreamProvider<T> extends StreamProviderAdapter<T> {
  readonly openCount: number;
  readonly nextCount: number;
  readonly returnCount: number;
  resolveNext(value: IteratorResult<T>): void;
  rejectNext(error: unknown): void;
}

export function createScriptedStreamProvider<T>(
  values: readonly T[],
  options: { autoComplete?: boolean; returnError?: unknown } = {},
): ScriptedStreamProvider<T> {
  const queue: IteratorResult<T>[] = values.map((value) => ({
    done: false,
    value,
  }));
  const autoComplete = options.autoComplete ?? true;
  let openCount = 0;
  let nextCount = 0;
  let returnCount = 0;
  let closed = false;
  let pending: Deferred<IteratorResult<T>> | null = null;

  const settlePending = (result: IteratorResult<T>): void => {
    if (pending === null) queue.push(result);
    else {
      const current = pending;
      pending = null;
      current.resolve(result);
    }
  };

  return {
    get openCount() {
      return openCount;
    },
    get nextCount() {
      return nextCount;
    },
    get returnCount() {
      return returnCount;
    },
    open(signal) {
      if (openCount > 0) throw new Error("Scripted provider supports one open");
      openCount++;
      const onAbort = () => settlePending({ done: true, value: undefined });
      signal.addEventListener("abort", onAbort, { once: true });
      return {
        [Symbol.asyncIterator](): AsyncIterator<T> {
          return {
            next() {
              nextCount++;
              if (closed || signal.aborted) {
                return Promise.resolve({ done: true, value: undefined });
              }
              const queued = queue.shift();
              if (queued) return Promise.resolve(queued);
              if (autoComplete) {
                return Promise.resolve({ done: true, value: undefined });
              }
              if (pending !== null) {
                return Promise.reject(
                  new Error("Only one scripted provider read may be pending"),
                );
              }
              pending = createDeferred<IteratorResult<T>>();
              return pending.promise;
            },
            return() {
              if (!closed) {
                closed = true;
                returnCount++;
                signal.removeEventListener("abort", onAbort);
                settlePending({ done: true, value: undefined });
                if (options.returnError !== undefined) {
                  return Promise.reject(options.returnError);
                }
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      };
    },
    decode(part: T, _snapshot: Readonly<StreamSnapshot>): readonly StreamSignal[] {
      return [part as unknown as StreamSignal];
    },
    classifyError(): StreamProviderError {
      return {
        code: "PROVIDER_STREAM_ERROR",
        publicMessage: "Provider stream failed",
        retryable: true,
        terminal: false,
      };
    },
    resolveNext(result) {
      settlePending(result);
    },
    rejectNext(error) {
      if (pending === null) {
        throw new Error("No scripted provider read is pending");
      }
      const current = pending;
      pending = null;
      current.reject(error);
    },
  };
}

export function createControllableSignalProvider(): ScriptedStreamProvider<
  StreamSignal
> {
  return createScriptedStreamProvider<StreamSignal>([], {
    autoComplete: false,
  });
}
