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

export { RunNotActiveError };

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

export class AgentRunCancelledError extends RunCancelledError {
  constructor(message = "Run cancelled") {
    super(message);
    this.name = "AgentRunCancelledError";
  }
}

export class AgentRunAlreadyExistsError extends RunAlreadyExistsError {
  constructor(runId: string) {
    super(runId);
    this.name = "AgentRunAlreadyExistsError";
  }
}

export class ToolResultNotWaitingError extends WaitNotPendingError {
  constructor(runId: string, toolCallId: string) {
    super(runId, toolCallId);
    this.name = "ToolResultNotWaitingError";
  }
}

export class ToolResultConflictError extends WaitConflictError {
  constructor(runId: string, toolCallId: string) {
    super(runId, toolCallId);
    this.name = "ToolResultConflictError";
  }
}

const DEFAULT_WAITING_FOR_TOOL_TTL_MS = 5 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 15 * 60 * 1000;
const AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY = "__veryfrontAgentRunSessionManager" as const;

interface SubmittedToolResult {
  result: unknown;
  isError: boolean;
  key: string;
}
export type SessionStatus = RunSessionStatus;
export type SubmitToolResultOutcome = SubmitResumeValueOutcome;

export class AgentRunSessionManager {
  private readonly sessions: RunResumeSessionManager<SubmittedToolResult>;

  constructor(
    private readonly options: {
      waitingForToolTtlMs?: number;
      sessionTtlMs?: number | null;
      maxConcurrentSessions?: number;
      setTimeoutFn?: typeof setTimeout;
      clearTimeoutFn?: typeof clearTimeout;
    } = {},
  ) {
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

  private getSessionKey(runId: string, scopeId: string | undefined): string {
    if (scopeId === undefined) {
      return `unscoped:${runId}`;
    }
    if (scopeId.length === 0) {
      throw new TypeError("Agent run session scope must not be empty");
    }
    return `scoped:${scopeId.length}:${scopeId}:${runId}`;
  }

  startRun(input: { runId: string; threadId: string; scopeId?: string }): AbortSignal {
    const sessionKey = this.getSessionKey(input.runId, input.scopeId);
    try {
      return this.sessions.startRun({
        runId: sessionKey,
        threadId: input.threadId,
      });
    } catch (error) {
      if (error instanceof RunAlreadyExistsError) {
        throw new AgentRunAlreadyExistsError(input.runId);
      }
      throw error;
    }
  }

  async waitForToolResult(runId: string, toolCallId: string, scopeId?: string): Promise<{
    result: unknown;
    isError: boolean;
  }> {
    const sessionKey = this.getSessionKey(runId, scopeId);
    try {
      const value = await this.sessions.waitForSignal(sessionKey, toolCallId);
      return { result: value.result, isError: value.isError };
    } catch (error) {
      if (error instanceof RunCancelledError) {
        throw new AgentRunCancelledError();
      }
      if (error instanceof WaitNotPendingError) {
        throw new ToolResultNotWaitingError(runId, toolCallId);
      }
      if (error instanceof RunNotActiveError) {
        throw new RunNotActiveError(runId);
      }
      throw error;
    }
  }

  prepareForToolResult(runId: string, toolCallId: string, scopeId?: string): void {
    try {
      this.sessions.prepareForSignal(this.getSessionKey(runId, scopeId), toolCallId);
    } catch (error) {
      if (error instanceof RunNotActiveError) {
        throw new RunNotActiveError(runId);
      }
      throw error;
    }
  }

  submitToolResult(
    runId: string,
    input: { toolCallId: string; result: unknown; isError?: boolean },
    scopeId?: string,
  ): SubmitToolResultOutcome {
    const normalized: SubmittedToolResult = {
      result: input.result,
      isError: Boolean(input.isError),
      key: createToolResultKey(input.result, Boolean(input.isError)),
    };

    try {
      return this.sessions.submitSignal(this.getSessionKey(runId, scopeId), {
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
      if (error instanceof RunNotActiveError) {
        throw new RunNotActiveError(runId);
      }
      throw error;
    }
  }

  cancelRun(runId: string, scopeId?: string): boolean {
    return this.sessions.cancelRun(this.getSessionKey(runId, scopeId));
  }

  completeRun(runId: string, scopeId?: string): void {
    this.sessions.completeRun(this.getSessionKey(runId, scopeId));
  }

  failRun(runId: string, scopeId?: string): void {
    this.sessions.failRun(this.getSessionKey(runId, scopeId));
  }

  getRunStatus(runId: string, scopeId?: string): SessionStatus | null {
    return this.sessions.getRunStatus(this.getSessionKey(runId, scopeId));
  }

  reset(): void {
    this.sessions.reset();
  }
}

type AgentRunSessionManagerGlobal = typeof globalThis & {
  [AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY]?: AgentRunSessionManager;
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

export function _resetGlobalAgentRunSessionManagerForTesting(): void {
  const runtimeGlobal = globalThis as AgentRunSessionManagerGlobal;
  runtimeGlobal[AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY]?.reset();
  delete runtimeGlobal[AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY];
}

export const agentRunSessionManager = getGlobalAgentRunSessionManager();
