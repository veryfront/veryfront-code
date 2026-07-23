import {
  RunAlreadyExistsError,
  RunCancelledError,
  RunNotActiveError,
  RunResumeSessionManager,
  type RunResumeSessionManagerOptions,
  type RunSessionStatus,
  type SubmitResumeValueOutcome,
  WaitConflictError,
  WaitNotPendingError,
} from "#veryfront/agent/runtime/resume-session.ts";

export {
  RunAlreadyExistsError,
  RunCancelledError,
  RunNotActiveError,
  WaitConflictError,
  WaitNotPendingError,
};
export type { RunResumeSessionManagerOptions, RunSessionStatus, SubmitResumeValueOutcome };

function stableJsonStringify(value: unknown, depth = 0): string {
  if (depth > 64) {
    return JSON.stringify(value);
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item, depth + 1)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item, depth + 1)}`);

  return `{${entries.join(",")}}`;
}

function createToolResultKey(result: unknown, isError: boolean): string {
  return `${isError ? "1" : "0"}:${stableJsonStringify(result)}`;
}

/** Raised when an internal agent run is cancelled while waiting for a tool result. */
export class AgentRunCancelledError extends RunCancelledError {
  /** Creates a cancelled agent run error. */
  constructor(message = "Run cancelled") {
    super(message);
    this.name = "AgentRunCancelledError";
  }
}

/** Raised when a run attempts to reuse an active run identifier. */
export class AgentRunAlreadyExistsError extends RunAlreadyExistsError {
  /** Creates an active-run conflict error. */
  constructor(runId: string) {
    super(runId);
    this.message = "Agent run is already active";
    this.name = "AgentRunAlreadyExistsError";
  }
}

/** Raised when a tool result arrives without a matching pending wait. */
export class ToolResultNotWaitingError extends WaitNotPendingError {
  /** Creates a missing tool-result wait error. */
  constructor(runId: string, toolCallId: string) {
    super(runId, toolCallId);
    this.message = "Agent run is not waiting for this tool result";
    this.name = "ToolResultNotWaitingError";
  }
}

/** Raised when a tool call receives a conflicting repeated result. */
export class ToolResultConflictError extends WaitConflictError {
  /** Creates a conflicting tool-result error. */
  constructor(runId: string, toolCallId: string) {
    super(runId, toolCallId);
    this.message = "Conflicting tool result for agent run";
    this.name = "ToolResultConflictError";
  }
}

const DEFAULT_WAITING_FOR_TOOL_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;
const AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY = Symbol.for(
  "veryfront.internal-agents.agent-run-session-manager",
);

function validatePositiveSafeInteger(name: string, value: number | null | undefined): void {
  if (value === undefined || value === null) return;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

interface SubmittedToolResult {
  result: unknown;
  isError: boolean;
  key: string;
}
/** Lifecycle status of an internal agent run session. */
export type SessionStatus = RunSessionStatus;
/** Result of submitting a tool result to a waiting run. */
export type SubmitToolResultOutcome = SubmitResumeValueOutcome;

/** Coordinates active internal agent runs and resumable tool-result waits. */
export class AgentRunSessionManager {
  private readonly sessions: RunResumeSessionManager<SubmittedToolResult>;

  /** Creates an isolated agent run session manager. */
  constructor(
    private readonly options: {
      waitingForToolTtlMs?: number;
      sessionTtlMs?: number | null;
      maxConcurrentSessions?: number;
      setTimeoutFn?: typeof setTimeout;
      clearTimeoutFn?: typeof clearTimeout;
    } = {},
  ) {
    validatePositiveSafeInteger("waitingForToolTtlMs", this.options.waitingForToolTtlMs);
    validatePositiveSafeInteger("sessionTtlMs", this.options.sessionTtlMs);
    validatePositiveSafeInteger("maxConcurrentSessions", this.options.maxConcurrentSessions);
    const managerOptions: RunResumeSessionManagerOptions<SubmittedToolResult> = {
      waitingTtlMs: this.options.waitingForToolTtlMs ?? DEFAULT_WAITING_FOR_TOOL_TTL_MS,
      sessionTtlMs: this.options.sessionTtlMs ?? null,
      maxConcurrentSessions: this.options.maxConcurrentSessions,
      setTimeoutFn: this.options.setTimeoutFn,
      clearTimeoutFn: this.options.clearTimeoutFn,
      getConflictKey: (value) => value.key,
    };
    this.sessions = new RunResumeSessionManager(managerOptions);
  }

  /** Starts a run and returns the signal used to cancel its runtime work. */
  startRun(input: { runId: string; threadId: string }): AbortSignal {
    try {
      return this.sessions.startRun(input);
    } catch (error) {
      if (error instanceof RunAlreadyExistsError) {
        throw new AgentRunAlreadyExistsError(input.runId);
      }
      throw error;
    }
  }

  /** Waits for the result associated with one prepared tool call. */
  async waitForToolResult(runId: string, toolCallId: string): Promise<{
    result: unknown;
    isError: boolean;
  }> {
    try {
      const value = await this.sessions.waitForSignal(runId, toolCallId);
      return { result: value.result, isError: value.isError };
    } catch (error) {
      if (error instanceof RunCancelledError) {
        throw new AgentRunCancelledError();
      }
      if (error instanceof WaitNotPendingError) {
        throw new ToolResultNotWaitingError(runId, toolCallId);
      }
      throw error;
    }
  }

  /** Registers that a tool call can accept a result. */
  prepareForToolResult(runId: string, toolCallId: string): void {
    this.sessions.prepareForSignal(runId, toolCallId);
  }

  /** Submits a tool result and reports whether it was accepted or duplicated. */
  submitToolResult(
    runId: string,
    input: { toolCallId: string; result: unknown; isError?: boolean },
  ): SubmitToolResultOutcome {
    const normalized: SubmittedToolResult = {
      result: input.result,
      isError: Boolean(input.isError),
      key: createToolResultKey(input.result, Boolean(input.isError)),
    };

    try {
      return this.sessions.submitSignal(runId, {
        waitKey: input.toolCallId,
        value: normalized,
      });
    } catch (error) {
      if (error instanceof WaitConflictError) {
        throw new ToolResultConflictError(runId, input.toolCallId);
      }
      if (error instanceof WaitNotPendingError) {
        throw new ToolResultNotWaitingError(runId, input.toolCallId);
      }
      throw error;
    }
  }

  /** Cancels an active run and rejects any pending tool wait. */
  cancelRun(runId: string): boolean {
    return this.sessions.cancelRun(runId);
  }

  /** Marks a run completed and releases its session. */
  completeRun(runId: string): void {
    this.sessions.completeRun(runId);
  }

  /** Marks a run failed and releases its session. */
  failRun(runId: string): void {
    this.sessions.failRun(runId);
  }

  /** Returns the current run status, or null when no session exists. */
  getRunStatus(runId: string): SessionStatus | null {
    return this.sessions.getRunStatus(runId);
  }

  /** Cancels all active runs and clears all session state. */
  reset(): void {
    this.sessions.reset();
  }
}

type AgentRunSessionManagerGlobal = typeof globalThis & {
  [key: symbol]: AgentRunSessionManager | undefined;
};

function getGlobalAgentRunSessionManager(): AgentRunSessionManager {
  const runtimeGlobal = globalThis as AgentRunSessionManagerGlobal;
  const existing = runtimeGlobal[AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY];
  if (existing) {
    return existing;
  }

  const sessionManager = new AgentRunSessionManager({
    sessionTtlMs: DEFAULT_SESSION_TTL_MS,
  });
  runtimeGlobal[AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY] = sessionManager;
  return sessionManager;
}

/** Removes the process-wide session manager instance for test isolation. */
export function _resetGlobalAgentRunSessionManagerForTesting(): void {
  const runtimeGlobal = globalThis as AgentRunSessionManagerGlobal;
  runtimeGlobal[AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY]?.reset();
  delete runtimeGlobal[AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY];
}

/** Process-wide internal agent run session manager. */
export const agentRunSessionManager: AgentRunSessionManager = getGlobalAgentRunSessionManager();
