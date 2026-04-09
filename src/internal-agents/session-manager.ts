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

  cancelRun(runId: string): boolean {
    return this.sessions.cancelRun(runId);
  }

  completeRun(runId: string): void {
    this.sessions.completeRun(runId);
  }

  failRun(runId: string): void {
    this.sessions.failRun(runId);
  }

  getRunStatus(runId: string): SessionStatus | null {
    return this.sessions.getRunStatus(runId);
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
  delete runtimeGlobal[AGENT_RUN_SESSION_MANAGER_GLOBAL_KEY];
}

export const agentRunSessionManager = getGlobalAgentRunSessionManager();
