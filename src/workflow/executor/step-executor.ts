import { AsyncLocalStorage } from "node:async_hooks";
import type { Agent, AgentResponse } from "#veryfront/agent/types.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import {
  type CacheKeyContext,
  runWithCacheKeyContext,
  runWithoutCacheKeyContext,
} from "#veryfront/cache/cache-key-builder.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import {
  AGENT_NOT_FOUND,
  ensureError,
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
  ORCHESTRATION_ERROR,
  RESOURCE_NOT_FOUND,
  TIMEOUT_ERROR,
} from "#veryfront/errors";
import { sleep } from "#veryfront/utils";
import {
  calculateRetryDelay,
  DEFAULT_RETRY_INITIAL_DELAY_MS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  isRetryableWorkflowError,
  retryTelemetryErrorType,
} from "./retry-policy.ts";
import type {
  CapturedTenantContext,
  NodeState,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { parsePositiveDurationWithLabel, validateRetryConfig } from "../types.ts";
import {
  addActiveSpanEvent,
  setActiveSpanAttributes,
} from "#veryfront/observability/tracing/otlp-setup.ts";
import type { BlobStorage } from "../blob/types.ts";

/**
 * AsyncLocalStorage for workflow tenant context.
 * This allows tools and framework utilities to access the current tenant
 * without explicit parameter passing.
 */
const workflowTenantStorage = new AsyncLocalStorage<CapturedTenantContext>();

/**
 * Get the current workflow tenant context.
 * Returns undefined if not executing within a workflow step.
 *
 * This is used by context-aware framework utilities (e.g., the api module)
 * to automatically access project-scoped resources.
 */
export function getWorkflowTenant(): CapturedTenantContext | undefined {
  return workflowTenantStorage.getStore();
}

function cacheKeyContextFromWorkflowTenant(
  tenant: CapturedTenantContext,
): CacheKeyContext | null {
  const mode = tenant.productionMode ? "production" : "preview";

  // Environment sources are mutable and have no immutable version segment.
  // A synthetic "latest" distributed-cache bucket can mix different source
  // snapshots, so these tenants use request context for registry isolation and
  // deliberately skip distributed caching.
  if (mode === "production" && !tenant.releaseId) return null;

  return {
    projectId: tenant.projectId || tenant.projectSlug,
    mode,
    versionId: mode === "production" ? tenant.releaseId! : (tenant.branch || "main"),
  };
}

/**
 * Run a function with workflow tenant context available via AsyncLocalStorage.
 * If tenant is undefined, preserves any existing outer context.
 */
export function runWithWorkflowTenant<T>(
  tenant: CapturedTenantContext | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!tenant) return fn();
  return workflowTenantStorage.run(
    tenant,
    () =>
      runWithRequestContext(
        {
          projectSlug: tenant.projectSlug,
          token: tenant.token,
          projectId: tenant.projectId,
          productionMode: tenant.productionMode,
          releaseId: tenant.releaseId,
          branch: tenant.branch,
          environmentName: tenant.environmentName,
        },
        () => {
          const cacheContext = cacheKeyContextFromWorkflowTenant(tenant);
          return cacheContext
            ? runWithCacheKeyContext(cacheContext, fn)
            : runWithoutCacheKeyContext(fn);
        },
      ),
  );
}

const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 1,
  backoff: "exponential",
  initialDelay: DEFAULT_RETRY_INITIAL_DELAY_MS,
  maxDelay: DEFAULT_RETRY_MAX_DELAY_MS,
};

const DEFAULT_STEP_TIMEOUT_MS = 5 * 60 * 1_000;

/** Time allowed for an aborted operation to finish its cooperative cleanup. */
const DEFAULT_CANCELLATION_GRACE_PERIOD_MS = 1_000;

export interface AgentRegistry {
  get(id: string): Agent | undefined;
  list?(): string[];
}

export interface ToolRegistry {
  get(id: string): Tool | undefined;
  list?(): string[];
}

export interface StepExecutorConfig {
  agentRegistry?: AgentRegistry;
  toolRegistry?: ToolRegistry;
  defaultTimeout?: number;
  /** Max milliseconds to wait for an aborted step to settle before detaching it (default: 1000) */
  cancellationGracePeriod?: number;
  blobStorage?: BlobStorage;
  /** Wrap one agent node including all retries; the continuation executes locally once. */
  runAgentNode?: (invocation: {
    nodeId: string;
    executionPath?: readonly string[];
    runId?: string;
    agentId: string;
    input: unknown;
    signal?: AbortSignal;
    execute: (signal?: AbortSignal) => Promise<StepResult>;
  }) => Promise<StepResult>;
  /**
   * Step lifecycle hooks. `runId` scopes the event to one run: without it a
   * progress channel built on these hooks is process-global and two concurrent
   * runs interleave with no way to tell them apart. It is optional because a
   * StepExecutor can be driven outside a run (tests, ad-hoc execution).
   * A promise returned by onStepStart is acknowledged before execution begins.
   */
  onStepStart?: (nodeId: string, input: unknown, runId?: string) => void;
  onStepComplete?: (nodeId: string, output: unknown, runId?: string) => void;
  onStepError?: (nodeId: string, error: Error, runId?: string) => void;
}

export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
  executionTime: number;
}

/**
 * Build a step's stored output, keeping only the fields that actually have a
 * value.
 *
 * A step's output is written into workflow context, and the durable path
 * persists that context with `JSON.stringify`, which drops every
 * `undefined`-valued key. A response field that is absent -- `toolCalls` and
 * `usage` on a schemaless agent, `object` on one whose schema parsed to
 * `undefined` -- would therefore exist as a key in memory and be gone after a
 * pause/resume, so the same run would present two different context shapes
 * depending on whether it ever suspended.
 *
 * Emitting only defined fields collapses that to one shape: what a step reads
 * in memory is exactly what survives a durable round-trip. Reading an absent
 * field still yields `undefined`, so this is invisible to `ctx.step.usage`; it
 * only makes `"usage" in ctx.step` and `Object.keys(ctx.step)` mean the same
 * thing on both paths.
 */
function buildAgentStepOutput(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, value]) => value !== undefined),
  );
}

export class StepExecutor {
  private config: StepExecutorConfig;
  private nonCooperativeErrors = new WeakSet<Error>();
  private executionOperations = new Map<string, Set<Promise<unknown>>>();

  constructor(config: StepExecutorConfig = {}) {
    this.config = { defaultTimeout: DEFAULT_STEP_TIMEOUT_MS, ...config };
  }

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    abortSignal?: AbortSignal,
    runId?: string,
    executionPath: readonly string[] = [],
  ): Promise<StepResult> {
    return this.executeAttempts(
      node,
      context,
      abortSignal,
      runId,
      Date.now(),
      undefined,
      executionPath,
    );
  }

  private async executeAttempts(
    node: WorkflowNode,
    context: WorkflowContext,
    abortSignal: AbortSignal | undefined,
    runId: string | undefined,
    startTime: number,
    prepared?: { attempt: number; input: unknown; operations: Set<Promise<unknown>> },
    executionPath: readonly string[] = [],
  ): Promise<StepResult> {
    const config = node.config as StepNodeConfig;

    if (config.type !== "step") {
      throw ORCHESTRATION_ERROR.create({
        detail:
          `StepExecutor can only execute 'step' nodes, but node "${node.id}" has type '${config.type}'. ` +
          `This is likely a bug in the DAG executor routing.`,
      });
    }

    const hasAgent = config.agent != null;
    const hasTool = config.tool != null;
    if (hasAgent === hasTool) {
      throw INVALID_ARGUMENT.create({
        detail: `Step "${node.id}" must configure exactly one of 'agent' or 'tool'`,
      });
    }

    if (config.retry) {
      validateRetryConfig(config.retry);
    }

    const timeout = parsePositiveDurationWithLabel(
      config.timeout === undefined
        ? (this.config.defaultTimeout ?? DEFAULT_STEP_TIMEOUT_MS)
        : config.timeout,
      `Step "${node.id}" timeout`,
    );

    const retryConfig = { ...DEFAULT_RETRY, ...config.retry };
    const maxAttempts = retryConfig.maxAttempts ?? 1;

    let lastError: Error | undefined;
    const tenant = context._tenant;

    for (let attempt = prepared?.attempt ?? 1; attempt <= maxAttempts; attempt++) {
      abortSignal?.throwIfAborted();
      let operationCompleted = false;
      let delegatedRetryLoop = false;

      try {
        const outcome = await runWithWorkflowTenant(tenant, async () => {
          const resolvedInput = prepared?.attempt === attempt
            ? prepared.input
            : await this.resolveInput(config.input, context);
          abortSignal?.throwIfAborted();
          if (!prepared && config.agent && this.config.runAgentNode) {
            delegatedRetryLoop = true;
            let entered = false;
            const result = await this.config.runAgentNode({
              nodeId: node.id,
              executionPath,
              runId,
              agentId: typeof config.agent === "string" ? config.agent : config.agent.id,
              input: resolvedInput,
              signal: abortSignal,
              execute: async (signal) => {
                if (entered) {
                  throw ORCHESTRATION_ERROR.create({
                    detail: "Agent node continuation already executed",
                  });
                }
                entered = true;
                const operations = new Set<Promise<unknown>>();
                try {
                  return await this.executeAttempts(
                    node,
                    context,
                    signal && abortSignal
                      ? AbortSignal.any([signal, abortSignal])
                      : signal ?? abortSignal,
                    runId,
                    startTime,
                    {
                      attempt,
                      input: resolvedInput,
                      operations,
                    },
                    executionPath,
                  );
                } finally {
                  await Promise.allSettled([...operations]);
                }
              },
            });
            return { kind: "wrapped" as const, result };
          }
          await this.config.onStepStart?.(node.id, resolvedInput, runId);

          const output = await this.executeWithTimeout(
            (attemptSignal) => this.executeStep(config, resolvedInput, context, attemptSignal),
            timeout,
            node.id,
            abortSignal,
            runId,
            prepared?.operations,
          );
          return { kind: "completed" as const, output };
        });
        if (outcome.kind === "wrapped") return outcome.result;
        const output = outcome.output;
        abortSignal?.throwIfAborted();
        operationCompleted = true;
        setActiveSpanAttributes({ "workflow.node.attempts": attempt });
        this.config.onStepComplete?.(node.id, output, runId);

        return {
          success: true,
          output,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        abortSignal?.throwIfAborted();
        lastError = ensureError(error);

        if (
          !operationCompleted && !delegatedRetryLoop && attempt < maxAttempts &&
          this.isRetryableError(lastError, retryConfig)
        ) {
          const delay = calculateRetryDelay(attempt, retryConfig);
          addActiveSpanEvent("workflow.node.retry", {
            "workflow.node.attempt": attempt,
            "workflow.node.retry_delay_ms": delay,
            "workflow.node.error_type": retryTelemetryErrorType(lastError),
          });
          await sleep(delay, abortSignal);
          continue;
        }

        setActiveSpanAttributes({ "workflow.node.attempts": attempt });
        this.config.onStepError?.(node.id, lastError, runId);

        return {
          success: false,
          error: lastError.message,
          executionTime: Date.now() - startTime,
        };
      }
    }

    return {
      success: false,
      error: lastError?.message ?? "Unknown error",
      executionTime: Date.now() - startTime,
    };
  }

  /** Shared transient classification (HTTP statuses + network error codes) via retry-policy. */
  private isRetryableError(error: Error, config: RetryConfig): boolean {
    // Starting another attempt while the timed-out operation is still active
    // would violate step isolation and allow concurrent external side effects.
    if (this.nonCooperativeErrors.has(error)) return false;
    return isRetryableWorkflowError(error, config);
  }

  private async resolveInput(
    input: StepNodeConfig["input"],
    context: WorkflowContext,
  ): Promise<unknown> {
    if (input === undefined) return context.input;
    if (typeof input === "function") return input(context);
    return input;
  }

  private async executeWithTimeout<T>(
    fn: (abortSignal: AbortSignal) => Promise<T>,
    timeout: number,
    nodeId: string,
    parentSignal?: AbortSignal,
    runId?: string,
    nodeOperations?: Set<Promise<unknown>>,
  ): Promise<T> {
    const attemptController = new AbortController();
    const forwardAbort = () => attemptController.abort(parentSignal?.reason);
    if (parentSignal?.aborted) forwardAbort();
    else parentSignal?.addEventListener("abort", forwardAbort, { once: true });

    const operation = Promise.resolve().then(() => fn(attemptController.signal));
    if (runId !== undefined) this.trackExecutionOperation(runId, operation);
    nodeOperations?.add(operation);
    void operation.then(
      () => nodeOperations?.delete(operation),
      () => nodeOperations?.delete(operation),
    );
    const fencedOperation = operation.then((value) => {
      attemptController.signal.throwIfAborted();
      return value;
    });
    const timeoutError = TIMEOUT_ERROR.create({
      detail: `Step "${nodeId}" timed out after ${timeout}ms`,
    });

    let rejectAbort: (() => void) | undefined;
    const abortPromise = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(attemptController.signal.reason);
      if (attemptController.signal.aborted) rejectAbort();
      else attemptController.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    const timeoutId = setTimeout(() => attemptController.abort(timeoutError), timeout);

    try {
      return await Promise.race([fencedOperation, abortPromise]);
    } catch (error) {
      if (attemptController.signal.aborted) {
        const settled = await this.waitForCancellationGrace(fencedOperation);
        if (!settled && error instanceof Error) this.nonCooperativeErrors.add(error);
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (rejectAbort) attemptController.signal.removeEventListener("abort", rejectAbort);
      parentSignal?.removeEventListener("abort", forwardAbort);
    }
  }

  private trackExecutionOperation(runId: string, operation: Promise<unknown>): void {
    let operations = this.executionOperations.get(runId);
    if (!operations) {
      operations = new Set();
      this.executionOperations.set(runId, operations);
    }
    operations.add(operation);
    const settle = () => {
      operations.delete(operation);
      // A missing entry means settled; run ownership is tracked by WorkflowExecutor.
      if (operations.size === 0 && this.executionOperations.get(runId) === operations) {
        this.executionOperations.delete(runId);
      }
    };
    void operation.then(settle, settle);
  }

  /** @internal Wait until every raw step operation observed locally for this run has settled. */
  async waitForExecutionStopped(runId: string): Promise<void> {
    let operations = this.executionOperations.get(runId);
    while (operations && operations.size > 0) {
      await Promise.allSettled([...operations]);
      operations = this.executionOperations.get(runId) ?? operations;
    }
  }

  /** @internal Retire lifecycle evidence after outstanding operations actually settle. */
  clearExecutionStopEvidence(): void {
    for (const [runId, operations] of this.executionOperations) {
      const retire = async () => {
        while (operations.size > 0) await Promise.allSettled([...operations]);
        if (this.executionOperations.get(runId) === operations) {
          this.executionOperations.delete(runId);
        }
      };
      void retire();
    }
  }

  private async waitForCancellationGrace(operation: Promise<unknown>): Promise<boolean> {
    const gracePeriod = Math.max(
      0,
      this.config.cancellationGracePeriod ?? DEFAULT_CANCELLATION_GRACE_PERIOD_MS,
    );
    let graceTimeoutId: ReturnType<typeof setTimeout> | undefined;
    const settled = operation.then(
      () => true,
      () => true,
    );
    const graceExpired = new Promise<false>((resolve) => {
      graceTimeoutId = setTimeout(() => resolve(false), gracePeriod);
    });

    try {
      return await Promise.race([settled, graceExpired]);
    } finally {
      if (graceTimeoutId !== undefined) clearTimeout(graceTimeoutId);
    }
  }

  private async executeStep(
    config: StepNodeConfig,
    input: unknown,
    context: WorkflowContext,
    abortSignal?: AbortSignal,
  ): Promise<unknown> {
    abortSignal?.throwIfAborted();
    if (config.agent) return this.executeAgent(config.agent, input, context, abortSignal);
    if (config.tool) return this.executeTool(config.tool, input, context, abortSignal);
    throw INVALID_ARGUMENT.create({ detail: "Step must have either 'agent' or 'tool' specified" });
  }

  private async executeAgent(
    agent: string | Agent,
    input: unknown,
    context: WorkflowContext,
    abortSignal?: AbortSignal,
  ): Promise<unknown> {
    const resolvedAgent = typeof agent === "string" ? this.getAgent(agent) : agent;
    const agentInput = typeof input === "string" ? input : JSON.stringify(input);

    const response: AgentResponse = await resolvedAgent.generate({
      input: agentInput,
      context,
      abortSignal,
    });
    abortSignal?.throwIfAborted();

    // `object` is the validated structured output from the agent's
    // `outputSchema`, already parsed by `generate()`. Omitting it here was
    // silent: a later step reading `context.<nodeId>.object` got `undefined`
    // with no error, making `outputSchema` unusable from inside a workflow.
    return buildAgentStepOutput({
      text: response.text,
      toolCalls: response.toolCalls,
      status: response.status,
      usage: response.usage,
      object: response.object,
    });
  }

  private async executeTool(
    tool: string | Tool,
    input: unknown,
    context: WorkflowContext,
    abortSignal?: AbortSignal,
  ): Promise<unknown> {
    const resolvedTool = typeof tool === "string" ? this.getTool(tool) : tool;
    const tenant = context._tenant ?? getWorkflowTenant();

    return resolvedTool.execute(input as Record<string, unknown>, {
      agentId: "workflow",
      blobStorage: this.config.blobStorage,
      projectId: tenant?.projectId,
      projectSlug: tenant?.projectSlug,
      authToken: tenant?.token,
      productionMode: tenant?.productionMode,
      releaseId: tenant?.releaseId,
      branch: tenant?.branch,
      environmentName: tenant?.environmentName,
      abortSignal,
    });
  }

  private formatAvailableItems(items: string[]): string {
    if (items.length === 0) return "";
    const preview = items.slice(0, 5).join(", ");
    return ` Available: ${preview}${items.length > 5 ? "..." : ""}`;
  }

  private resolveFromRegistry<T>(
    id: string,
    registry: { get(id: string): T | undefined; list?(): string[] } | undefined,
    type: "agent" | "tool",
  ): T {
    const label = type.charAt(0).toUpperCase() + type.slice(1);

    if (!registry) {
      throw INITIALIZATION_ERROR.create({
        detail: `${label} registry not configured. Cannot resolve ${type} "${id}"`,
      });
    }

    const item = registry.get(id);
    if (item) return item;

    const available = registry.list?.() ?? [];
    const suggestion = available.length > 0
      ? this.formatAvailableItems(available)
      : ` No ${type}s are registered.`;

    const detail = `${label} not found: "${id}".${suggestion}`;
    throw (type === "agent"
      ? AGENT_NOT_FOUND.create({ detail })
      : RESOURCE_NOT_FOUND.create({ detail }));
  }

  private getAgent(id: string): Agent {
    return this.resolveFromRegistry(id, this.config.agentRegistry, "agent");
  }

  private getTool(id: string): Tool {
    return this.resolveFromRegistry(id, this.config.toolRegistry, "tool");
  }

  async shouldSkip(node: WorkflowNode, context: WorkflowContext): Promise<boolean> {
    const { skip } = node.config;
    if (!skip) return false;
    return skip(context);
  }

  createInitialState(nodeId: string): NodeState {
    return { nodeId, status: "pending", attempt: 0 };
  }

  createRunningState(nodeId: string, input: unknown, attempt: number): NodeState {
    return { nodeId, status: "running", input, attempt, startedAt: new Date() };
  }

  createCompletedState(result: StepResult, previousState: NodeState): NodeState {
    const completedAt = new Date();
    const {
      completedAt: _previousCompletedAt,
      error: _previousError,
      output: _previousOutput,
      ...activeState
    } = previousState;

    if (result.success) {
      return { ...activeState, status: "completed", output: result.output, completedAt };
    }

    return { ...activeState, status: "failed", error: result.error, completedAt };
  }

  createSkippedState(nodeId: string): NodeState {
    return { nodeId, status: "skipped", attempt: 0, completedAt: new Date() };
  }
}
