import { performanceMonotonicClock } from "#veryfront/agent/streaming/lifecycle/clock.ts";
import {
  type AbsoluteDeadlineTimer,
  createClockDeadlineTimer,
} from "#veryfront/agent/streaming/lifecycle/deadlines.ts";
import {
  createHostedExecutorSession,
  type HostedExecutorSession,
  type HostedExecutorSessionCloseResult,
  type HostedExecutorSessionOptions,
} from "#veryfront/agent/hosted/executor-session.ts";

export interface HostedExecutorSessionPoolOptions {
  /** Finite process admission ceiling, including preparation and resource retirement. Maximum 256. */
  maxActive: number;
  signal?: AbortSignal;
  /** Bounds shutdown notification, never the underlying work's admission lifetime. Default five seconds, maximum 30 seconds. */
  shutdownTimeoutMs?: number;
  timer?: AbsoluteDeadlineTimer;
  /** Trusted synchronous factory. A thrown constructor must clean up its own partial resources. */
  createSession?: (options: HostedExecutorSessionOptions) => HostedExecutorSession;
}

export interface HostedExecutorSessionPoolShutdownResult {
  /** Aggregated allocation release acknowledgement, independent of raw work in pool.settled. */
  release: HostedExecutorSessionCloseResult["release"];
  /** Sessions or constructor reservations still holding process admission when notified. */
  pending: number;
}

export interface HostedExecutorSessionPool {
  readonly active: number;
  /** Independent lifetime owner propagated to every admitted session. */
  readonly signal: AbortSignal;
  /** Bounded shutdown result. It does not certify that underlying work has retired. */
  readonly closed: Promise<HostedExecutorSessionPoolShutdownResult>;
  /** Resolves after shutdown and all sessions' raw work settles. A rejected session retirement fails this promise. */
  readonly settled: Promise<void>;
  /** Synchronously reserve capacity. Overload and shutdown reject without queuing or invoking the factory. */
  start(options: HostedExecutorSessionOptions): HostedExecutorSession;
  /** Permanently stop admission and synchronously request closure of all active sessions. */
  shutdown(): Promise<HostedExecutorSessionPoolShutdownResult>;
}

interface Reservation {
  session?: HostedExecutorSession;
  closing: boolean;
  result?: HostedExecutorSessionCloseResult;
}

function limit(value: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError("Executor session pool requires bounded positive integer limits");
  }
  return value;
}

/** Process-local admission only. Session construction owns authorization, allocation, and lifecycle policy. */
export function createHostedExecutorSessionPool(
  options: HostedExecutorSessionPoolOptions,
): HostedExecutorSessionPool {
  return new SessionPool(options);
}

class SessionPool implements HostedExecutorSessionPool {
  readonly #maximum: number;
  readonly #timeout: number;
  readonly #timer: AbsoluteDeadlineTimer;
  readonly #createSession: NonNullable<HostedExecutorSessionPoolOptions["createSession"]>;
  readonly #controller = new AbortController();
  readonly #closed = Promise.withResolvers<HostedExecutorSessionPoolShutdownResult>();
  readonly #settled = Promise.withResolvers<void>();
  readonly #active = new Set<Reservation>();
  readonly #shutdownSignal?: AbortSignal;
  readonly #onShutdown = () => {
    void this.shutdown();
  };
  #stopped = false;
  #notified = false;
  #shutdownReservations: Reservation[] = [];
  #shutdownTimer?: unknown;
  #retirementFailed = false;

  constructor(options: HostedExecutorSessionPoolOptions) {
    this.#maximum = limit(options.maxActive, 256);
    this.#timeout = limit(options.shutdownTimeoutMs ?? 5000, 30_000);
    this.#timer = options.timer ?? createClockDeadlineTimer(performanceMonotonicClock);
    this.#createSession = options.createSession ?? createHostedExecutorSession;
    this.#shutdownSignal = options.signal;
    void this.settled.catch(() => {});
    options.signal?.addEventListener("abort", this.#onShutdown, { once: true });
    if (options.signal?.aborted) void this.shutdown();
  }

  get active(): number {
    return this.#active.size;
  }
  get signal(): AbortSignal {
    return this.#controller.signal;
  }
  get closed(): Promise<HostedExecutorSessionPoolShutdownResult> {
    return this.#closed.promise;
  }
  get settled(): Promise<void> {
    return this.#settled.promise;
  }

  start(options: HostedExecutorSessionOptions): HostedExecutorSession {
    if (this.#stopped) throw new Error("Executor session pool is shut down");
    if (this.#active.size >= this.#maximum) {
      throw new Error("Executor session pool capacity exceeded");
    }
    const reservation: Reservation = { closing: false };
    this.#active.add(reservation);
    let session: HostedExecutorSession;
    try {
      const ownerSignal = options.ownerSignal
        ? AbortSignal.any([this.signal, options.ownerSignal])
        : this.signal;
      session = this.#createSession({ ...options, ownerSignal });
    } catch (error) {
      reservation.result = { reason: "construction-failed", release: "not-allocated" };
      this.#active.delete(reservation);
      this.#checkShutdown();
      throw error;
    }
    reservation.session = session;
    void session.closed.then((result) => {
      reservation.result ??= result;
      this.#checkShutdown();
    }, () => {
      reservation.result = { reason: "cleanup-failed", release: "reaper-required" };
      this.#checkShutdown();
    });
    void session.settled.then(() => {
      this.#active.delete(reservation);
      this.#checkShutdown();
    }, () => {
      // Failed retirement cannot certify that process capacity is reusable.
      this.#retirementFailed = true;
      reservation.result = { reason: "retirement-failed", release: "reaper-required" };
      this.#settled.reject(new Error("Executor session pool retirement failed"));
      void this.shutdown();
      this.#checkShutdown();
    });
    if (this.#stopped) {
      this.#close(reservation);
      throw new Error("Executor session pool is shut down");
    }
    return session;
  }

  shutdown(): Promise<HostedExecutorSessionPoolShutdownResult> {
    if (this.#stopped) return this.closed;
    this.#stopped = true;
    this.#shutdownSignal?.removeEventListener("abort", this.#onShutdown);
    this.#shutdownReservations = [...this.#active];
    this.#shutdownTimer = this.#timer.schedule(() => this.#notify(true), this.#timeout);
    this.#controller.abort(new Error("Executor session pool is shut down"));
    for (const reservation of this.#shutdownReservations) this.#close(reservation);
    this.#checkShutdown();
    return this.closed;
  }

  #close(reservation: Reservation): void {
    if (!reservation.session || reservation.closing) return;
    reservation.closing = true;
    const session = reservation.session;
    void (async () => {
      try {
        // Completion belongs to session.closed; observe this call only to contain close failures.
        await session.close("canceled");
      } catch {
        this.#closeFailed(reservation);
      }
    })();
  }

  #closeFailed(reservation: Reservation): void {
    reservation.result = { reason: "cleanup-failed", release: "reaper-required" };
    this.#checkShutdown();
  }

  #checkShutdown(): void {
    if (!this.#stopped) return;
    if (!this.#notified && this.#shutdownReservations.every((reservation) => reservation.result)) {
      this.#notify(false);
    }
    if (this.#active.size === 0 && !this.#retirementFailed) this.#settled.resolve();
  }

  #notify(timedOut: boolean): void {
    if (this.#notified) return;
    this.#notified = true;
    this.#timer.cancel(this.#shutdownTimer);
    const release = timedOut || this.#retirementFailed ||
        this.#shutdownReservations.some((entry) => entry.result?.release === "reaper-required")
      ? "reaper-required"
      : this.#shutdownReservations.some((entry) => entry.result?.release === "released")
      ? "released"
      : "not-allocated";
    this.#shutdownReservations = [];
    this.#closed.resolve(Object.freeze({ release, pending: this.active }));
  }
}
