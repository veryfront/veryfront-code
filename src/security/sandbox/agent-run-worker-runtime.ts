import type { Agent } from "#veryfront/agent";
import { createRuntimeAgentFromMarkdownDefinition } from "#veryfront/agent/runtime/agent-markdown-adapter.ts";
import { agentRegistry } from "#veryfront/agent/composition/index.ts";
import { getDiscoveredHostTools } from "#veryfront/agent/hosted/veryfront-cloud-agent-service.ts";
import { discoverAll } from "#veryfront/discovery/discovery-engine.ts";
import type { DiscoveryConfig, DiscoveryResult } from "#veryfront/discovery/types.ts";
import {
  createRuntimeAgentStreamResponse,
  type RuntimeAgentStreamExecutionDeps,
} from "#veryfront/internal-agents/run-stream.ts";
import {
  AgentRunSessionManager,
  RunNotActiveError,
  ToolResultConflictError,
  ToolResultNotWaitingError,
} from "#veryfront/internal-agents/session-manager.ts";
import {
  type RuntimeRunAgentInput,
  toRuntimeRunAgentInput,
} from "#veryfront/internal-agents/schema.ts";
import {
  sanitizeRuntimeRunAgentInput,
  withVeryfrontPlatformRemoteTools,
  withVeryfrontStudioRemoteTools,
} from "#veryfront/internal-agents/runtime-agent-request-preparation.ts";
import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-extensions.ts";
import {
  AGENT_RUN_WORKER_MAX_CREDIT_BYTES,
  AGENT_RUN_WORKER_MAX_FRAME_BYTES,
  AGENT_RUN_WORKER_MAX_TOTAL_OUTPUT_BYTES,
  type AgentRunExecutionBundle,
  type AgentRunWorkerControlCommand,
  type AgentRunWorkerControlResult,
  type AgentRunWorkerEvent,
  assertValidAgentRunWorkerControlCommand,
  verifyAgentRunExecutionBundleSource,
} from "./agent-run-worker-contract.ts";
import type { ExecuteAgentRunRequest } from "./worker-types.ts";
import { createProjectSnapshotFileSystem } from "./project-source-snapshot.ts";
import { createAgentRunDiscoveryModuleImporter } from "./agent-run-discovery-module-loader.ts";
import {
  runWithWorkerSourceIntegrationPolicy,
  withWorkerProjectEnv,
} from "./worker-runtime-context.ts";

const MAX_REMEMBERED_CONTROL_COMMANDS = 1_024;
const MAX_REMEMBERED_CREDIT_COMMANDS = 4_096;

type TerminalStatus = "completed" | "cancelled" | "failed";
type EmitAgentRunWorkerEvent = (
  event: AgentRunWorkerEvent,
  transfer?: Transferable[],
) => void;

interface ActiveAgentRun {
  requestId: string;
  bundle: AgentRunExecutionBundle;
  reader: ReadableStreamDefaultReader<Uint8Array>;
  creditBytes: number;
  totalOutputBytes: number;
  detached: boolean;
  finished: boolean;
  releaseCreditWait?: () => void;
  terminal: Promise<TerminalStatus>;
}

export interface AgentRunWorkerRuntimeDeps {
  discover(config: DiscoveryConfig): Promise<DiscoveryResult>;
  getAgent(agentId: string): Agent | undefined;
  getLocalTools(agentId: string): RuntimeAgentStreamExecutionDeps["localTools"];
  createRuntimeInput(bundle: AgentRunExecutionBundle): RuntimeRunAgentInput;
  createRuntimeResponse(
    input: RuntimeRunAgentInput,
    agent: Agent,
    deps: RuntimeAgentStreamExecutionDeps,
  ): Promise<Response>;
}

class TrackingAgentRunSessionManager extends AgentRunSessionManager {
  private readonly terminal = new Map<
    string,
    { promise: Promise<TerminalStatus>; resolve: (status: TerminalStatus) => void }
  >();

  track(runId: string): Promise<TerminalStatus> {
    const existing = this.terminal.get(runId);
    if (existing) return existing.promise;
    let resolve!: (status: TerminalStatus) => void;
    const promise = new Promise<TerminalStatus>((accept) => {
      resolve = accept;
    });
    this.terminal.set(runId, { promise, resolve });
    return promise;
  }

  private settle(runId: string, status: TerminalStatus): void {
    this.terminal.get(runId)?.resolve(status);
  }

  override cancelRun(runId: string): boolean {
    const cancelled = super.cancelRun(runId);
    if (cancelled) this.settle(runId, "cancelled");
    return cancelled;
  }

  override completeRun(runId: string): void {
    super.completeRun(runId);
    this.settle(runId, "completed");
  }

  override failRun(runId: string): void {
    super.failRun(runId);
    this.settle(runId, "failed");
  }
}

const defaultDeps: AgentRunWorkerRuntimeDeps = {
  discover: discoverAll,
  getAgent: (agentId) => agentRegistry.get(agentId),
  getLocalTools: (agentId) =>
    getDiscoveredHostTools({ agentId }) as RuntimeAgentStreamExecutionDeps["localTools"],
  createRuntimeInput: (bundle) =>
    sanitizeRuntimeRunAgentInput(toRuntimeRunAgentInput(bundle.request)),
  createRuntimeResponse: createRuntimeAgentStreamResponse,
};

function operationForCommand(
  command: Exclude<AgentRunWorkerControlCommand, { type: "agent-stream-credit" }>,
): "resume" | "cancel" | "detach" {
  if (command.type === "agent-run-resume") return "resume";
  if (command.type === "agent-run-cancel") return "cancel";
  return "detach";
}

function assertExecutionRequest(request: ExecuteAgentRunRequest): void {
  if (
    !request || request.type !== "execute-agent-run" || typeof request.id !== "string" ||
    request.id.length === 0 || request.id.length > 128
  ) {
    throw new TypeError("Agent run execution request is invalid");
  }
  if (
    !Number.isSafeInteger(request.initialCreditBytes) || request.initialCreditBytes <= 0 ||
    request.initialCreditBytes > AGENT_RUN_WORKER_MAX_CREDIT_BYTES
  ) {
    throw new RangeError("Agent run initial stream credit is invalid");
  }
}

/** Owns one streaming agent run inside a fresh, non-reused project Worker. */
export class AgentRunWorkerRuntime {
  private readonly sessionManager = new TrackingAgentRunSessionManager({
    maxConcurrentSessions: 1,
  });
  private readonly controlResults = new Map<string, AgentRunWorkerControlResult>();
  private readonly creditCommands = new Set<string>();
  private active: ActiveAgentRun | null = null;
  private executionAccepted = false;

  constructor(private readonly deps: AgentRunWorkerRuntimeDeps = defaultDeps) {}

  async execute(
    request: ExecuteAgentRunRequest,
    emit: EmitAgentRunWorkerEvent,
  ): Promise<void> {
    let runId = "unknown";
    try {
      assertExecutionRequest(request);
      runId = request.bundle.run.runId;
      if (this.executionAccepted) throw new TypeError("Agent run Worker cannot be reused");
      this.executionAccepted = true;
      await verifyAgentRunExecutionBundleSource(request.bundle);
    } catch {
      emit({
        type: "agent-stream-error",
        id: request?.id ?? "invalid",
        runId,
        errorCode: "INVALID_EXECUTION_BUNDLE",
      });
      return;
    }

    try {
      await withWorkerProjectEnv(request.bundle.projectEnv, async () => {
        await runWithWorkerSourceIntegrationPolicy(
          request.bundle.sourceIntegrationPolicy,
          () => this.startVerifiedRun(request, emit),
        );
      });
    } catch {
      emit({
        type: "agent-stream-error",
        id: request.id,
        runId,
        errorCode: "EXECUTION_FAILED",
      });
    }
  }

  handleControl(
    command: AgentRunWorkerControlCommand,
    emit: EmitAgentRunWorkerEvent,
  ): void {
    try {
      assertValidAgentRunWorkerControlCommand(command);
    } catch {
      return;
    }

    if (command.type === "agent-stream-credit") {
      this.addCredit(command);
      return;
    }

    const cached = this.controlResults.get(command.commandId);
    if (cached) {
      emit(cached);
      return;
    }
    const result = this.applyControl(command);
    this.rememberControlResult(result);
    emit(result);
  }

  private async startVerifiedRun(
    request: ExecuteAgentRunRequest,
    emit: EmitAgentRunWorkerEvent,
  ): Promise<void> {
    ensureBuiltinSchemaValidator();
    const bundle = request.bundle;
    const fsAdapter = createProjectSnapshotFileSystem(bundle.sourceSnapshot);
    const result = await this.deps.discover({
      baseDir: "",
      fsAdapter,
      moduleImporter: createAgentRunDiscoveryModuleImporter(bundle.discovery.modules),
      agentDirs: bundle.discovery.agentDirs,
      toolDirs: bundle.discovery.toolDirs,
      skillDirs: bundle.discovery.skillDirs,
      resourceDirs: [],
      promptDirs: [],
      workflowDirs: [],
      taskDirs: [],
      scheduleDirs: [],
      webhookDirs: [],
      evalDirs: [],
      verbose: false,
    });
    if (result.errors.length > 0) {
      emit({
        type: "agent-stream-error",
        id: request.id,
        runId: bundle.run.runId,
        errorCode: "DISCOVERY_FAILED",
      });
      return;
    }

    const discoveredAgent = this.deps.getAgent(bundle.run.agentId);
    if (!discoveredAgent) {
      emit({
        type: "agent-stream-error",
        id: request.id,
        runId: bundle.run.runId,
        errorCode: "AGENT_NOT_FOUND",
      });
      return;
    }

    const runtimeInput = this.deps.createRuntimeInput(bundle);
    const baseAgent = bundle.request.agentConfig
      ? createRuntimeAgentFromMarkdownDefinition(bundle.request.agentConfig)
      : discoveredAgent;
    const platformAgent = await withVeryfrontPlatformRemoteTools({
      agent: baseAgent,
      apiUrl: bundle.framework.apiUrl,
      token: bundle.framework.authToken,
      projectId: bundle.run.projectId,
      availableToolNames: runtimeInput.tools.map((tool) => tool.name),
    });
    const runtimeAgent = await withVeryfrontStudioRemoteTools({
      agent: platformAgent,
      studioMcpUrl: bundle.framework.studioMcpUrl,
      token: bundle.framework.authToken,
      projectId: bundle.run.projectId,
      forwardedProps: runtimeInput.forwardedProps,
      availableToolNames: runtimeInput.tools.map((tool) => tool.name),
      conversationId: runtimeInput.threadId,
    });

    const terminal = this.sessionManager.track(bundle.run.runId);
    const response = await this.deps.createRuntimeResponse(runtimeInput, runtimeAgent, {
      sessionManager: this.sessionManager,
      localTools: this.deps.getLocalTools(runtimeAgent.id),
      projectAgentSandbox: {
        apiUrl: bundle.framework.apiUrl,
        authToken: bundle.framework.authToken,
        projectId: bundle.run.projectId,
      },
    });
    if (!response.body) throw new TypeError("Agent runtime response has no body");

    this.active = {
      requestId: request.id,
      bundle,
      reader: response.body.getReader(),
      creditBytes: request.initialCreditBytes,
      totalOutputBytes: 0,
      detached: false,
      finished: false,
      terminal,
    };
    emit({ type: "agent-stream-started", id: request.id, runId: bundle.run.runId });
    await this.pumpStream(this.active, emit);
  }

  private async pumpStream(
    active: ActiveAgentRun,
    emit: EmitAgentRunWorkerEvent,
  ): Promise<void> {
    let status: TerminalStatus = "failed";
    try {
      while (!active.detached) {
        await this.waitForCredit(active);
        if (active.detached) break;
        const { done, value } = await active.reader.read();
        if (done) break;
        await this.emitChunkFrames(active, value, emit);
      }
      if (active.detached) await active.reader.cancel();
      status = await active.terminal;
    } catch {
      this.sessionManager.failRun(active.bundle.run.runId);
      status = "failed";
    } finally {
      try {
        active.reader.releaseLock();
      } catch {
        // The response stream may already have released its reader.
      }
      this.finish(active, status, emit);
    }
  }

  private async emitChunkFrames(
    active: ActiveAgentRun,
    chunk: Uint8Array,
    emit: EmitAgentRunWorkerEvent,
  ): Promise<void> {
    let offset = 0;
    while (offset < chunk.byteLength && !active.detached) {
      await this.waitForCredit(active);
      if (active.detached) return;
      const frameBytes = Math.min(
        chunk.byteLength - offset,
        AGENT_RUN_WORKER_MAX_FRAME_BYTES,
        active.creditBytes,
      );
      const frame = chunk.slice(offset, offset + frameBytes);
      active.totalOutputBytes += frame.byteLength;
      if (active.totalOutputBytes > AGENT_RUN_WORKER_MAX_TOTAL_OUTPUT_BYTES) {
        throw new RangeError("Agent run output exceeds the Worker byte limit");
      }
      active.creditBytes -= frame.byteLength;
      offset += frame.byteLength;
      emit({
        type: "agent-stream-chunk",
        id: active.requestId,
        runId: active.bundle.run.runId,
        chunk: frame,
      }, [frame.buffer]);
    }
  }

  private waitForCredit(active: ActiveAgentRun): Promise<void> {
    if (active.creditBytes > 0 || active.detached) return Promise.resolve();
    return new Promise<void>((resolve) => {
      active.releaseCreditWait = resolve;
    });
  }

  private addCredit(
    command: Extract<AgentRunWorkerControlCommand, { type: "agent-stream-credit" }>,
  ): void {
    if (this.creditCommands.has(command.commandId)) return;
    this.creditCommands.add(command.commandId);
    while (this.creditCommands.size > MAX_REMEMBERED_CREDIT_COMMANDS) {
      const oldest = this.creditCommands.values().next().value as string | undefined;
      if (!oldest) break;
      this.creditCommands.delete(oldest);
    }
    const active = this.active;
    if (!active || active.bundle.run.runId !== command.runId || active.finished) return;
    if (active.creditBytes + command.bytes > AGENT_RUN_WORKER_MAX_CREDIT_BYTES) return;
    active.creditBytes += command.bytes;
    active.releaseCreditWait?.();
    active.releaseCreditWait = undefined;
  }

  private applyControl(
    command: Exclude<AgentRunWorkerControlCommand, { type: "agent-stream-credit" }>,
  ): AgentRunWorkerControlResult {
    const operation = operationForCommand(command);
    const active = this.active;
    if (!active || active.finished || active.bundle.run.runId !== command.runId) {
      return {
        type: "agent-run-control-result",
        commandId: command.commandId,
        runId: command.runId,
        operation,
        ok: false,
        errorCode: "RUN_NOT_ACTIVE",
      };
    }

    try {
      if (command.type === "agent-run-resume") {
        const outcome = this.sessionManager.submitToolResult(command.runId, {
          toolCallId: command.toolCallId,
          result: command.result,
          isError: command.isError,
        });
        return {
          type: "agent-run-control-result",
          commandId: command.commandId,
          runId: command.runId,
          operation,
          ok: true,
          accepted: outcome.accepted,
          ...(outcome.duplicate ? { duplicate: true } : {}),
        };
      }

      if (command.type === "agent-run-cancel") {
        const accepted = this.sessionManager.cancelRun(command.runId);
        active.releaseCreditWait?.();
        return {
          type: "agent-run-control-result",
          commandId: command.commandId,
          runId: command.runId,
          operation,
          ok: true,
          accepted,
        };
      }

      active.detached = true;
      active.releaseCreditWait?.();
      return {
        type: "agent-run-control-result",
        commandId: command.commandId,
        runId: command.runId,
        operation,
        ok: true,
        accepted: true,
      };
    } catch (error) {
      const errorCode = error instanceof ToolResultConflictError
        ? "TOOL_RESULT_CONFLICT"
        : error instanceof ToolResultNotWaitingError
        ? "TOOL_RESULT_NOT_WAITING"
        : error instanceof RunNotActiveError
        ? "RUN_NOT_ACTIVE"
        : "WORKER_CONTROL_FAILED";
      return {
        type: "agent-run-control-result",
        commandId: command.commandId,
        runId: command.runId,
        operation,
        ok: false,
        errorCode,
      };
    }
  }

  private rememberControlResult(result: AgentRunWorkerControlResult): void {
    this.controlResults.set(result.commandId, result);
    while (this.controlResults.size > MAX_REMEMBERED_CONTROL_COMMANDS) {
      const oldest = this.controlResults.keys().next().value as string | undefined;
      if (!oldest) break;
      this.controlResults.delete(oldest);
    }
  }

  private finish(
    active: ActiveAgentRun,
    status: TerminalStatus,
    emit: EmitAgentRunWorkerEvent,
  ): void {
    if (active.finished) return;
    active.finished = true;
    active.releaseCreditWait?.();
    emit({
      type: "agent-stream-end",
      id: active.requestId,
      runId: active.bundle.run.runId,
      status,
    });
  }
}
