import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { AGENT_ERROR } from "#veryfront/errors";
import {
  assertRunControlAuthority,
  type VerifiedRunControlAuthority,
} from "./run-control-authority.ts";

/** Public API contract for run session status. */
export type RunSessionStatus = "running" | "waiting" | "completed" | "cancelled" | "failed";

/** Error shape for run cancelled. */
export class RunCancelledError extends Error {
  constructor(message = "Run cancelled") {
    super(message);
    this.name = "RunCancelledError";
  }
}

/** Error shape for run already exists. */
export class RunAlreadyExistsError extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" is already active`);
    this.name = "RunAlreadyExistsError";
  }
}

/** Error shape for run not active. */
export class RunNotActiveError extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" is not active`);
    this.name = "RunNotActiveError";
  }
}

/** Error shape for wait not pending. */
export class WaitNotPendingError extends Error {
  constructor(runId: string, waitKey: string) {
    super(`Run "${runId}" is not waiting for "${waitKey}"`);
    this.name = "WaitNotPendingError";
  }
}

/** Error shape for wait conflict. */
export class WaitConflictError extends Error {
  constructor(runId: string, waitKey: string) {
    super(`Conflicting resume value for run "${runId}" and wait key "${waitKey}"`);
    this.name = "WaitConflictError";
  }
}

/** Public API contract for submit resume value outcome. */
export interface SubmitResumeValueOutcome {
  accepted: true;
  duplicate?: true;
}

type SubmittedValue<T> = {
  value: T;
  key: string;
};

type WaitingState<T> = {
  waitKey: string;
  resolve: (value: SubmittedValue<T>) => void;
  reject: (reason?: unknown) => void;
};

type RunSession<T> = {
  runId: string;
  /** The durable run's latest event id the control plane dispatched this start from. */
  startedFromEventId?: number;
  status: RunSessionStatus;
  abortController: AbortController;
  waitingState: WaitingState<T> | null;
  preparedWaitKeys: Set<string>;
  submittedValues: Map<string, SubmittedValue<T>>;
  waitingTimeoutId: ReturnType<typeof setTimeout> | null;
  sessionTimeoutId: ReturnType<typeof setTimeout> | null;
};

type CancellationTombstone = {
  expiresAt: number;
  /** Set for a park cancellation: only starts from before this event are refused. */
  refusesStartsBeforeEventId?: number;
};

const DEFAULT_WAITING_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CANCELLATION_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CANCELLATION_TOMBSTONES = 1_000;
const DEFAULT_MAX_CONCURRENT_SESSIONS = 100;
const MAX_SETTLING_CANCELLED_EXECUTIONS = 1_000;

/** Options accepted by run resume session manager. */
export interface RunResumeSessionManagerOptions<T> {
  waitingTtlMs?: number;
  sessionTtlMs?: number | null;
  /** How long an explicit cancellation can reject a delayed start for the same run. */
  cancellationTtlMs?: number;
  /** Maximum delayed-start cancellations retained by one manager instance. */
  maxCancellationTombstones?: number;
  maxConcurrentSessions?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  getConflictKey?: (value: T) => string;
}

function defaultConflictKey(value: unknown): string {
  return privateJsonStringify(value);
}

/** Implement run resume session manager. */
export class RunResumeSessionManager<T> {
  private readonly sessions = new Map<string, RunSession<T>>();
  private readonly cancellationTombstones = new Map<string, CancellationTombstone>();
  /**
   * Signal of a cancelled session per run id whose execution has not reported
   * settling yet. A start that reuses the run id supersedes it.
   */
  private readonly settlingCancelledSignals = new Map<string, AbortSignal>();
  /** Signals of executions whose run id a later start has taken over. */
  private readonly supersededSignals = new WeakSet<AbortSignal>();

  constructor(
    private readonly options: RunResumeSessionManagerOptions<T> = {},
  ) {}

  private get waitingTtlMs(): number {
    return this.options.waitingTtlMs ?? DEFAULT_WAITING_TTL_MS;
  }

  private get sessionTtlMs(): number | null {
    return this.options.sessionTtlMs ?? null;
  }

  private get cancellationTtlMs(): number {
    return Math.max(1, this.options.cancellationTtlMs ?? DEFAULT_CANCELLATION_TTL_MS);
  }

  private get maxCancellationTombstones(): number {
    return Math.max(
      1,
      this.options.maxCancellationTombstones ?? DEFAULT_MAX_CANCELLATION_TOMBSTONES,
    );
  }

  private get maxConcurrentSessions(): number {
    return this.options.maxConcurrentSessions ?? DEFAULT_MAX_CONCURRENT_SESSIONS;
  }

  private get setTimeoutFn(): typeof setTimeout {
    return this.options.setTimeoutFn ?? globalThis.setTimeout.bind(globalThis);
  }

  private get clearTimeoutFn(): typeof clearTimeout {
    return this.options.clearTimeoutFn ?? globalThis.clearTimeout.bind(globalThis);
  }

  private get nowMs(): number {
    return Date.now();
  }

  private getConflictKey(value: T): string {
    const createConflictKey = this.options.getConflictKey ?? defaultConflictKey;
    return createConflictKey(value);
  }

  /**
   * Remember a cancellation so a delayed start of the run is refused. With
   * `refusesStartsBeforeEventId`, only starts dispatched from before that event
   * are refused. A tombstone already remembered for the run never gets less
   * strict.
   */
  private rememberCancellation(runId: string, refusesStartsBeforeEventId?: number): void {
    const now = this.nowMs;
    for (const [candidateRunId, tombstone] of this.cancellationTombstones) {
      if (tombstone.expiresAt <= now) {
        this.cancellationTombstones.delete(candidateRunId);
      }
    }

    const existing = this.cancellationTombstones.get(runId);
    this.cancellationTombstones.delete(runId);

    while (this.cancellationTombstones.size >= this.maxCancellationTombstones) {
      const oldestRunId = this.cancellationTombstones.keys().next().value;
      if (oldestRunId === undefined) break;
      this.cancellationTombstones.delete(oldestRunId);
    }

    const cutoff = existing === undefined
      ? refusesStartsBeforeEventId
      : existing.refusesStartsBeforeEventId === undefined ||
          refusesStartsBeforeEventId === undefined
      ? undefined
      : Math.max(existing.refusesStartsBeforeEventId, refusesStartsBeforeEventId);
    this.cancellationTombstones.set(runId, {
      expiresAt: now + this.cancellationTtlMs,
      ...(cutoff !== undefined ? { refusesStartsBeforeEventId: cutoff } : {}),
    });
  }

  private refusesCancelledStart(runId: string, startedFromEventId: number | undefined): boolean {
    const tombstone = this.cancellationTombstones.get(runId);
    if (tombstone === undefined) return false;
    if (tombstone.expiresAt <= this.nowMs) {
      this.cancellationTombstones.delete(runId);
      return false;
    }
    if (tombstone.refusesStartsBeforeEventId === undefined) return true;
    return startedFromEventId === undefined ||
      startedFromEventId < tombstone.refusesStartsBeforeEventId;
  }

  private clearWaitingTimeout(session: RunSession<T>): void {
    if (session.waitingTimeoutId === null) return;
    this.clearTimeoutFn(session.waitingTimeoutId);
    session.waitingTimeoutId = null;
  }

  private clearSessionTimeout(session: RunSession<T>): void {
    if (session.sessionTimeoutId === null) return;
    this.clearTimeoutFn(session.sessionTimeoutId);
    session.sessionTimeoutId = null;
  }

  private scheduleSessionTimeout(session: RunSession<T>): void {
    if (this.sessionTtlMs === null) return;
    this.clearSessionTimeout(session);
    session.sessionTimeoutId = this.setTimeoutFn(() => {
      this.cancelRun(session.runId);
    }, this.sessionTtlMs);
  }

  private scheduleWaitingTimeout(session: RunSession<T>): void {
    this.clearWaitingTimeout(session);
    session.waitingTimeoutId = this.setTimeoutFn(() => {
      this.cancelRun(session.runId);
    }, this.waitingTtlMs);
  }

  private touchSession(session: RunSession<T>): void {
    if (session.status === "running" || session.status === "waiting") {
      this.scheduleSessionTimeout(session);
    }
  }

  private finalizeSession(
    session: RunSession<T>,
    status: Exclude<RunSessionStatus, "running" | "waiting">,
  ): void {
    session.status = status;
    this.clearWaitingTimeout(session);
    this.clearSessionTimeout(session);
    session.waitingState = null;
    if (
      status === "cancelled" &&
      !this.rememberSettlingCancellation(session.runId, session.abortController.signal)
    ) {
      // Every tracked cancellation is still executing, so evicting one would
      // recreate the stale-callback race. Keep this cancelled session in the
      // bounded session map instead: its run id cannot be reused until its
      // execution settles and completeRun/failRun removes it.
      return;
    }
    this.sessions.delete(session.runId);
  }

  /**
   * A cancelled execution can ignore its abort and keep running. Remember its
   * signal until it settles so a start that reuses the run id supersedes it.
   * Returns false when every bounded slot is held by a still-settling
   * execution. The caller then retains the cancelled session as backpressure
   * instead of evicting live correctness state.
   */
  private rememberSettlingCancellation(runId: string, signal: AbortSignal): boolean {
    this.settlingCancelledSignals.delete(runId);
    if (this.settlingCancelledSignals.size >= MAX_SETTLING_CANCELLED_EXECUTIONS) {
      return false;
    }
    this.settlingCancelledSignals.set(runId, signal);
    return true;
  }

  /** Forget a cancelled execution once it settles; a later start no longer races it. */
  private forgetSettledCancellation(runId: string, signal: AbortSignal | undefined): void {
    if (signal !== undefined && this.settlingCancelledSignals.get(runId) === signal) {
      this.settlingCancelledSignals.delete(runId);
    }
  }

  startRun(input: { runId: string; threadId: string; startedFromEventId?: number }): AbortSignal {
    if (this.refusesCancelledStart(input.runId, input.startedFromEventId)) {
      throw new RunCancelledError(`Run "${input.runId}" was cancelled before start`);
    }

    const existing = this.sessions.get(input.runId);
    if (existing) {
      throw new RunAlreadyExistsError(input.runId);
    }

    if (this.sessions.size >= this.maxConcurrentSessions) {
      throw AGENT_ERROR.create({
        detail: `Maximum concurrent sessions (${this.maxConcurrentSessions}) reached`,
      });
    }

    const session: RunSession<T> = {
      runId: input.runId,
      ...(input.startedFromEventId !== undefined
        ? { startedFromEventId: input.startedFromEventId }
        : {}),
      status: "running",
      abortController: new AbortController(),
      waitingState: null,
      preparedWaitKeys: new Set(),
      submittedValues: new Map(),
      waitingTimeoutId: null,
      sessionTimeoutId: null,
    };

    const settlingSignal = this.settlingCancelledSignals.get(input.runId);
    if (settlingSignal !== undefined) {
      this.supersededSignals.add(settlingSignal);
      this.settlingCancelledSignals.delete(input.runId);
    }

    this.sessions.set(input.runId, session);
    this.touchSession(session);
    return session.abortController.signal;
  }

  prepareForSignal(runId: string, waitKey: string): void {
    const session = this.sessions.get(runId);
    if (!session) {
      throw new RunNotActiveError(runId);
    }

    if (
      session.status === "completed" || session.status === "failed" ||
      session.status === "cancelled"
    ) {
      throw new RunNotActiveError(runId);
    }

    session.preparedWaitKeys.add(waitKey);
    this.touchSession(session);
  }

  async waitForSignal(runId: string, waitKey: string): Promise<T> {
    const session = this.sessions.get(runId);
    if (!session || session.status === "completed" || session.status === "failed") {
      throw new RunNotActiveError(runId);
    }

    if (session.abortController.signal.aborted || session.status === "cancelled") {
      throw new RunCancelledError();
    }

    session.preparedWaitKeys.add(waitKey);
    const existingValue = session.submittedValues.get(waitKey);
    if (existingValue) {
      session.status = "running";
      this.touchSession(session);
      return existingValue.value;
    }

    if (session.waitingState && session.waitingState.waitKey !== waitKey) {
      throw new WaitNotPendingError(runId, waitKey);
    }

    session.status = "waiting";
    this.scheduleWaitingTimeout(session);
    this.touchSession(session);

    return await new Promise<T>((resolve, reject) => {
      const abortHandler = () => {
        this.clearWaitingTimeout(session);
        session.waitingState = null;
        session.status = "cancelled";
        reject(new RunCancelledError());
      };

      session.abortController.signal.addEventListener("abort", abortHandler, { once: true });
      session.waitingState = {
        waitKey,
        resolve: (value) => {
          session.abortController.signal.removeEventListener("abort", abortHandler);
          this.clearWaitingTimeout(session);
          session.waitingState = null;
          session.status = "running";
          this.touchSession(session);
          resolve(value.value);
        },
        reject: (reason) => {
          session.abortController.signal.removeEventListener("abort", abortHandler);
          this.clearWaitingTimeout(session);
          session.waitingState = null;
          reject(reason);
        },
      };
    });
  }

  submitSignal(
    runId: string,
    input: { waitKey: string; value: T },
  ): SubmitResumeValueOutcome {
    const session = this.sessions.get(runId);
    if (!session) {
      throw new RunNotActiveError(runId);
    }

    const normalized: SubmittedValue<T> = {
      value: input.value,
      key: this.getConflictKey(input.value),
    };

    const existingValue = session.submittedValues.get(input.waitKey);
    if (existingValue) {
      if (existingValue.key === normalized.key) {
        return { accepted: true, duplicate: true };
      }

      throw new WaitConflictError(runId, input.waitKey);
    }

    if (
      session.status === "completed" || session.status === "failed" ||
      session.status === "cancelled"
    ) {
      throw new RunNotActiveError(runId);
    }

    if (!session.waitingState) {
      if (!session.preparedWaitKeys.has(input.waitKey)) {
        throw new WaitNotPendingError(runId, input.waitKey);
      }

      session.submittedValues.set(input.waitKey, normalized);
      this.touchSession(session);
      return { accepted: true };
    }

    if (session.waitingState.waitKey !== input.waitKey) {
      throw new WaitNotPendingError(runId, input.waitKey);
    }

    session.submittedValues.set(input.waitKey, normalized);
    this.touchSession(session);
    session.waitingState.resolve(normalized);
    return { accepted: true };
  }

  /**
   * Cancel a run this process already owns.
   *
   * In-process callers reach this with a run id they are already executing (a
   * session or waiting timeout, stream teardown, `reset`). It deliberately
   * cannot create a delayed-start cancellation tombstone: a tombstone rejects a
   * start that has not happened yet, so an unknown run id must never reach it
   * without verified authority. Remote control goes through
   * `cancelRunWithAuthority`.
   */
  cancelRun(runId: string): boolean {
    return this.cancelRunById(runId, {});
  }

  /**
   * Cancel a run, and remember the cancellation for a delayed start, on behalf
   * of a remote caller whose authority over this exact run was verified.
   *
   * The run id comes out of the authority rather than from a separate argument,
   * so a caller holding authority for one run cannot direct the effect at
   * another. This is the only path to the tombstone.
   */
  cancelRunWithAuthority(
    authority: VerifiedRunControlAuthority,
    options: {
      /**
       * Remember the cancellation so any delayed start is refused (default).
       * `false` for an integration-auth park, whose resume must be able to start
       * the same run again: with `onlyIfStartedBeforeEventId` only delayed starts
       * of the parked generation are refused, and without it nothing is
       * remembered.
       */
      rememberCancellation?: boolean;
      /**
       * Cancel only a session dispatched from before this durable event id. An
       * integration-auth park names the event it settled at, so a late or retried
       * park cancel cannot stop the resumed start that reused the run id.
       */
      onlyIfStartedBeforeEventId?: number;
    } = {},
  ): boolean {
    const runId = assertRunControlAuthority(authority, "cancel");
    return this.cancelRunById(runId, {
      remember: options.rememberCancellation !== false
        ? {}
        : options.onlyIfStartedBeforeEventId !== undefined
        ? { refusesStartsBeforeEventId: options.onlyIfStartedBeforeEventId }
        : undefined,
      onlyIfStartedBeforeEventId: options.onlyIfStartedBeforeEventId,
    });
  }

  /**
   * Deliver a resume signal on behalf of a remote caller whose authority over
   * this exact run was verified. The run id comes out of the authority.
   */
  submitSignalWithAuthority(
    authority: VerifiedRunControlAuthority,
    input: { waitKey: string; value: T },
  ): SubmitResumeValueOutcome {
    const runId = assertRunControlAuthority(authority, "resume");
    return this.submitSignal(runId, input);
  }

  private cancelRunById(
    runId: string,
    options: {
      remember?: { refusesStartsBeforeEventId?: number };
      onlyIfStartedBeforeEventId?: number;
    },
  ): boolean {
    // Remembered whether or not a session is found: the start this refuses may
    // still be on its way, and may arrive after a newer generation has finished.
    if (options.remember) {
      this.rememberCancellation(runId, options.remember.refusesStartsBeforeEventId);
    }

    const session = this.sessions.get(runId);
    if (
      session && options.onlyIfStartedBeforeEventId !== undefined &&
      session.startedFromEventId !== undefined &&
      session.startedFromEventId >= options.onlyIfStartedBeforeEventId
    ) {
      return false;
    }
    if (!session) {
      return false;
    }

    if (
      session.status === "completed" || session.status === "failed" ||
      session.status === "cancelled"
    ) {
      return false;
    }

    const waitingState = session.waitingState;
    // Abort with an AbortError-shaped DOMException so provider SDK fetch
    // consumers treat it as cancellation and don't surface unhandled
    // rejections. The waiting-state reject path keeps RunCancelledError
    // so callers can still `instanceof` it.
    session.abortController.abort(new DOMException("Run cancelled", "AbortError"));
    waitingState?.reject(new RunCancelledError());
    this.finalizeSession(session, "cancelled");
    return true;
  }

  /**
   * Finalize a run as completed. Pass the signal `startRun` returned so a stale
   * execution cannot finalize a newer session started under the same run id,
   * such as the resume of a run whose parked turn settled late.
   */
  completeRun(runId: string, signal?: AbortSignal): void {
    this.forgetSettledCancellation(runId, signal);
    const session = this.getOwnedSession(runId, signal);
    if (!session) return;
    this.finalizeSession(session, "completed");
  }

  /** Finalize a run as failed; see {@link completeRun} for `signal`. */
  failRun(runId: string, signal?: AbortSignal): void {
    this.forgetSettledCancellation(runId, signal);
    const session = this.getOwnedSession(runId, signal);
    if (!session) return;
    this.finalizeSession(session, "failed");
  }

  /**
   * Whether a newer session now owns the run id of the execution holding
   * `signal`. A run whose own session simply ended is not superseded; one whose
   * id was reused by a later start, such as the resume of a parked run, is,
   * even after that later session has finished and left the manager.
   */
  isSupersededRun(runId: string, signal: AbortSignal): boolean {
    if (this.supersededSignals.has(signal)) return true;
    const session = this.sessions.get(runId);
    return session !== undefined && session.abortController.signal !== signal;
  }

  private getOwnedSession(runId: string, signal?: AbortSignal): RunSession<T> | undefined {
    const session = this.sessions.get(runId);
    if (!session) return undefined;
    if (signal && session.abortController.signal !== signal) return undefined;
    return session;
  }

  getRunStatus(runId: string): RunSessionStatus | null {
    return this.sessions.get(runId)?.status ?? null;
  }

  reset(): void {
    for (const runId of [...this.sessions.keys()]) {
      this.cancelRun(runId);
    }
    this.sessions.clear();
    this.cancellationTombstones.clear();
    this.settlingCancelledSignals.clear();
  }
}
