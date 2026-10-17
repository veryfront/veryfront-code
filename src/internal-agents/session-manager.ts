import type { createManagedRecoveryWriter } from "./managed-recovery-writer.ts";
import { getBootManagedRecoveryFactory } from "./managed-recovery-runtime-bootstrap.ts";
import { AGENT_ERROR } from "#veryfront/errors";
import {
  getVerifiedControlPlaneRecoveryAdmission,
  type VerifiedControlPlaneRequestClaims,
} from "./control-plane-auth.ts";
import { RecoverySessionOwner } from "./recovery-session-owner.ts";
import type { RecoveryAdmission } from "./recovery-admission-schema.ts";
import type { RecoverySnapshot } from "./recovery-snapshot.ts";

export type ManagedRecoveryOwnerFactory = (input: {
  claims: VerifiedControlPlaneRequestClaims;
  awaitRetiredPreviousOwner: (generation: RecoveryAdmission["generation"]) => Promise<void>;
}) => Promise<
  {
    owner: RecoverySessionOwner;
    snapshot?: unknown;
    writer?: Awaited<ReturnType<typeof createManagedRecoveryWriter>>;
  }
>;

interface ManagedRecoverySession {
  manager: AgentRunSessionManager;
  generation: RecoveryAdmission["generation"];
  signal: AbortSignal;
  retired: Promise<void>;
  settleRetired: () => void;
}

import { RunStopRegistry } from "./run-stop-registry.ts";
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

/**
 * Who served a run's stream, captured from the proxy-authenticated stream request.
 * Direct-to-pod control calls (cancel, resume) bypass the proxy, so this is their only
 * trusted source for the run's release or branch.
 */
export interface RunServingIdentity {
  projectId: string;
  spanAttributes: Record<string, string | number | boolean>;
}
export type SubmitToolResultOutcome = SubmitResumeValueOutcome;

export class AgentRunSessionManager {
  readonly stopRegistry = new RunStopRegistry();
  private readonly managedSessions = new Map<string, ManagedRecoverySession>();
  private readonly acquiringManagedRuns = new Map<string, AbortController>();
  private readonly ordinarySignals = new Map<string, AbortSignal>();
  // Cancellation stops work; only the matching producer finalizer releases capacity.
  private readonly allocatedOrdinarySignals = new Map<AbortSignal, string>();
  private readonly sessions: RunResumeSessionManager<SubmittedToolResult>;
  private readonly servingIdentities = new Map<string, RunServingIdentity>();

  constructor(
    private readonly options: {
      recoveryOwnerFactory?: ManagedRecoveryOwnerFactory;
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

  async startManagedRecoveryRun(input: {
    runId: string;
    threadId: string;
    servingIdentity?: RunServingIdentity;
    claims: VerifiedControlPlaneRequestClaims;
  }): Promise<
    {
      signal: AbortSignal;
      owner: RecoverySessionOwner;
      writer?: Awaited<ReturnType<typeof createManagedRecoveryWriter>>;
      snapshot?: RecoverySnapshot;
      settle: () => void;
    }
  > {
    const factory = this.options.recoveryOwnerFactory;
    const admission = getVerifiedControlPlaneRecoveryAdmission(input.claims);
    if (!factory || !admission || admission.identity.publicRunId !== input.runId) {
      throw new Error("Managed recovery is disabled or lacks verified admission");
    }
    if (this.acquiringManagedRuns.has(input.runId) || this.sessions.getRunStatus(input.runId)) {
      throw new AgentRunAlreadyExistsError(input.runId);
    }
    if (!this.managedSessions.has(input.runId)) this.assertCapacity();
    const acquisition = new AbortController();
    this.acquiringManagedRuns.set(input.runId, acquisition);
    try {
      const acquired = await factory({
        claims: input.claims,
        awaitRetiredPreviousOwner: async (generation) => {
          const previous = this.managedSessions.get(input.runId);
          if (
            !previous || previous.generation.workerId !== generation.workerId ||
            previous.generation.dispatchNonce !== generation.dispatchNonce ||
            previous.generation.transportRecoveryAttempt !== generation.transportRecoveryAttempt
          ) return;
          previous.manager.cancelRun(input.runId);
          // This resolves only after the original stream's producer and cleanup settle.
          await previous.retired;
          if (this.managedSessions.get(input.runId) === previous) {
            this.managedSessions.delete(input.runId);
          }
        },
      });
      if (acquisition.signal.aborted) throw new AgentRunCancelledError();
      const owner = acquired.owner;
      owner.assertAdmittedClaims(input.claims);
      const snapshot = acquired.snapshot === undefined
        ? undefined
        : await owner.validateRestoredSnapshot(acquired.snapshot);
      if (owner.requiresRestoredSnapshot && !snapshot) {
        throw new Error("Managed recovery requires an acknowledged durable snapshot");
      }
      await owner.assertCurrentOwnership();
      if (acquisition.signal.aborted) throw new AgentRunCancelledError();
      if (this.managedSessions.has(input.runId)) throw new AgentRunAlreadyExistsError(input.runId);
      // Each generation gets its own resume-session namespace. Retiring one generation
      // never clears cancellation fences or waiters belonging to another generation.
      const manager = new AgentRunSessionManager({
        ...this.options,
        recoveryOwnerFactory: undefined,
      });
      const signal = manager.startRun(input);
      let settleRetired = () => {};
      const retired = new Promise<void>((resolve) => {
        settleRetired = resolve;
      });
      const session: ManagedRecoverySession = {
        manager,
        signal,
        generation: admission.generation,
        retired,
        settleRetired,
      };
      this.managedSessions.set(input.runId, session);
      return {
        signal,
        owner,
        ...(acquired.writer ? { writer: acquired.writer } : {}),
        ...(snapshot ? { snapshot } : {}),
        settle: () => {
          settleRetired();
          if (
            this.managedSessions.get(input.runId) === session && !manager.getRunStatus(input.runId)
          ) {
            this.managedSessions.delete(input.runId);
          }
        },
      };
    } finally {
      this.acquiringManagedRuns.delete(input.runId);
    }
  }

  private assertCapacity(): void {
    const ordinary = this.allocatedOrdinarySignals.size;
    // An aborted producer still occupies capacity until its cleanup joins.
    const managed = this.managedSessions.size;
    if (
      ordinary + managed + this.acquiringManagedRuns.size >=
        (this.options.maxConcurrentSessions ?? 100)
    ) {
      throw AGENT_ERROR.create({
        detail: `Maximum concurrent sessions (${
          this.options.maxConcurrentSessions ?? 100
        }) reached`,
      });
    }
  }

  startRun(
    input: { runId: string; threadId: string; servingIdentity?: RunServingIdentity },
  ): AbortSignal {
    try {
      if (this.managedSessions.has(input.runId) || this.acquiringManagedRuns.has(input.runId)) {
        throw new AgentRunAlreadyExistsError(input.runId);
      }
      this.assertCapacity();
      const signal = this.sessions.startRun(input);
      this.ordinarySignals.set(input.runId, signal);
      this.allocatedOrdinarySignals.set(signal, input.runId);
      const identity = input.servingIdentity;
      if (identity) {
        this.servingIdentities.set(input.runId, identity);
        // Session and waiting TTLs cancel inside `sessions`, bypassing this wrapper; every
        // cancel aborts the run's signal, so drop the identity then, unless a newer run owns it.
        signal.addEventListener("abort", () => {
          if (this.servingIdentities.get(input.runId) === identity) {
            this.servingIdentities.delete(input.runId);
          }
        }, { once: true });
      } else {
        this.servingIdentities.delete(input.runId);
      }
      return signal;
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
    const managed = this.managedSessions.get(runId);
    if (managed) return managed.manager.waitForToolResult(runId, toolCallId);
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

  prepareForToolResult(runId: string, toolCallId: string): void {
    const managed = this.managedSessions.get(runId);
    if (managed) return managed.manager.prepareForToolResult(runId, toolCallId);
    this.sessions.prepareForSignal(runId, toolCallId);
  }

  submitToolResult(
    runId: string,
    input: { toolCallId: string; result: unknown; isError?: boolean },
  ): SubmitToolResultOutcome {
    const managed = this.managedSessions.get(runId);
    if (managed) return managed.manager.submitToolResult(runId, input);
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

  /** Span attributes of an active run's stream, only when it was served for `projectId`. */
  getServingSpanAttributes(
    runId: string,
    projectId: string | undefined,
  ): RunServingIdentity["spanAttributes"] | undefined {
    const managed = this.managedSessions.get(runId);
    if (managed) return managed.manager.getServingSpanAttributes(runId, projectId);
    const identity = this.servingIdentities.get(runId);
    if (!identity || !this.sessions.getRunStatus(runId)) return undefined;
    return identity.projectId === projectId ? identity.spanAttributes : undefined;
  }

  cancelRun(runId: string, signal?: AbortSignal): boolean {
    const acquisition = !signal ? this.acquiringManagedRuns.get(runId) : undefined;
    acquisition?.abort();
    const managed = this.managedSessions.get(runId);
    if (managed) {
      if (signal && managed.signal !== signal) return false;
      return managed.manager.cancelRun(runId, signal) || acquisition !== undefined;
    }
    if (signal && this.ordinarySignals.has(runId) && this.ordinarySignals.get(runId) !== signal) {
      return false;
    }
    this.servingIdentities.delete(runId);
    return this.sessions.cancelRun(runId) || acquisition !== undefined;
  }

  completeRun(runId: string, signal?: AbortSignal): void {
    const allocated = signal ?? this.ordinarySignals.get(runId);
    if (allocated && this.allocatedOrdinarySignals.get(allocated) === runId) {
      this.allocatedOrdinarySignals.delete(allocated);
    }
    const managed = this.managedSessions.get(runId);
    if (managed) {
      if (signal && managed.signal !== signal) return;
      managed.manager.completeRun(runId, signal);
      return;
    }
    if (signal && this.ordinarySignals.has(runId) && this.ordinarySignals.get(runId) !== signal) {
      return;
    }
    this.ordinarySignals.delete(runId);
    this.servingIdentities.delete(runId);
    this.sessions.completeRun(runId, signal);
  }

  failRun(runId: string, signal?: AbortSignal): void {
    const allocated = signal ?? this.ordinarySignals.get(runId);
    if (allocated && this.allocatedOrdinarySignals.get(allocated) === runId) {
      this.allocatedOrdinarySignals.delete(allocated);
    }
    const managed = this.managedSessions.get(runId);
    if (managed) {
      if (signal && managed.signal !== signal) return;
      managed.manager.failRun(runId, signal);
      return;
    }
    if (signal && this.ordinarySignals.has(runId) && this.ordinarySignals.get(runId) !== signal) {
      return;
    }
    this.ordinarySignals.delete(runId);
    this.servingIdentities.delete(runId);
    this.sessions.failRun(runId, signal);
  }

  getRunStatus(runId: string): SessionStatus | null {
    const managed = this.managedSessions.get(runId);
    return managed ? managed.manager.getRunStatus(runId) : this.sessions.getRunStatus(runId);
  }

  reset(): void {
    for (const session of this.managedSessions.values()) session.manager.reset();
    this.managedSessions.clear();
    for (const acquisition of this.acquiringManagedRuns.values()) acquisition.abort();
    this.allocatedOrdinarySignals.clear();
    this.ordinarySignals.clear();
    this.servingIdentities.clear();
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
    recoveryOwnerFactory: getBootManagedRecoveryFactory(),
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
