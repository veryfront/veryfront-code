export type RunSessionStatus = "running" | "waiting" | "completed" | "cancelled" | "failed";

export class RunCancelledError extends Error {
  constructor(message = "Run cancelled") {
    super(message);
    this.name = "RunCancelledError";
  }
}

export class RunAlreadyExistsError extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" is already active`);
    this.name = "RunAlreadyExistsError";
  }
}

export class RunNotActiveError extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" is not active`);
    this.name = "RunNotActiveError";
  }
}

export class WaitNotPendingError extends Error {
  constructor(runId: string, waitKey: string) {
    super(`Run "${runId}" is not waiting for "${waitKey}"`);
    this.name = "WaitNotPendingError";
  }
}

export class WaitConflictError extends Error {
  constructor(runId: string, waitKey: string) {
    super(`Conflicting resume value for run "${runId}" and wait key "${waitKey}"`);
    this.name = "WaitConflictError";
  }
}

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
  status: RunSessionStatus;
  abortController: AbortController;
  waitingState: WaitingState<T> | null;
  submittedValues: Map<string, SubmittedValue<T>>;
  waitingTimeoutId: number | null;
  sessionTimeoutId: number | null;
};

const DEFAULT_WAITING_TTL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_CONCURRENT_SESSIONS = 100;

export interface RunResumeSessionManagerOptions<T> {
  waitingTtlMs?: number;
  sessionTtlMs?: number | null;
  maxConcurrentSessions?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
  getConflictKey?: (value: T) => string;
}

function defaultConflictKey(value: unknown): string {
  return JSON.stringify(value);
}

export class RunResumeSessionManager<T> {
  private readonly sessions = new Map<string, RunSession<T>>();

  constructor(
    private readonly options: RunResumeSessionManagerOptions<T> = {},
  ) {}

  private get waitingTtlMs(): number {
    return this.options.waitingTtlMs ?? DEFAULT_WAITING_TTL_MS;
  }

  private get sessionTtlMs(): number | null {
    return this.options.sessionTtlMs ?? null;
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

  private getConflictKey(value: T): string {
    const createConflictKey = this.options.getConflictKey ?? defaultConflictKey;
    return createConflictKey(value);
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
    }, this.sessionTtlMs) as unknown as number;
  }

  private scheduleWaitingTimeout(session: RunSession<T>): void {
    this.clearWaitingTimeout(session);
    session.waitingTimeoutId = this.setTimeoutFn(() => {
      this.cancelRun(session.runId);
    }, this.waitingTtlMs) as unknown as number;
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
    this.sessions.delete(session.runId);
  }

  startRun(input: { runId: string; threadId: string }): AbortSignal {
    const existing = this.sessions.get(input.runId);
    if (existing && (existing.status === "running" || existing.status === "waiting")) {
      throw new RunAlreadyExistsError(input.runId);
    }

    if (this.sessions.size >= this.maxConcurrentSessions) {
      throw new Error(
        `Maximum concurrent sessions (${this.maxConcurrentSessions}) reached`,
      );
    }

    const session: RunSession<T> = {
      runId: input.runId,
      status: "running",
      abortController: new AbortController(),
      waitingState: null,
      submittedValues: new Map(),
      waitingTimeoutId: null,
      sessionTimeoutId: null,
    };

    this.sessions.set(input.runId, session);
    this.touchSession(session);
    return session.abortController.signal;
  }

  async waitForSignal(runId: string, waitKey: string): Promise<T> {
    const session = this.sessions.get(runId);
    if (!session || session.status === "completed" || session.status === "failed") {
      throw new RunNotActiveError(runId);
    }

    if (session.abortController.signal.aborted || session.status === "cancelled") {
      throw new RunCancelledError();
    }

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

    if (!session.waitingState || session.waitingState.waitKey !== input.waitKey) {
      throw new WaitNotPendingError(runId, input.waitKey);
    }

    session.submittedValues.set(input.waitKey, normalized);
    this.touchSession(session);
    session.waitingState.resolve(normalized);
    return { accepted: true };
  }

  cancelRun(runId: string): boolean {
    const session = this.sessions.get(runId);
    if (!session) return false;

    if (
      session.status === "completed" || session.status === "failed" ||
      session.status === "cancelled"
    ) {
      return false;
    }

    const waitingState = session.waitingState;
    session.abortController.abort(new RunCancelledError());
    waitingState?.reject(new RunCancelledError());
    this.finalizeSession(session, "cancelled");
    return true;
  }

  completeRun(runId: string): void {
    const session = this.sessions.get(runId);
    if (!session) return;
    this.finalizeSession(session, "completed");
  }

  failRun(runId: string): void {
    const session = this.sessions.get(runId);
    if (!session) return;
    this.finalizeSession(session, "failed");
  }

  getRunStatus(runId: string): RunSessionStatus | null {
    return this.sessions.get(runId)?.status ?? null;
  }

  reset(): void {
    for (const session of this.sessions.values()) {
      this.clearWaitingTimeout(session);
      this.clearSessionTimeout(session);
    }
    this.sessions.clear();
  }
}
