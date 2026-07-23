import { UNKNOWN_ERROR } from "#veryfront/errors";
import {
  AGENT_RUN_WORKER_MAX_CREDIT_BYTES,
  AGENT_RUN_WORKER_MAX_FRAME_BYTES,
  AGENT_RUN_WORKER_MAX_TOTAL_OUTPUT_BYTES,
  type AgentRunExecutionBundle,
  type AgentRunWorkerControlCommand,
  type AgentRunWorkerControlResult,
  type AgentRunWorkerEvent,
  assertValidAgentRunExecutionBundle,
  assertValidAgentRunWorkerControlCommand,
  assertValidAgentRunWorkerEvent,
} from "./agent-run-worker-contract.ts";
import {
  ProjectWorker,
  type ProjectWorkerOptions,
  type ProjectWorkerProtocolSession,
} from "./project-worker.ts";
import { buildWorkerPermissions } from "./worker-permissions.ts";

const DEFAULT_AGENT_RUN_WORKER_MAX_LIFETIME_MS = 15 * 60 * 1_000;
const INITIAL_STREAM_CREDIT_BYTES = AGENT_RUN_WORKER_MAX_FRAME_BYTES;

type TerminalStatus = "completed" | "cancelled" | "failed";

export class AgentRunWorkerExecutionError extends Error {
  constructor(
    readonly code: Extract<AgentRunWorkerEvent, { type: "agent-stream-error" }>["errorCode"],
  ) {
    super("Isolated agent run failed");
    this.name = "AgentRunWorkerExecutionError";
  }
}

interface AgentRunProjectWorker {
  start(): void;
  openProtocolSession(handler: {
    onMessage(data: unknown): void;
    onClose(error: Error): void;
  }): ProjectWorkerProtocolSession;
  terminate(): void;
}

export interface AgentRunWorkerClientOptions {
  maxLifetimeMs?: number;
  createProjectWorker?: (options: ProjectWorkerOptions) => AgentRunProjectWorker;
  onTerminal?: (status: TerminalStatus) => void | Promise<void>;
}

/**
 * Host-side endpoint for one non-reusable agent execution Worker.
 * It validates every frame, meters byte credit, and owns deterministic teardown.
 */
export class AgentRunWorkerClient {
  private readonly worker: AgentRunProjectWorker;
  private readonly requestId = crypto.randomUUID();
  private readonly runId: string;
  private readonly maxLifetimeMs: number;
  private readonly onTerminal?: AgentRunWorkerClientOptions["onTerminal"];
  private readonly pendingControls = new Map<
    string,
    {
      resolve: (result: AgentRunWorkerControlResult) => void;
      reject: (error: Error) => void;
    }
  >();
  private readonly stream: ReadableStream<Uint8Array>;
  private protocol!: ProjectWorkerProtocolSession;
  private streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  private startResolve!: (response: Response) => void;
  private startReject!: (error: Error) => void;
  private readonly response: Promise<Response>;
  private lifetimeTimer: ReturnType<typeof setTimeout> | undefined;
  private executionSent = false;
  private started = false;
  private startSettled = false;
  private terminal = false;
  private clientAttached = true;
  private outstandingCreditBytes = INITIAL_STREAM_CREDIT_BYTES;
  private totalOutputBytes = 0;

  constructor(
    private readonly bundle: AgentRunExecutionBundle,
    options: AgentRunWorkerClientOptions = {},
  ) {
    assertValidAgentRunExecutionBundle(bundle);
    this.runId = bundle.run.runId;
    this.maxLifetimeMs = options.maxLifetimeMs ?? DEFAULT_AGENT_RUN_WORKER_MAX_LIFETIME_MS;
    if (!Number.isSafeInteger(this.maxLifetimeMs) || this.maxLifetimeMs <= 0) {
      throw new TypeError("Agent run Worker lifetime must be a positive safe integer");
    }
    this.onTerminal = options.onTerminal;
    this.response = new Promise<Response>((resolve, reject) => {
      this.startResolve = resolve;
      this.startReject = reject;
    });
    this.stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.streamController = controller;
      },
      pull: () => {
        if (!this.started) return;
        this.grantCredit(AGENT_RUN_WORKER_MAX_FRAME_BYTES);
      },
      cancel: () => {
        this.clientAttached = false;
        return this.detach();
      },
    }, { highWaterMark: 1 });

    const createProjectWorker = options.createProjectWorker ??
      ((workerOptions: ProjectWorkerOptions) => new ProjectWorker(workerOptions));
    this.worker = createProjectWorker({
      projectId: `agent-run-${crypto.randomUUID()}`,
      permissions: buildWorkerPermissions([], {
        projectEnvKeys: Object.keys(bundle.projectEnv ?? {}),
      }),
      requestTimeoutMs: this.maxLifetimeMs,
    });
    try {
      this.worker.start();
      this.protocol = this.worker.openProtocolSession({
        onMessage: (data) => this.handleMessage(data),
        onClose: (error) => this.fail(error),
      });
    } catch (error) {
      this.worker.terminate();
      throw this.asError(error);
    }
  }

  /** Register ownership before calling this so early control requests cannot bypass routing. */
  start(): Promise<Response> {
    if (this.terminal || this.executionSent) return this.response;
    this.executionSent = true;
    this.lifetimeTimer = setTimeout(() => {
      this.fail(new Error("Isolated agent run exceeded its lifetime limit"));
    }, this.maxLifetimeMs);
    try {
      this.protocol.postMessage({
        type: "execute-agent-run",
        id: this.requestId,
        bundle: this.bundle,
        initialCreditBytes: INITIAL_STREAM_CREDIT_BYTES,
      });
    } catch (error) {
      this.fail(this.asError(error));
    }
    return this.response;
  }

  requestControl(command: AgentRunWorkerControlCommand): Promise<AgentRunWorkerControlResult> {
    assertValidAgentRunWorkerControlCommand(command);
    if (command.type === "agent-stream-credit") {
      return Promise.reject(new TypeError("Stream credit does not produce a control result"));
    }
    if (command.runId !== this.runId || this.terminal) {
      return Promise.reject(new Error("Isolated agent run is not active"));
    }
    if (this.pendingControls.has(command.commandId)) {
      return Promise.reject(new TypeError("Agent run control command is already pending"));
    }
    return new Promise<AgentRunWorkerControlResult>((resolve, reject) => {
      this.pendingControls.set(command.commandId, { resolve, reject });
      try {
        this.protocol.postMessage(command);
      } catch (error) {
        this.pendingControls.delete(command.commandId);
        reject(this.asError(error));
      }
    });
  }

  terminate(_reason = "terminated"): void {
    if (this.terminal) {
      this.closeTransport();
      return;
    }
    this.terminal = true;
    const error = new Error("Isolated agent run Worker terminated");
    this.rejectPending(error);
    if (!this.startSettled) {
      this.startSettled = true;
      this.startReject(error);
    }
    if (this.clientAttached) {
      try {
        this.streamController?.error(error);
      } catch {
        // The consumer may already have released the stream.
      }
    }
    this.closeTransport();
    this.notifyTerminal("failed");
  }

  private handleMessage(value: unknown): void {
    if (this.terminal) return;
    let event: AgentRunWorkerEvent;
    try {
      event = value as AgentRunWorkerEvent;
      assertValidAgentRunWorkerEvent(event);
      if (event.runId !== this.runId) throw new TypeError("Agent run Worker event identity failed");
      if (event.type === "agent-run-control-result") {
        this.handleControlResult(event);
        return;
      }
      if (event.id !== this.requestId) {
        throw new TypeError("Agent run Worker request identity failed");
      }
      this.handleStreamEvent(event);
    } catch {
      this.fail(new Error("Isolated agent run Worker protocol failed"));
    }
  }

  private handleControlResult(result: AgentRunWorkerControlResult): void {
    const pending = this.pendingControls.get(result.commandId);
    if (!pending) throw new TypeError("Agent run Worker returned an unknown control result");
    this.pendingControls.delete(result.commandId);
    pending.resolve(result);
  }

  private handleStreamEvent(
    event: Exclude<AgentRunWorkerEvent, AgentRunWorkerControlResult>,
  ): void {
    if (event.type === "agent-stream-started") {
      if (this.started) throw new TypeError("Agent run Worker started more than once");
      this.started = true;
      this.startSettled = true;
      this.startResolve(
        new Response(this.stream, {
          status: 200,
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache, no-store",
            Connection: "keep-alive",
            "X-Accel-Buffering": "no",
          },
        }),
      );
      return;
    }
    if (!this.started) throw new TypeError("Agent run Worker emitted output before start");
    if (event.type === "agent-stream-chunk") {
      if (event.chunk.byteLength > this.outstandingCreditBytes) {
        throw new RangeError("Agent run Worker exceeded granted stream credit");
      }
      this.outstandingCreditBytes -= event.chunk.byteLength;
      this.totalOutputBytes += event.chunk.byteLength;
      if (this.totalOutputBytes > AGENT_RUN_WORKER_MAX_TOTAL_OUTPUT_BYTES) {
        throw new RangeError("Agent run Worker output exceeded the host byte limit");
      }
      if (this.clientAttached) this.streamController?.enqueue(event.chunk);
      return;
    }
    if (event.type === "agent-stream-error") {
      this.fail(new AgentRunWorkerExecutionError(event.errorCode));
      return;
    }
    this.finish(event.status);
  }

  private grantCredit(bytes: number): void {
    if (this.terminal || !this.started) return;
    const available = AGENT_RUN_WORKER_MAX_CREDIT_BYTES - this.outstandingCreditBytes;
    const granted = Math.min(bytes, available);
    if (granted <= 0) return;
    const command: AgentRunWorkerControlCommand = {
      type: "agent-stream-credit",
      commandId: crypto.randomUUID(),
      runId: this.runId,
      bytes: granted,
    };
    assertValidAgentRunWorkerControlCommand(command);
    this.outstandingCreditBytes += granted;
    try {
      this.protocol.postMessage(command);
    } catch (error) {
      this.outstandingCreditBytes -= granted;
      this.fail(this.asError(error));
    }
  }

  private async detach(): Promise<void> {
    if (this.terminal) return;
    const command: AgentRunWorkerControlCommand = {
      type: "agent-run-detach",
      commandId: crypto.randomUUID(),
      runId: this.runId,
    };
    try {
      const result = await this.requestControl(command);
      if (!result.ok || result.operation !== "detach" || !result.accepted) {
        throw new Error("Isolated agent run detach was rejected");
      }
    } catch (error) {
      this.fail(this.asError(error));
    }
  }

  private finish(status: TerminalStatus): void {
    if (this.terminal) return;
    this.terminal = true;
    this.rejectPending(new Error("Isolated agent run is no longer active"));
    if (!this.startSettled) {
      this.startSettled = true;
      this.startReject(new Error("Isolated agent run ended before streaming started"));
    }
    if (this.clientAttached) {
      try {
        if (status === "failed") {
          this.streamController?.error(new Error("Internal agent stream failed"));
        } else {
          this.streamController?.close();
        }
      } catch {
        // The consumer may already have released the stream.
      }
    }
    this.closeTransport();
    this.notifyTerminal(status);
  }

  private fail(error: Error): void {
    if (this.terminal) return;
    this.terminal = true;
    this.rejectPending(error);
    if (!this.startSettled) {
      this.startSettled = true;
      this.startReject(error);
    }
    if (this.clientAttached) {
      try {
        this.streamController?.error(error);
      } catch {
        // The consumer may already have released the stream.
      }
    }
    this.closeTransport();
    this.notifyTerminal("failed");
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pendingControls.values()) pending.reject(error);
    this.pendingControls.clear();
  }

  private closeTransport(): void {
    if (this.lifetimeTimer !== undefined) clearTimeout(this.lifetimeTimer);
    this.lifetimeTimer = undefined;
    try {
      this.protocol.close();
    } catch {
      // The Worker may already have closed the private port.
    }
    this.worker.terminate();
  }

  private notifyTerminal(status: TerminalStatus): void {
    void Promise.resolve()
      .then(() => this.onTerminal?.(status))
      .catch(() => {
        // Cleanup callbacks cannot keep a non-reusable Worker alive or surface
        // as unhandled promise rejections.
      });
  }

  private asError(error: unknown): Error {
    return error instanceof Error
      ? error
      : UNKNOWN_ERROR.create({ detail: "Isolated agent run Worker failed" });
  }
}
