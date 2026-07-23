import {
  type AgentRunWorkerControlCommand,
  type AgentRunWorkerControlResult,
  assertValidAgentRunWorkerControlCommand,
  assertValidAgentRunWorkerControlResult,
} from "#veryfront/security/sandbox/agent-run-worker-contract.ts";
import {
  AgentRunAlreadyExistsError,
  RunNotActiveError,
  type SubmitToolResultOutcome,
  ToolResultConflictError,
  ToolResultNotWaitingError,
} from "./session-manager.ts";
import {
  type AgentRunControlBinding,
  AgentRunControlBindingError,
  type AgentRunOwnership,
  type OwnedAgentRunControl,
} from "./run-control.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";

const DEFAULT_MAX_CONCURRENT_AGENT_RUN_WORKERS = 20;
const DEFAULT_CONTROL_TIMEOUT_MS = 10_000;
const DEFAULT_TOMBSTONE_TTL_MS = 60_000;
const DEFAULT_MAX_TOMBSTONES = 1_000;

export interface AgentRunWorkerTransport {
  requestControl(command: AgentRunWorkerControlCommand): Promise<AgentRunWorkerControlResult>;
  terminate(reason: string): void | Promise<void>;
}

interface ActiveAgentRunWorker {
  runId: string;
  binding: AgentRunControlBinding;
  sourceBindingKey?: string;
  transport: AgentRunWorkerTransport;
}

interface AgentRunWorkerTombstone {
  binding: AgentRunControlBinding;
  expiresAt: number;
}

export class AgentRunWorkerCapacityError extends Error {
  constructor() {
    super("Maximum concurrent isolated agent runs reached");
    this.name = "AgentRunWorkerCapacityError";
  }
}

export class AgentRunWorkerUnavailableError extends Error {
  constructor(message = "Isolated agent run worker is unavailable") {
    super(message);
    this.name = "AgentRunWorkerUnavailableError";
  }
}

class AgentRunWorkerControlTimeoutError extends Error {
  constructor() {
    super("Isolated agent run control timed out");
    this.name = "AgentRunWorkerControlTimeoutError";
  }
}

function validatePositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function bindingsMatch(
  left: AgentRunControlBinding,
  right: AgentRunControlBinding,
): boolean {
  return left.projectId === right.projectId && left.projectSlug === right.projectSlug;
}

export class AgentRunWorkerCoordinator implements OwnedAgentRunControl {
  private readonly activeRuns = new Map<string, ActiveAgentRunWorker>();
  private readonly tombstones = new Map<string, AgentRunWorkerTombstone>();
  private readonly maxConcurrentRuns: number;
  private readonly controlTimeoutMs: number;
  private readonly tombstoneTtlMs: number;
  private readonly maxTombstones: number;
  private readonly now: () => number;

  constructor(
    options: {
      maxConcurrentRuns?: number;
      controlTimeoutMs?: number;
      tombstoneTtlMs?: number;
      maxTombstones?: number;
      now?: () => number;
    } = {},
  ) {
    this.maxConcurrentRuns = options.maxConcurrentRuns ??
      DEFAULT_MAX_CONCURRENT_AGENT_RUN_WORKERS;
    this.controlTimeoutMs = options.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS;
    this.tombstoneTtlMs = options.tombstoneTtlMs ?? DEFAULT_TOMBSTONE_TTL_MS;
    this.maxTombstones = options.maxTombstones ?? DEFAULT_MAX_TOMBSTONES;
    this.now = options.now ?? Date.now;
    validatePositiveSafeInteger("maxConcurrentRuns", this.maxConcurrentRuns);
    validatePositiveSafeInteger("controlTimeoutMs", this.controlTimeoutMs);
    validatePositiveSafeInteger("tombstoneTtlMs", this.tombstoneTtlMs);
    validatePositiveSafeInteger("maxTombstones", this.maxTombstones);
  }

  registerRun(input: {
    runId: string;
    binding: AgentRunControlBinding;
    sourceBindingKey?: string;
    transport: AgentRunWorkerTransport;
  }): void {
    this.pruneTombstones();
    if (this.activeRuns.has(input.runId) || this.tombstones.has(input.runId)) {
      throw new AgentRunAlreadyExistsError(input.runId);
    }
    if (this.activeRuns.size >= this.maxConcurrentRuns) {
      throw new AgentRunWorkerCapacityError();
    }
    this.assertBinding(input.binding);
    if (input.sourceBindingKey !== undefined && input.sourceBindingKey.length > 4_096) {
      throw new TypeError("Agent run source binding is invalid");
    }
    this.activeRuns.set(input.runId, {
      runId: input.runId,
      binding: Object.freeze({ ...input.binding }),
      ...(input.sourceBindingKey === undefined ? {} : { sourceBindingKey: input.sourceBindingKey }),
      transport: input.transport,
    });
  }

  getRunOwnership(
    runId: string,
    binding?: AgentRunControlBinding,
  ): AgentRunOwnership {
    this.pruneTombstones();
    const owner = this.activeRuns.get(runId) ?? this.tombstones.get(runId);
    if (!owner) return "absent";
    if (binding && !bindingsMatch(owner.binding, binding)) return "binding-mismatch";
    return "owned";
  }

  async submitToolResult(
    runId: string,
    input: { toolCallId: string; result: unknown; isError?: boolean },
    binding?: AgentRunControlBinding,
  ): Promise<SubmitToolResultOutcome> {
    const active = this.requireActiveRun(runId, binding);
    const command: AgentRunWorkerControlCommand = {
      type: "agent-run-resume",
      commandId: crypto.randomUUID(),
      runId,
      toolCallId: input.toolCallId,
      result: input.result,
      isError: Boolean(input.isError),
    };
    const result = await this.requestControl(active, command);
    if (!result.ok) this.throwControlError(runId, input.toolCallId, result);
    if (result.operation !== "resume") {
      await this.failProtocol(active, "invalid-control-result");
    }
    return {
      accepted: true,
      ...(result.duplicate ? { duplicate: true } : {}),
    };
  }

  async cancelRun(
    runId: string,
    binding?: AgentRunControlBinding,
  ): Promise<boolean> {
    const ownership = this.getRunOwnership(runId, binding);
    if (ownership === "binding-mismatch") throw new AgentRunControlBindingError();
    const active = this.activeRuns.get(runId);
    if (!active) return false;

    const command: AgentRunWorkerControlCommand = {
      type: "agent-run-cancel",
      commandId: crypto.randomUUID(),
      runId,
    };
    const result = await this.requestControl(active, command);
    if (!result.ok && result.errorCode !== "RUN_NOT_ACTIVE") {
      this.throwControlError(runId, "", result);
    }
    if (result.operation !== "cancel") {
      await this.failProtocol(active, "invalid-control-result");
    }
    await this.terminateAndRelease(active, "cancelled");
    return result.ok ? result.accepted : false;
  }

  async detachRun(
    runId: string,
    binding?: AgentRunControlBinding,
  ): Promise<boolean> {
    const active = this.requireActiveRun(runId, binding);
    const command: AgentRunWorkerControlCommand = {
      type: "agent-run-detach",
      commandId: crypto.randomUUID(),
      runId,
    };
    const result = await this.requestControl(active, command);
    if (!result.ok && result.errorCode !== "RUN_NOT_ACTIVE") {
      this.throwControlError(runId, "", result);
    }
    if (result.operation !== "detach") {
      await this.failProtocol(active, "invalid-control-result");
    }
    return result.ok ? result.accepted : false;
  }

  async releaseRun(
    runId: string,
    status: "completed" | "cancelled" | "failed",
  ): Promise<void> {
    const active = this.activeRuns.get(runId);
    if (!active) return;
    await this.terminateAndRelease(active, status);
  }

  async reset(): Promise<void> {
    const active = [...this.activeRuns.values()];
    this.activeRuns.clear();
    this.tombstones.clear();
    await Promise.allSettled(active.map((entry) => entry.transport.terminate("shutdown")));
  }

  private requireActiveRun(
    runId: string,
    binding?: AgentRunControlBinding,
  ): ActiveAgentRunWorker {
    const ownership = this.getRunOwnership(runId, binding);
    if (ownership === "binding-mismatch") throw new AgentRunControlBindingError();
    const active = this.activeRuns.get(runId);
    if (!active) throw new RunNotActiveError(runId);
    return active;
  }

  private async requestControl(
    active: ActiveAgentRunWorker,
    command: AgentRunWorkerControlCommand,
  ): Promise<AgentRunWorkerControlResult> {
    assertValidAgentRunWorkerControlCommand(command);
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(
        () => reject(new AgentRunWorkerControlTimeoutError()),
        this.controlTimeoutMs,
      );
    });
    let result: AgentRunWorkerControlResult;
    try {
      result = await Promise.race([active.transport.requestControl(command), timeout]);
    } catch (error) {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
      const reason = error instanceof AgentRunWorkerControlTimeoutError
        ? "control-timeout"
        : "control-error";
      await this.terminateAndRelease(active, reason);
      throw new AgentRunWorkerUnavailableError(
        error instanceof AgentRunWorkerControlTimeoutError
          ? "Isolated agent run control timed out"
          : undefined,
      );
    }
    if (timeoutId !== undefined) clearTimeout(timeoutId);

    try {
      assertValidAgentRunWorkerControlResult(result);
      if (result.commandId !== command.commandId || result.runId !== command.runId) {
        throw new TypeError("Agent run control result identity is invalid");
      }
    } catch {
      await this.failProtocol(active, "invalid-control-result");
    }
    return result;
  }

  private throwControlError(
    runId: string,
    toolCallId: string,
    result: Extract<AgentRunWorkerControlResult, { ok: false }>,
  ): never {
    switch (result.errorCode) {
      case "RUN_NOT_ACTIVE":
        throw new RunNotActiveError(runId);
      case "TOOL_RESULT_CONFLICT":
        throw new ToolResultConflictError(runId, toolCallId);
      case "TOOL_RESULT_NOT_WAITING":
        throw new ToolResultNotWaitingError(runId, toolCallId);
      default:
        throw new AgentRunWorkerUnavailableError();
    }
  }

  private async failProtocol(active: ActiveAgentRunWorker, reason: string): Promise<never> {
    await this.terminateAndRelease(active, reason);
    throw new AgentRunWorkerUnavailableError("Isolated agent run worker protocol failed");
  }

  private async terminateAndRelease(
    active: ActiveAgentRunWorker,
    reason: string,
  ): Promise<void> {
    const current = this.activeRuns.get(active.runId);
    if (current !== active) return;
    this.activeRuns.delete(active.runId);
    this.addTombstone(active.runId, active.binding);
    try {
      await active.transport.terminate(reason);
    } catch {
      // The coordinator has already revoked ownership. A failed termination
      // cannot make this transport eligible for reuse.
    }
  }

  private addTombstone(runId: string, binding: AgentRunControlBinding): void {
    this.pruneTombstones();
    this.tombstones.set(runId, {
      binding,
      expiresAt: this.now() + this.tombstoneTtlMs,
    });
    while (this.tombstones.size > this.maxTombstones) {
      const oldest = this.tombstones.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.tombstones.delete(oldest);
    }
  }

  private pruneTombstones(): void {
    const now = this.now();
    for (const [runId, tombstone] of this.tombstones) {
      if (tombstone.expiresAt <= now) this.tombstones.delete(runId);
    }
  }

  private assertBinding(binding: AgentRunControlBinding): void {
    if (
      !binding || typeof binding.projectId !== "string" || binding.projectId.length === 0 ||
      binding.projectId.length > 128 || typeof binding.projectSlug !== "string" ||
      binding.projectSlug.length === 0 || binding.projectSlug.length > 255
    ) {
      throw new TypeError("Agent run project binding is invalid");
    }
  }
}

export const agentRunWorkerCoordinator = new AgentRunWorkerCoordinator();

registerProcessStateReset(
  "isolated agent run workers",
  () => agentRunWorkerCoordinator.reset(),
);
