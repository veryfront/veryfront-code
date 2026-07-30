/**************************
 * Workflow Client
 *
 * High-level API for interacting with workflows
 **************************/

import { logger as baseLogger } from "#veryfront/utils";
import { INVALID_ARGUMENT, ORCHESTRATION_ERROR } from "#veryfront/errors";
import type {
  PendingApproval,
  RunFilter,
  WaitNodeConfig,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStatus,
} from "../types.ts";
import { parsePositiveDurationWithLabel } from "../types.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import { MemoryBackend } from "../backends/memory.ts";
import {
  reserveWorkflowCancel,
  reserveWorkflowResume,
  reserveWorkflowStart,
  WorkflowExecutor,
  type WorkflowExecutorAdmission,
  type WorkflowExecutorConfig,
  type WorkflowHandle,
} from "../executor/workflow-executor.ts";
import { ApprovalManager, type ApprovalManagerConfig } from "../runtime/approval-manager.ts";
import type { Workflow } from "../dsl/workflow.ts";
import { getOwnRecordValue } from "../executor/dag/context-patch.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  captureWorkflowStaticValue,
  captureWorkflowStringList,
} from "../executor/workflow-definition-snapshot.ts";
import { MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS } from "../limits.ts";

const logger = baseLogger.component("workflow-client");
type WorkflowClientLifecycleState = "open" | "closing" | "closed";
type WorkflowClientReadinessState = "uninitialized" | "ready" | "failed";
export type WorkflowBackendOwnership = "owned" | "borrowed";

interface RawInitializeAttempt {
  readonly promise: Promise<void>;
  settled: boolean;
}

const PERSISTED_WAIT_INPUT_KEYS = new Set([
  "type",
  "message",
  "payload",
  "approvers",
  "timeout",
  "eventName",
]);

function invalidPersistedApprovalWait(detail: string): never {
  throw ORCHESTRATION_ERROR.create({ detail: `Persisted approval wait ${detail}` });
}

function capturePersistedWaitRecord(value: unknown): Record<string, unknown> {
  if (
    typeof value !== "object" || value === null || isProxyWithoutHooks(value) ||
    Array.isArray(value)
  ) {
    return invalidPersistedApprovalWait("must be a plain record");
  }
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype !== null) {
    if (isProxyWithoutHooks(prototype) || Object.getPrototypeOf(prototype) !== null) {
      return invalidPersistedApprovalWait("must be a plain record");
    }
  }

  const keys = Reflect.ownKeys(value);
  if (keys.length > PERSISTED_WAIT_INPUT_KEYS.size) {
    return invalidPersistedApprovalWait("contains unsupported fields");
  }
  const captured = Object.create(null) as Record<string, unknown>;
  for (const key of keys) {
    if (typeof key !== "string" || !PERSISTED_WAIT_INPUT_KEYS.has(key)) {
      return invalidPersistedApprovalWait("contains unsupported fields");
    }
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      return invalidPersistedApprovalWait("fields must be enumerable data properties");
    }
    Object.defineProperty(captured, key, {
      value: descriptor.value,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return captured;
}

function restoreApprovalWaitConfig(value: unknown): WaitNodeConfig | null {
  const input = capturePersistedWaitRecord(value);
  if (input.type !== "approval") return null;

  const message = input.message;
  if (
    message !== undefined &&
    (typeof message !== "string" || message.length > MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS)
  ) {
    throw ORCHESTRATION_ERROR.create({
      detail:
        `Persisted approval wait message must be a string of at most ${MAX_WORKFLOW_DEFINITION_TEXT_CODE_UNITS} code units`,
    });
  }

  let approvers: string[] | undefined;
  let payload: unknown;
  try {
    approvers = captureWorkflowStringList(
      input.approvers,
      "Persisted approval wait approvers",
      { allowUndefined: true, requireNonEmpty: true },
    );
    payload = input.payload === undefined
      ? undefined
      : captureWorkflowStaticValue(input.payload, "Persisted approval wait payload");
  } catch (cause) {
    throw ORCHESTRATION_ERROR.create({
      detail: "Persisted approval wait configuration is invalid",
      cause,
    });
  }

  const timeout = input.timeout;
  if (
    timeout !== undefined &&
    typeof timeout !== "string" &&
    typeof timeout !== "number"
  ) {
    throw ORCHESTRATION_ERROR.create({
      detail: "Persisted approval wait timeout must be a string or number",
    });
  }
  if (timeout !== undefined) {
    try {
      parsePositiveDurationWithLabel(timeout, "Persisted approval wait timeout");
    } catch (cause) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Persisted approval wait timeout is invalid",
        cause,
      });
    }
  }

  return {
    type: "wait",
    waitType: "approval",
    message,
    payload,
    approvers,
    timeout,
  };
}

/** Configuration used by workflow client. */
export interface WorkflowClientConfig {
  /** Backend for persistence (default: MemoryBackend) */
  backend?: WorkflowBackend;
  /** Whether destroy() closes the backend (default: "owned"). */
  backendOwnership?: WorkflowBackendOwnership;
  /** Executor configuration */
  executor?: Partial<WorkflowExecutorConfig>;
  /** Approval manager configuration */
  approval?: Partial<ApprovalManagerConfig>;
  /** Enable debug logging */
  debug?: boolean;
}

/** Implement workflow client. */
export class WorkflowClient {
  private backend: WorkflowBackend;
  private executor: WorkflowExecutor;
  private approvalManager: ApprovalManager;
  private debug: boolean;
  private backendOwnership: WorkflowBackendOwnership;
  private lifecycleState: WorkflowClientLifecycleState = "open";
  private lifecycleAbortController = new AbortController();
  private readinessState: WorkflowClientReadinessState = "uninitialized";
  private readinessError?: unknown;
  private activeOperations = new Set<Promise<unknown>>();
  private initializePromise?: Promise<void>;
  private rawInitializeAttempt?: RawInitializeAttempt;
  private destroyPromise?: Promise<void>;

  constructor(config: WorkflowClientConfig = {}) {
    const backendOwnership = config.backendOwnership ?? "owned";
    if (backendOwnership !== "owned" && backendOwnership !== "borrowed") {
      throw INVALID_ARGUMENT.create({
        detail: 'WorkflowClient backendOwnership must be either "owned" or "borrowed"',
      });
    }
    if (backendOwnership === "borrowed" && config.backend === undefined) {
      throw INVALID_ARGUMENT.create({
        detail: "WorkflowClient borrowed backendOwnership requires an explicit backend",
      });
    }
    this.debug = config.debug ?? false;
    this.backend = config.backend ?? new MemoryBackend({ debug: this.debug });
    this.backendOwnership = backendOwnership;

    const userOnWaiting = config.executor?.onWaiting;

    this.executor = new WorkflowExecutor({
      debug: this.debug,
      ...config.executor,
      // The client owns the persistence boundary. An untyped caller must not
      // be able to split execution from the backend exposed by getRun(),
      // approvals, and destroy() by smuggling a second backend through the
      // nested executor configuration.
      backend: this.backend,
      onWaiting: async (run, nodeId) => {
        const input = getOwnRecordValue(run.nodeStates, nodeId)?.input;

        if (!input) {
          logger.debug("No wait config found for node", { nodeId });
          await userOnWaiting?.(run, nodeId);
          return;
        }

        const waitConfig = restoreApprovalWaitConfig(input);
        if (!waitConfig) {
          await userOnWaiting?.(run, nodeId);
          return;
        }

        try {
          await this.approvalManager.createApproval(run, nodeId, waitConfig, run.context);
          logger.debug("Created approval for node", { nodeId });
        } catch (error) {
          logger.error("Failed to create approval", error);
          throw error;
        }

        await userOnWaiting?.(run, nodeId);
      },
    });

    this.approvalManager = new ApprovalManager({
      debug: this.debug,
      ...config.approval,
      autoStartExpirationChecks: false,
      // These collaborators are framework-owned for the same reason as the
      // executor backend above: decisions and resumes must target the run the
      // client created, regardless of values supplied by untyped callers.
      backend: this.backend,
      executor: this.executor,
    });
  }

  /** Revalidate persistence readiness. Concurrent callers share the current attempt. */
  initialize(): Promise<void> {
    this.assertOpen("initialize workflow persistence");
    return this.startInitializeAttempt();
  }

  private startInitializeAttempt(): Promise<void> {
    if (this.initializePromise) return this.initializePromise;

    let backendAttempt: Promise<void>;
    try {
      backendAttempt = Promise.resolve(this.backend.initialize?.());
    } catch (error) {
      backendAttempt = Promise.reject(error);
    }
    const rawAttempt = backendAttempt.then(() => {
      if (this.lifecycleState === "open") {
        this.readinessState = "ready";
        this.readinessError = undefined;
        this.approvalManager.startExpirationChecks();
      }
    });
    const rawState: RawInitializeAttempt = { promise: rawAttempt, settled: false };
    this.rawInitializeAttempt = rawState;
    // A borrowed backend can outlive this client, so its initializer may settle
    // after client teardown. Always observe the raw promise independently of
    // the client-local close race.
    rawAttempt.then(
      () => {
        rawState.settled = true;
        if (this.rawInitializeAttempt === rawState) {
          this.rawInitializeAttempt = undefined;
        }
      },
      (error) => {
        rawState.settled = true;
        if (this.lifecycleState === "open") {
          this.readinessState = "failed";
          this.readinessError = error;
        }
        if (this.rawInitializeAttempt === rawState) {
          this.rawInitializeAttempt = undefined;
        }
      },
    );

    const closeAttempt = Promise.withResolvers<void>();
    const rejectOnClose = () => {
      closeAttempt.reject(
        this.lifecycleAbortController.signal.reason ??
          ORCHESTRATION_ERROR.create({ detail: "Workflow client is closing" }),
      );
    };
    if (this.lifecycleAbortController.signal.aborted) rejectOnClose();
    else {
      this.lifecycleAbortController.signal.addEventListener("abort", rejectOnClose, {
        once: true,
      });
    }

    const attempt = Promise.race([rawAttempt, closeAttempt.promise]);
    this.initializePromise = attempt;
    this.activeOperations.add(attempt);
    const finish = () => {
      this.lifecycleAbortController.signal.removeEventListener("abort", rejectOnClose);
      this.activeOperations.delete(attempt);
      if (this.initializePromise === attempt) this.initializePromise = undefined;
    };
    attempt.then(
      finish,
      finish,
    );
    return attempt;
  }

  private ensureReady(): Promise<void> {
    if (this.initializePromise) return this.initializePromise;
    if (this.readinessState === "ready") return Promise.resolve();
    if (this.readinessState === "failed") return Promise.reject(this.readinessError);
    return this.startInitializeAttempt();
  }

  register(workflow: Workflow | WorkflowDefinition): void {
    this.assertOpen("register workflows");
    const definition = "definition" in workflow ? workflow.definition : workflow;
    this.executor.register(definition);
    logger.debug("Registered workflow", { workflowId: definition.id });
  }

  registerAll(workflows: Array<Workflow | WorkflowDefinition>): void {
    this.assertOpen("register workflows");
    const definitions = workflows.map((workflow) =>
      "definition" in workflow ? workflow.definition : workflow
    );
    this.executor.registerAll(definitions);
    for (const definition of definitions) {
      logger.debug("Registered workflow", { workflowId: definition.id });
    }
  }

  start<TInput, TOutput = unknown>(
    workflowId: string,
    input: TInput,
    options?: { runId?: string },
  ): Promise<WorkflowHandle<TOutput>> {
    return this.trackExecutorOperation(
      "start a workflow",
      () => reserveWorkflowStart<TInput, TOutput>(this.executor, workflowId, input, options),
    );
  }

  resume(runId: string, expectedWorkerId?: string): Promise<void> {
    return this.trackExecutorOperation(
      "resume a workflow",
      () => reserveWorkflowResume(this.executor, runId, undefined, expectedWorkerId),
    );
  }

  cancel(runId: string): Promise<void> {
    return this.trackExecutorOperation(
      "cancel a workflow",
      () => reserveWorkflowCancel(this.executor, runId),
    );
  }

  getRun(runId: string): Promise<WorkflowRun | null> {
    return this.trackOperation("read a workflow run", () => this.backend.getRun(runId));
  }

  listRuns(filter?: RunFilter): Promise<WorkflowRun[]> {
    return this.trackOperation("list workflow runs", () => this.backend.listRuns(filter ?? {}));
  }

  getRunsByStatus(
    status: WorkflowStatus | WorkflowStatus[],
    limit?: number,
  ): Promise<WorkflowRun[]> {
    return this.trackOperation(
      "list workflow runs",
      () => this.backend.listRuns({ status, limit }),
    );
  }

  getRunsForWorkflow(workflowId: string, limit?: number): Promise<WorkflowRun[]> {
    return this.trackOperation(
      "list workflow runs",
      () => this.backend.listRuns({ workflowId, limit }),
    );
  }

  getPendingApprovals(runId: string): Promise<PendingApproval[]> {
    return this.trackOperation(
      "read pending approvals",
      () => this.approvalManager.getPendingApprovals(runId),
    );
  }

  approve(runId: string, approvalId: string, approver: string, comment?: string): Promise<void> {
    return this.trackOperation(
      "approve a workflow",
      () => this.approvalManager.approve(runId, approvalId, approver, comment),
    );
  }

  reject(runId: string, approvalId: string, approver: string, comment?: string): Promise<void> {
    return this.trackOperation(
      "reject a workflow",
      () => this.approvalManager.reject(runId, approvalId, approver, comment),
    );
  }

  listAllPendingApprovals(filter?: {
    workflowId?: string;
    approver?: string;
  }): Promise<Array<{ runId: string; approval: PendingApproval }>> {
    return this.trackOperation(
      "list pending approvals",
      () => this.approvalManager.listAllPending(filter),
    );
  }

  getBackend(): WorkflowBackend {
    this.assertOpen("access the workflow backend");
    return this.backend;
  }

  getExecutor(): WorkflowExecutor {
    this.assertOpen("access the workflow executor");
    return this.executor;
  }

  getApprovalManager(): ApprovalManager {
    this.assertOpen("access the approval manager");
    return this.approvalManager;
  }

  destroy(): Promise<void> {
    if (this.destroyPromise) return this.destroyPromise;

    if (this.lifecycleState === "open") {
      this.lifecycleState = "closing";
      // Leaked collaborator references must stop admitting mutations at the
      // same synchronous boundary as the client. Readiness cancellation stays
      // deferred by one microtask below so already-settled client operations
      // retain their documented ordering.
      this.approvalManager.stop();
    }

    let executorTeardown: Promise<
      { ok: true } | { ok: false; error: unknown }
    >;
    try {
      // Close executor and handle admission in this same stack. Operations
      // reserved by the client before close retain a one-shot capability and
      // are joined by executor teardown when readiness lets them consume.
      executorTeardown = this.executor.destroy().then(
        () => ({ ok: true as const }),
        (error) => ({ ok: false as const, error }),
      );
    } catch (error) {
      executorTeardown = Promise.resolve({ ok: false, error });
    }

    const attempt = this.performDestroyAttempt(executorTeardown);
    this.destroyPromise = attempt;
    attempt.then(
      () => {},
      () => {
        if (this.destroyPromise === attempt) this.destroyPromise = undefined;
      },
    );
    return attempt;
  }

  private async performDestroyAttempt(
    executorTeardown: Promise<{ ok: true } | { ok: false; error: unknown }>,
  ): Promise<void> {
    const errors: unknown[] = [];
    const initializeAttempt = this.initializePromise;
    const rawInitializeAttempt = this.rawInitializeAttempt;

    // This checkpoint is the close linearization boundary. A readiness
    // reaction already queued by an admitted operation runs first and enters
    // the executor; a genuinely pending initializer has no queued reaction and
    // is rejected by the close gate below. Ready-state operations enter their
    // callback synchronously before destroy() can be called.
    await Promise.resolve();
    this.lifecycleAbortController.abort(
      ORCHESTRATION_ERROR.create({ detail: "Workflow client is closing" }),
    );
    if (initializeAttempt) await Promise.allSettled([initializeAttempt]);

    while (this.activeOperations.size > 0) {
      await Promise.allSettled([...this.activeOperations]);
    }

    try {
      await this.approvalManager.destroy();
    } catch (error) {
      errors.push(error);
    }

    const executorOutcome = await executorTeardown;
    if (!executorOutcome.ok) errors.push(executorOutcome.error);
    if (errors.length > 0) {
      throw new AggregateError(errors, "Failed to destroy workflow client cleanly");
    }

    if (this.backendOwnership === "owned") {
      const backendErrors = await this.destroyOwnedBackend(rawInitializeAttempt);
      if (backendErrors.length > 0) {
        throw new AggregateError(backendErrors, "Failed to destroy workflow client cleanly");
      }
    }

    this.lifecycleState = "closed";
    logger.debug("Destroyed");
  }

  private async destroyOwnedBackend(
    rawInitializeAttempt?: RawInitializeAttempt,
  ): Promise<unknown[]> {
    const errors: unknown[] = [];
    const destroyBackend = async () => {
      try {
        await this.backend.destroy();
      } catch (error) {
        errors.push(error);
      }
    };

    if (rawInitializeAttempt && !rawInitializeAttempt.settled) {
      // Some backends use destroy() to cancel or release a blocked initializer.
      // Initialization may then finish after that provisional teardown and
      // reopen resources, so always follow settlement with a terminal destroy.
      await destroyBackend();
      await Promise.allSettled([rawInitializeAttempt.promise]);
    }
    await destroyBackend();
    return errors;
  }

  private trackExecutorOperation<T>(
    operation: string,
    reserve: () => WorkflowExecutorAdmission<T>,
  ): Promise<T> {
    this.assertOpen(operation);
    let admission: WorkflowExecutorAdmission<T>;
    try {
      admission = reserve();
    } catch (error) {
      return Promise.reject(error);
    }

    try {
      return this.trackOperation(
        operation,
        () => admission.consume(),
        () => admission.release(),
      );
    } catch (error) {
      admission.release();
      throw error;
    }
  }

  private trackOperation<T>(
    operation: string,
    callback: () => Promise<T>,
    onFinish?: () => void,
  ): Promise<T> {
    this.assertOpen(operation);
    const deferred = Promise.withResolvers<T>();
    const promise = deferred.promise;
    this.activeOperations.add(promise);
    const finish = () => {
      this.activeOperations.delete(promise);
      onFinish?.();
    };
    promise.then(
      finish,
      finish,
    );
    try {
      if (this.initializePromise) {
        deferred.resolve(this.initializePromise.then(callback));
      } else if (this.readinessState === "ready") {
        deferred.resolve(callback());
      } else if (this.readinessState === "failed") {
        deferred.reject(this.readinessError);
      } else {
        deferred.resolve(this.ensureReady().then(callback));
      }
    } catch (error) {
      deferred.reject(error);
    }
    return promise;
  }

  private assertOpen(operation: string): void {
    if (this.lifecycleState === "open") return;
    throw ORCHESTRATION_ERROR.create({
      detail: `Cannot ${operation}: workflow client is ${this.lifecycleState}`,
    });
  }
}

/** Create workflow client. */
export function createWorkflowClient(config?: WorkflowClientConfig): WorkflowClient {
  return new WorkflowClient(config);
}
