import { SERVICE_OVERLOADED } from "#veryfront/errors";

interface WaitingOperation<T> {
  abortListener?: () => void;
  next: WaitingOperation<unknown> | null;
  operation: () => PromiseLike<T>;
  previous: WaitingOperation<unknown> | null;
  reject: (reason?: unknown) => void;
  resolve: (value: T | PromiseLike<T>) => void;
  signal?: AbortSignal;
  started: boolean;
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ??
    new DOMException("The operation was aborted", "AbortError");
}

/**
 * Await a promise while allowing this waiter to detach on cancellation.
 *
 * Cancelling the waiter deliberately does not cancel the shared input promise.
 */
export function waitWithAbort<T>(
  input: PromiseLike<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return Promise.resolve(input);
  if (signal.aborted) return Promise.reject(abortReason(signal));

  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });

    Promise.resolve(input).then(
      (value) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

/**
 * FIFO serial executor with a fixed queue bound and abortable waiting.
 */
export class BoundedSerialExecutor {
  private active = false;
  private head: WaitingOperation<unknown> | null = null;
  private tail: WaitingOperation<unknown> | null = null;
  private queued = 0;

  constructor(
    private readonly name: string,
    private readonly maxQueued: number,
  ) {
    if (!Number.isSafeInteger(maxQueued) || maxQueued < 0) {
      throw new RangeError(
        "BoundedSerialExecutor maxQueued must be a non-negative safe integer",
      );
    }
  }

  run<T>(
    operation: () => PromiseLike<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    if (signal?.aborted) return Promise.reject(abortReason(signal));
    if (this.active && this.queued >= this.maxQueued) {
      return Promise.reject(
        SERVICE_OVERLOADED.create({
          detail: `${this.name} queue is full (${this.maxQueued} waiting operations)`,
        }),
      );
    }

    return new Promise<T>((resolve, reject) => {
      const waiting: WaitingOperation<T> = {
        next: null,
        operation,
        previous: null,
        reject,
        resolve,
        signal,
        started: false,
      };

      if (!this.active) {
        this.active = true;
        this.start(waiting);
        return;
      }

      const node = waiting as WaitingOperation<unknown>;
      node.previous = this.tail;
      if (this.tail) this.tail.next = node;
      else this.head = node;
      this.tail = node;
      this.queued++;

      if (signal) {
        const onAbort = () => {
          if (node.started) return;
          this.remove(node);
          reject(abortReason(signal));
        };
        waiting.abortListener = onAbort;
        signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }

  private remove(node: WaitingOperation<unknown>): void {
    if (node.previous) node.previous.next = node.next;
    else this.head = node.next;
    if (node.next) node.next.previous = node.previous;
    else this.tail = node.previous;
    node.next = null;
    node.previous = null;
    this.queued--;
    if (node.abortListener && node.signal) {
      node.signal.removeEventListener("abort", node.abortListener);
      node.abortListener = undefined;
    }
  }

  private start<T>(node: WaitingOperation<T>): void {
    node.started = true;
    if (node.abortListener && node.signal) {
      node.signal.removeEventListener("abort", node.abortListener);
      node.abortListener = undefined;
    }
    if (node.signal?.aborted) {
      node.reject(abortReason(node.signal));
      this.advance();
      return;
    }

    void Promise.resolve()
      .then(node.operation)
      .then(node.resolve, node.reject)
      .finally(() => this.advance());
  }

  private advance(): void {
    const next = this.head;
    if (!next) {
      this.active = false;
      this.tail = null;
      return;
    }

    this.remove(next);
    this.start(next);
  }
}
