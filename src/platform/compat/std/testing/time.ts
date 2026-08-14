/**
 * Cross-runtime `FakeTime`, the shape `@std/testing/time` exposes.
 *
 * Deno resolves `#std/testing/time` to the real jsr module; Node and Bun have
 * no such package to reach for, so the tests that drive a clock forward need a
 * native implementation with the same surface.
 *
 * @module platform/compat/std/testing/time
 */

type TimerCallback = (...args: unknown[]) => void;

type FakeTimer = {
  id: number;
  due: number;
  sequence: number;
  /** Repeat delay for intervals; `null` marks a one-shot timeout. */
  period: number | null;
  callback: TimerCallback;
  args: unknown[];
};

type TimerGlobals = {
  setTimeout: typeof globalThis.setTimeout;
  clearTimeout: typeof globalThis.clearTimeout;
  setInterval: typeof globalThis.setInterval;
  clearInterval: typeof globalThis.clearInterval;
  Date: DateConstructor;
};

type MutableGlobals = Record<string, unknown>;

// A callback that reschedules itself with no delay would otherwise spin until
// the process is killed, which reads as a hung suite rather than a bad test.
const MAX_TIMERS_PER_TICK = 100_000;

function toDelay(value: unknown): number {
  const delay = Number(value);
  return Number.isFinite(delay) && delay > 0 ? delay : 0;
}

function toStartTime(start: number | string | Date | undefined, fallback: number): number {
  if (start === undefined) return fallback;
  const time = start instanceof Date ? start.getTime() : new Date(start).getTime();
  if (!Number.isFinite(time)) {
    throw new TypeError(`FakeTime start must be a valid date; received ${String(start)}`);
  }
  return time;
}

/**
 * Replaces the global clock and timer functions so tests advance time by hand.
 *
 * Only one instance may be installed at a time. Dispose it with `using time = new
 * FakeTime()`, or call {@linkcode FakeTime.restore} to put the real globals back.
 */
export class FakeTime {
  static #installed: FakeTime | undefined;

  readonly #originals: TimerGlobals;
  readonly #timers = new Map<number, FakeTimer>();
  #now: number;
  #nextId = 1;
  #sequence = 0;
  #restored = false;

  constructor(start?: number | string | Date) {
    if (FakeTime.#installed) {
      throw new Error("FakeTime is already installed; restore the previous instance first");
    }

    const globals = globalThis as unknown as MutableGlobals;
    this.#originals = {
      setTimeout: globalThis.setTimeout,
      clearTimeout: globalThis.clearTimeout,
      setInterval: globalThis.setInterval,
      clearInterval: globalThis.clearInterval,
      Date: globalThis.Date,
    };
    this.#now = toStartTime(start, this.#originals.Date.now());

    globals.setTimeout = (callback: TimerCallback, delay?: unknown, ...args: unknown[]) =>
      this.#schedule(callback, toDelay(delay), null, args);
    globals.setInterval = (callback: TimerCallback, delay?: unknown, ...args: unknown[]) => {
      const period = Math.max(1, toDelay(delay));
      return this.#schedule(callback, period, period, args);
    };
    globals.clearTimeout = (id?: unknown) => this.#clear(id);
    globals.clearInterval = (id?: unknown) => this.#clear(id);
    globals.Date = this.#createDate();

    FakeTime.#installed = this;
  }

  /** The faked wall clock, in milliseconds since the epoch. */
  get now(): number {
    return this.#now;
  }

  /** Advance the clock, running every timer that comes due on the way. */
  tick(ms = 0): void {
    if (!Number.isFinite(ms)) {
      // NaN slips past the comparison below -- `NaN < this.#now` is false --
      // and then `#due` treats every pending timer as due, because
      // `timer.due > NaN` is false too. The clock ends up NaN and every later
      // assertion on it is quietly meaningless.
      throw new RangeError(`Cannot advance the fake clock by ${ms}ms`);
    }
    const target = this.#now + ms;
    if (target < this.#now) {
      throw new RangeError(`Cannot move the fake clock backwards; received ${ms}ms`);
    }
    let fired = 0;
    for (const timer of this.#due(target)) {
      this.#invoke(timer);
      if (++fired > MAX_TIMERS_PER_TICK) {
        throw new Error(`FakeTime fired more than ${MAX_TIMERS_PER_TICK} timers in one tick`);
      }
    }
    this.#now = target;
  }

  /**
   * Let already-pending jobs settle on the real event loop, then advance the
   * clock exactly as {@linkcode FakeTime.tick} does. Work the newly fired timers
   * start is deliberately left in flight.
   */
  async tickAsync(ms = 0): Promise<void> {
    await this.runMicrotasks();
    this.tick(ms);
  }

  /** Hand control back to the real event loop so pending jobs can run. */
  runMicrotasks(): Promise<void> {
    // Deno's setTimeout rejects a receiver other than the global object, so the
    // saved reference has to be called as a plain function.
    const realSetTimeout = this.#originals.setTimeout;
    return new Promise((resolve) => {
      realSetTimeout(resolve, 0);
    });
  }

  /** Put the real clock and timer functions back. Safe to call twice. */
  restore(): void {
    if (this.#restored) return;
    this.#restored = true;

    const globals = globalThis as unknown as MutableGlobals;
    globals.setTimeout = this.#originals.setTimeout;
    globals.clearTimeout = this.#originals.clearTimeout;
    globals.setInterval = this.#originals.setInterval;
    globals.clearInterval = this.#originals.clearInterval;
    globals.Date = this.#originals.Date;

    this.#timers.clear();
    if (FakeTime.#installed === this) FakeTime.#installed = undefined;
  }

  [Symbol.dispose](): void {
    this.restore();
  }

  #schedule(
    callback: TimerCallback,
    delay: number,
    period: number | null,
    args: unknown[],
  ): number {
    const id = this.#nextId++;
    this.#timers.set(id, {
      id,
      due: this.#now + delay,
      sequence: this.#sequence++,
      period,
      callback,
      args,
    });
    return id;
  }

  #clear(id: unknown): void {
    const key = Number(id);
    if (Number.isFinite(key)) this.#timers.delete(key);
  }

  /**
   * Yields each timer due at or before `target` in firing order, taking timers
   * scheduled by earlier callbacks into account as it goes.
   */
  *#due(target: number): Generator<FakeTimer> {
    while (true) {
      let next: FakeTimer | undefined;
      for (const timer of this.#timers.values()) {
        if (timer.due > target) continue;
        if (
          !next || timer.due < next.due ||
          (timer.due === next.due && timer.sequence < next.sequence)
        ) {
          next = timer;
        }
      }
      if (!next) return;

      this.#now = Math.max(this.#now, next.due);
      if (next.period === null) {
        this.#timers.delete(next.id);
      } else {
        next.due = this.#now + next.period;
        next.sequence = this.#sequence++;
      }
      yield next;
    }
  }

  #invoke(timer: FakeTimer): void {
    timer.callback(...timer.args);
  }

  /**
   * A `Date` that reads the faked clock. Proxying the real constructor keeps
   * `instanceof`, `Date.parse`, `Date.UTC` and every argument overload intact.
   */
  #createDate(): DateConstructor {
    const readNow = () => this.#now;
    return new Proxy(this.#originals.Date, {
      apply(target) {
        return new target(readNow()).toString();
      },
      construct(target, args, newTarget) {
        const effective = args.length === 0 ? [readNow()] : args;
        return Reflect.construct(target, effective, newTarget);
      },
      get(target, property, receiver) {
        if (property === "now") return readNow;
        return Reflect.get(target, property, receiver);
      },
    });
  }
}
