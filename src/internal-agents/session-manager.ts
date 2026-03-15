function stableJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableJsonStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJsonStringify(item)}`);

  return `{${entries.join(",")}}`;
}

function createToolResultKey(result: unknown, isError: boolean): string {
  return `${isError ? "1" : "0"}:${stableJsonStringify(result)}`;
}

export class AgentRunCancelledError extends Error {
  constructor(message = "Run cancelled") {
    super(message);
    this.name = "AgentRunCancelledError";
  }
}

export class AgentRunAlreadyExistsError extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" is already active`);
    this.name = "AgentRunAlreadyExistsError";
  }
}

export class RunNotActiveError extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" is not active`);
    this.name = "RunNotActiveError";
  }
}

export class ToolResultNotWaitingError extends Error {
  constructor(runId: string, toolCallId: string) {
    super(`Run "${runId}" is not waiting for tool call "${toolCallId}"`);
    this.name = "ToolResultNotWaitingError";
  }
}

export class ToolResultConflictError extends Error {
  constructor(runId: string, toolCallId: string) {
    super(`Conflicting tool result for run "${runId}" and tool call "${toolCallId}"`);
    this.name = "ToolResultConflictError";
  }
}

const DEFAULT_WAITING_FOR_TOOL_TTL_MS = 5 * 60 * 1000;

type SessionStatus = "running" | "waiting" | "completed" | "cancelled" | "failed";

interface SubmittedToolResult {
  toolCallId: string;
  result: unknown;
  isError: boolean;
  key: string;
}

interface WaitingToolState {
  toolCallId: string;
  resolve: (value: SubmittedToolResult) => void;
  reject: (reason?: unknown) => void;
}

interface AgentRunSession {
  runId: string;
  threadId: string;
  status: SessionStatus;
  abortController: AbortController;
  waitingTool: WaitingToolState | null;
  submittedResults: Map<string, SubmittedToolResult>;
  waitingTimeoutId: number | null;
}

export interface SubmitToolResultOutcome {
  accepted: true;
  duplicate?: true;
}

export class AgentRunSessionManager {
  private readonly sessions = new Map<string, AgentRunSession>();

  constructor(
    private readonly options: {
      waitingForToolTtlMs?: number;
      setTimeoutFn?: typeof setTimeout;
      clearTimeoutFn?: typeof clearTimeout;
    } = {},
  ) {}

  private get waitingForToolTtlMs(): number {
    return this.options.waitingForToolTtlMs ?? DEFAULT_WAITING_FOR_TOOL_TTL_MS;
  }

  private get setTimeoutFn(): typeof setTimeout {
    return this.options.setTimeoutFn ?? setTimeout;
  }

  private get clearTimeoutFn(): typeof clearTimeout {
    return this.options.clearTimeoutFn ?? clearTimeout;
  }

  private clearWaitingTimeout(session: AgentRunSession): void {
    if (session.waitingTimeoutId === null) {
      return;
    }

    this.clearTimeoutFn(session.waitingTimeoutId);
    session.waitingTimeoutId = null;
  }

  private scheduleWaitingTimeout(session: AgentRunSession): void {
    this.clearWaitingTimeout(session);
    session.waitingTimeoutId = this.setTimeoutFn(() => {
      this.cancelRun(session.runId);
    }, this.waitingForToolTtlMs) as unknown as number;
  }

  startRun(input: { runId: string; threadId: string }): AbortSignal {
    const existing = this.sessions.get(input.runId);
    if (existing && (existing.status === "running" || existing.status === "waiting")) {
      throw new AgentRunAlreadyExistsError(input.runId);
    }

    const session: AgentRunSession = {
      runId: input.runId,
      threadId: input.threadId,
      status: "running",
      abortController: new AbortController(),
      waitingTool: null,
      submittedResults: new Map(),
      waitingTimeoutId: null,
    };

    this.sessions.set(input.runId, session);
    return session.abortController.signal;
  }

  async waitForToolResult(runId: string, toolCallId: string): Promise<{
    result: unknown;
    isError: boolean;
  }> {
    const session = this.sessions.get(runId);
    if (!session || session.status === "completed" || session.status === "failed") {
      throw new RunNotActiveError(runId);
    }

    if (session.abortController.signal.aborted || session.status === "cancelled") {
      throw new AgentRunCancelledError();
    }

    const existingResult = session.submittedResults.get(toolCallId);
    if (existingResult) {
      session.status = "running";
      return { result: existingResult.result, isError: existingResult.isError };
    }

    if (session.waitingTool && session.waitingTool.toolCallId !== toolCallId) {
      throw new ToolResultNotWaitingError(runId, toolCallId);
    }

    session.status = "waiting";
    this.scheduleWaitingTimeout(session);

    return await new Promise<{ result: unknown; isError: boolean }>((resolve, reject) => {
      const abortHandler = () => {
        this.clearWaitingTimeout(session);
        session.waitingTool = null;
        session.status = "cancelled";
        reject(new AgentRunCancelledError());
      };

      session.abortController.signal.addEventListener("abort", abortHandler, { once: true });
      session.waitingTool = {
        toolCallId,
        resolve: (value) => {
          session.abortController.signal.removeEventListener("abort", abortHandler);
          this.clearWaitingTimeout(session);
          session.waitingTool = null;
          session.status = "running";
          resolve({ result: value.result, isError: value.isError });
        },
        reject: (reason) => {
          session.abortController.signal.removeEventListener("abort", abortHandler);
          this.clearWaitingTimeout(session);
          session.waitingTool = null;
          reject(reason);
        },
      };
    });
  }

  submitToolResult(
    runId: string,
    input: { toolCallId: string; result: unknown; isError?: boolean },
  ): SubmitToolResultOutcome {
    const session = this.sessions.get(runId);
    if (!session) {
      throw new RunNotActiveError(runId);
    }

    const normalized: SubmittedToolResult = {
      toolCallId: input.toolCallId,
      result: input.result,
      isError: Boolean(input.isError),
      key: createToolResultKey(input.result, Boolean(input.isError)),
    };

    const existingResult = session.submittedResults.get(input.toolCallId);
    if (existingResult) {
      if (existingResult.key === normalized.key) {
        return { accepted: true, duplicate: true };
      }

      throw new ToolResultConflictError(runId, input.toolCallId);
    }

    if (
      session.status === "completed" || session.status === "failed" ||
      session.status === "cancelled"
    ) {
      throw new RunNotActiveError(runId);
    }

    if (!session.waitingTool || session.waitingTool.toolCallId !== input.toolCallId) {
      throw new ToolResultNotWaitingError(runId, input.toolCallId);
    }

    session.submittedResults.set(input.toolCallId, normalized);
    session.waitingTool.resolve(normalized);
    return { accepted: true };
  }

  cancelRun(runId: string): boolean {
    const session = this.sessions.get(runId);
    if (!session) {
      return false;
    }

    if (
      session.status === "completed" || session.status === "failed" ||
      session.status === "cancelled"
    ) {
      return false;
    }

    session.status = "cancelled";
    this.clearWaitingTimeout(session);
    session.abortController.abort(new AgentRunCancelledError());
    session.waitingTool?.reject(new AgentRunCancelledError());
    session.waitingTool = null;
    this.sessions.delete(runId);
    return true;
  }

  completeRun(runId: string): void {
    const session = this.sessions.get(runId);
    if (!session) return;
    session.status = "completed";
    this.clearWaitingTimeout(session);
    session.waitingTool = null;
    this.sessions.delete(runId);
  }

  failRun(runId: string): void {
    const session = this.sessions.get(runId);
    if (!session) return;
    session.status = "failed";
    this.clearWaitingTimeout(session);
    session.waitingTool = null;
    this.sessions.delete(runId);
  }

  getRunStatus(runId: string): SessionStatus | null {
    return this.sessions.get(runId)?.status ?? null;
  }

  reset(): void {
    this.sessions.clear();
  }
}

export const agentRunSessionManager = new AgentRunSessionManager();
