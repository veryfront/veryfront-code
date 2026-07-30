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
} from "./retry-policy.ts";
import type {
  CapturedTenantContext,
  NodeState,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import {
  parseDurationWithLabel,
  parsePositiveDurationWithLabel,
  validateRetryConfig,
} from "../types.ts";
import type { BlobStorage } from "../blob/types.ts";
import { cloneCapturedWorkflowStaticValue } from "./workflow-definition-snapshot.ts";
import { requireWorkflowContentSource } from "../source-authority.ts";
import {
  getPrimaryAbortReason,
  isAbortCleanupError,
  isNonCooperativeOperationError,
  runAbortableOperation,
} from "./abortable-operation.ts";
import { retainExecutionFailure } from "./execution-failure.ts";

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
  const contentSource = requireWorkflowContentSource(tenant);

  // Environment sources are mutable and have no immutable version segment.
  // A synthetic "latest" distributed-cache bucket can mix different source
  // snapshots, so these tenants use request context for registry isolation and
  // deliberately skip distributed caching.
  if (contentSource.type === "environment") return null;

  return {
    projectId: tenant.projectId || tenant.projectSlug,
    mode,
    versionId: contentSource.type === "release" ? contentSource.releaseId : contentSource.branch,
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
  /** Positive safe-integer timeout in portable JavaScript timer range (default: 300000). */
  defaultTimeout?: number;
  /** Non-negative safe-integer cleanup grace in portable timer range (default: 1000). */
  cancellationGracePeriod?: number;
  blobStorage?: BlobStorage;
  onStepStart?: (nodeId: string, input: unknown) => void;
  onStepComplete?: (nodeId: string, output: unknown) => void;
  onStepError?: (nodeId: string, error: Error) => void;
}

export interface StepResult {
  success: boolean;
  output?: unknown;
  error?: string;
  executionTime: number;
}

export class StepExecutor {
  private config: StepExecutorConfig;

  constructor(config: StepExecutorConfig = {}) {
    const {
      defaultTimeout = DEFAULT_STEP_TIMEOUT_MS,
      cancellationGracePeriod,
      ...rest
    } = config;
    const validatedDefaultTimeout = parsePositiveDurationWithLabel(
      defaultTimeout,
      "StepExecutor defaultTimeout",
    );
    const validatedCancellationGracePeriod = cancellationGracePeriod === undefined
      ? undefined
      : parseDurationWithLabel(
        cancellationGracePeriod,
        "StepExecutor cancellationGracePeriod",
      );

    this.config = {
      ...rest,
      defaultTimeout: validatedDefaultTimeout,
      cancellationGracePeriod: validatedCancellationGracePeriod,
    };
  }

  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
    abortSignal?: AbortSignal,
  ): Promise<StepResult> {
    const startTime = Date.now();
    const config = node.config as StepNodeConfig;

    if (config.type !== "step") {
      throw ORCHESTRATION_ERROR.create({
        detail:
          `StepExecutor can only execute 'step' nodes, but node "${node.id}" has type '${config.type}'. ` +
          `This is likely a bug in the DAG executor routing.`,
      });
    }

    if (config.retry !== undefined) {
      validateRetryConfig(config.retry);
    }

    let timeout: number;
    try {
      timeout = config.timeout === undefined
        ? (this.config.defaultTimeout ?? DEFAULT_STEP_TIMEOUT_MS)
        : parsePositiveDurationWithLabel(config.timeout, `Step "${node.id}" timeout`);
    } catch (error) {
      return {
        success: false,
        error: ensureError(error).message,
        executionTime: Date.now() - startTime,
      };
    }

    const retryConfig = { ...DEFAULT_RETRY, ...config.retry };
    const maxAttempts = retryConfig.maxAttempts ?? 1;

    let lastError: Error | undefined;
    const tenant = context._tenant;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      abortSignal?.throwIfAborted();

      try {
        const output = await runWithWorkflowTenant(tenant, async () => {
          const resolvedInput = await this.resolveInput(config.input, context);
          abortSignal?.throwIfAborted();
          this.config.onStepStart?.(node.id, resolvedInput);

          return this.executeWithTimeout(
            (attemptSignal) => this.executeStep(config, resolvedInput, context, attemptSignal),
            timeout,
            node.id,
            abortSignal,
          );
        });
        abortSignal?.throwIfAborted();

        abortSignal?.throwIfAborted();
        this.config.onStepComplete?.(node.id, output);

        return {
          success: true,
          output,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        if (abortSignal?.aborted) {
          if (
            isAbortCleanupError(error) &&
            Object.is(getPrimaryAbortReason(error), abortSignal.reason)
          ) {
            throw error;
          }
          abortSignal.throwIfAborted();
        }
        lastError = ensureError(error);

        if (attempt < maxAttempts && this.isRetryableError(lastError, retryConfig)) {
          await sleep(calculateRetryDelay(attempt, retryConfig), abortSignal);
          continue;
        }

        this.config.onStepError?.(node.id, lastError);

        return retainExecutionFailure({
          success: false,
          error: lastError.message,
          executionTime: Date.now() - startTime,
        }, lastError);
      }
    }

    return retainExecutionFailure({
      success: false,
      error: lastError?.message ?? "Unknown error",
      executionTime: Date.now() - startTime,
    }, lastError);
  }

  /** Shared transient classification (HTTP statuses + network error codes) via retry-policy. */
  private isRetryableError(error: Error, config: RetryConfig): boolean {
    // Starting another attempt while the timed-out operation is still active
    // would violate step isolation and allow concurrent external side effects.
    if (isNonCooperativeOperationError(error)) return false;
    const classifiedError = isAbortCleanupError(error)
      ? ensureError(getPrimaryAbortReason(error))
      : error;
    return isRetryableWorkflowError(classifiedError, config);
  }

  private async resolveInput(
    input: StepNodeConfig["input"],
    context: WorkflowContext,
  ): Promise<unknown> {
    if (input === undefined) return context.input;
    if (typeof input === "function") return input(context);
    return cloneCapturedWorkflowStaticValue(input, "Workflow step input");
  }

  private async executeWithTimeout<T>(
    fn: (abortSignal: AbortSignal) => Promise<T>,
    timeout: number,
    nodeId: string,
    parentSignal?: AbortSignal,
  ): Promise<T> {
    return await runAbortableOperation(fn, {
      label: `Step "${nodeId}"`,
      parentSignal,
      cancellationGracePeriod: this.config.cancellationGracePeriod,
      timeout: {
        milliseconds: timeout,
        reason: TIMEOUT_ERROR.create({
          detail: `Step "${nodeId}" timed out after ${timeout}ms`,
        }),
      },
    });
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

    return {
      text: response.text,
      toolCalls: response.toolCalls,
      status: response.status,
      usage: response.usage,
    };
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

    if (result.success) {
      return { ...previousState, status: "completed", output: result.output, completedAt };
    }

    return { ...previousState, status: "failed", error: result.error, completedAt };
  }

  createSkippedState(nodeId: string): NodeState {
    return { nodeId, status: "skipped", attempt: 0, completedAt: new Date() };
  }
}
