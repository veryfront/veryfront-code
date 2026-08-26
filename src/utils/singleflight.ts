import { unrefTimer } from "#veryfront/compat/process.ts";

export interface SingleflightOptions {
  /** Last-resort age after which a never-settling leader may be replaced. */
  staleAfterMs?: number;
  /** Called after this exact leader is evicted as stale. */
  onStaleEvicted?: () => void;
  /** Maximum callers that may join an existing leader. */
  maxFollowers?: number;
  /** Lets this caller detach without cancelling other callers. */
  signal?: AbortSignal;
  /** Cancels the shared operation after its final caller detaches. */
  cancelWhenUnobserved?: boolean;
}

export class SingleflightFollowerLimitError extends Error {
  constructor() {
    super("Singleflight follower limit reached");
    this.name = "SingleflightFollowerLimitError";
  }
}

export interface SingleflightControl {
  /** Whether this operation is still the exact leader registered for its key. */
  isCurrent(): boolean;
  /** Shared cancellation that fires only after every caller detaches. */
  signal: AbortSignal;
}

/** How a shared promise settled, recorded so late waiters can settle from it. */
type Settlement<T> =
  | { ok: true; value: T }
  | { ok: false; error: unknown };

type Subscriber<T> = (settlement: Settlement<T>) => void;

interface SingleflightEntry<T> {
  promise: Promise<T>;
  followers: number;
  controller: AbortController;
  waiterCount: number;
  /** Live waiters; detaching deletes the entry so it holds no memory. */
  waiters: Set<Subscriber<T>>;
  settlement?: Settlement<T>;
  settled: boolean;
  cancelWhenUnobserved: boolean;
  staleTimer?: ReturnType<typeof setTimeout>;
}

function signalAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The operation was aborted", "AbortError");
}

/**
 * One removable-subscriber registry per shared promise. Every waiter shares a
 * single promise reaction that fans out to the registry, so a detached waiter
 * can be deleted instead of leaving an unremovable reaction attached until the
 * shared work settles. The registry entry is dropped once the promise settles.
 */
const sharedWaiters = new WeakMap<Promise<unknown>, Set<Subscriber<unknown>>>();

function sharedWaiterRegistry(shared: Promise<unknown>): Set<Subscriber<unknown>> {
  const existing = sharedWaiters.get(shared);
  if (existing) return existing;

  const created = new Set<Subscriber<unknown>>();
  sharedWaiters.set(shared, created);
  const settle = (settlement: Settlement<unknown>): void => {
    sharedWaiters.delete(shared);
    const waiters = [...created];
    created.clear();
    for (const waiter of waiters) waiter(settlement);
  };
  // This single reaction also observes rejection, so detached waiters cannot
  // leave the shared promise unhandled.
  shared.then(
    (value) => settle({ ok: true, value }),
    (error) => settle({ ok: false, error }),
  );
  return created;
}

/**
 * Wait for shared work while allowing this caller to detach independently.
 * Aborting `signal` rejects only this waiter; it never cancels `shared`.
 */
export async function waitForSharedPromise<T>(
  shared: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return await shared;

  const registry = sharedWaiterRegistry(shared);

  if (signal.aborted) {
    // The shared operation can still fail after this caller detaches; the
    // registry's single reaction observes that rejection so a sole detached
    // caller cannot leave it unhandled.
    throw signalAbortReason(signal);
  }

  return await new Promise<T>((resolve, reject) => {
    const subscriber: Subscriber<unknown> = (settlement) => {
      signal.removeEventListener("abort", onAbort);
      if (settlement.ok) resolve(settlement.value as T);
      else reject(settlement.error);
    };
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      registry.delete(subscriber);
      reject(signalAbortReason(signal));
    };

    signal.addEventListener("abort", onAbort, { once: true });
    registry.add(subscriber);
  });
}

export class Singleflight<T> {
  private inflight = new Map<string, SingleflightEntry<T>>();

  private waitForEntry(
    key: string,
    entry: SingleflightEntry<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    entry.waiterCount++;

    return new Promise<T>((resolve, reject) => {
      let finished = false;
      let released = false;

      const release = (reason?: unknown): void => {
        if (released) return;
        released = true;
        entry.waiterCount--;
        if (
          entry.waiterCount === 0 && entry.cancelWhenUnobserved && !entry.settled &&
          !entry.controller.signal.aborted
        ) {
          entry.controller.abort(reason);
          if (this.inflight.get(key) === entry) this.inflight.delete(key);
          if (entry.staleTimer !== undefined) clearTimeout(entry.staleTimer);
        }
      };
      const detach = (): void => {
        signal?.removeEventListener("abort", onAbort);
        entry.waiters.delete(onSettle);
      };
      const finish = (settle: () => void, reason?: unknown): void => {
        if (finished) return;
        finished = true;
        detach();
        release(reason);
        settle();
      };
      const onAbort = (): void => {
        const reason = signal ? signalAbortReason(signal) : undefined;
        finish(() => reject(reason), reason);
      };
      const onSettle: Subscriber<T> = (settlement) => {
        if (settlement.ok) finish(() => resolve(settlement.value));
        else finish(() => reject(settlement.error));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      if (entry.settlement !== undefined) onSettle(entry.settlement);
      else entry.waiters.add(onSettle);
      if (signal?.aborted) onAbort();
    });
  }

  async do(
    key: string,
    operation: (control: SingleflightControl) => Promise<T>,
    options: SingleflightOptions = {},
  ): Promise<T> {
    if (options.staleAfterMs !== undefined && options.staleAfterMs <= 0) {
      throw new RangeError("Singleflight staleAfterMs must be greater than zero");
    }
    if (
      options.maxFollowers !== undefined &&
      (!Number.isInteger(options.maxFollowers) || options.maxFollowers < 0)
    ) {
      throw new RangeError(
        "Singleflight maxFollowers must be a non-negative integer",
      );
    }

    if (options.signal?.aborted) throw signalAbortReason(options.signal);

    const entry = this.inflight.get(key);
    if (entry) {
      if (
        options.maxFollowers !== undefined &&
        entry.followers >= options.maxFollowers
      ) {
        throw new SingleflightFollowerLimitError();
      }
      if (options.cancelWhenUnobserved === true) entry.cancelWhenUnobserved = true;
      entry.followers++;
      try {
        return await this.waitForEntry(key, entry, options.signal);
      } finally {
        entry.followers--;
      }
    }

    let resolvePromise!: (value: T | PromiseLike<T>) => void;
    let rejectPromise!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const createdEntry: SingleflightEntry<T> = {
      promise,
      followers: 0,
      controller: new AbortController(),
      waiterCount: 0,
      waiters: new Set(),
      settled: false,
      cancelWhenUnobserved: options.cancelWhenUnobserved === true,
    };
    // One shared reaction fans the settlement out to the live waiters, so a
    // detached waiter is deleted from the set instead of leaving an
    // unremovable per-waiter reaction attached until the leader settles.
    const settleWaiters = (settlement: Settlement<T>): void => {
      createdEntry.settlement = settlement;
      const waiters = [...createdEntry.waiters];
      createdEntry.waiters.clear();
      for (const waiter of waiters) waiter(settlement);
    };
    void promise.then(
      (value) => settleWaiters({ ok: true, value }),
      (error) => settleWaiters({ ok: false, error }),
    );
    const control: SingleflightControl = {
      isCurrent: () => this.inflight.get(key) === createdEntry,
      signal: createdEntry.controller.signal,
    };
    this.inflight.set(key, createdEntry);

    try {
      void operation(control).then(
        (value) => {
          createdEntry.settled = true;
          resolvePromise(value);
        },
        (error) => {
          createdEntry.settled = true;
          rejectPromise(error);
        },
      );
    } catch (error) {
      createdEntry.settled = true;
      rejectPromise(error);
    }

    const cleanup = (): void => {
      if (createdEntry.staleTimer !== undefined) clearTimeout(createdEntry.staleTimer);
      if (this.inflight.get(key) === createdEntry) this.inflight.delete(key);
    };
    void promise.then(cleanup, cleanup);

    if (options.staleAfterMs !== undefined) {
      createdEntry.staleTimer = setTimeout(() => {
        if (this.inflight.get(key) !== createdEntry) return;
        this.inflight.delete(key);
        try {
          options.onStaleEvicted?.();
        } catch {
          // Observers are diagnostic only; an observer failure must not escape
          // the timer task or interfere with singleflight state cleanup.
        }
      }, options.staleAfterMs);
      unrefTimer(createdEntry.staleTimer);
    }

    return await this.waitForEntry(key, createdEntry, options.signal);
  }

  has(key: string): boolean {
    return this.inflight.has(key);
  }

  /** Allow a replacement leader while the forgotten operation finishes independently. */
  forget(key: string): boolean {
    const entry = this.inflight.get(key);
    if (!entry) return false;
    if (entry.staleTimer !== undefined) clearTimeout(entry.staleTimer);
    return this.inflight.delete(key);
  }

  get size(): number {
    return this.inflight.size;
  }
}
