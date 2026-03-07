import { AsyncLocalStorage } from "node:async_hooks";
import type { Agent, AgentResponse } from "#veryfront/agent";
import type { Tool } from "#veryfront/tool";
import { ensureError } from "#veryfront/errors/veryfront-error.ts";
import {
  AGENT_NOT_FOUND,
  INITIALIZATION_ERROR,
  INVALID_ARGUMENT,
  ORCHESTRATION_ERROR,
  RESOURCE_NOT_FOUND,
  TIMEOUT_ERROR,
} from "#veryfront/errors";
import type {
  CapturedTenantContext,
  NodeState,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { parseDuration } from "../types.ts";
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

/**
 * Run a function with workflow tenant context available via AsyncLocalStorage.
 * If tenant is undefined, preserves any existing outer context.
 */
export function runWithWorkflowTenant<T>(
  tenant: CapturedTenantContext | undefined,
  fn: () => Promise<T>,
): Promise<T> {
  if (!tenant) return fn();
  return workflowTenantStorage.run(tenant, fn);
}

/** Default initial delay before first retry attempt */
const DEFAULT_RETRY_INITIAL_DELAY_MS = 1_000;

/** Default maximum delay between retry attempts */
const DEFAULT_RETRY_MAX_DELAY_MS = 30_000;

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
  defaultTimeout?: number;
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
    this.config = { defaultTimeout: DEFAULT_STEP_TIMEOUT_MS, ...config };
  }

  async execute(node: WorkflowNode, context: WorkflowContext): Promise<StepResult> {
    const startTime = Date.now();
    const config = node.config as StepNodeConfig;

    if (config.type !== "step") {
      throw ORCHESTRATION_ERROR.create({
        detail:
          `StepExecutor can only execute 'step' nodes, but node "${node.id}" has type '${config.type}'. ` +
          `This is likely a bug in the DAG executor routing.`,
      });
    }

    const retryConfig = { ...DEFAULT_RETRY, ...config.retry };
    const maxAttempts = retryConfig.maxAttempts ?? 1;

    let lastError: Error | undefined;
    const tenant = context._tenant;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const output = await runWithWorkflowTenant(tenant, async () => {
          const resolvedInput = await this.resolveInput(config.input, context);
          this.config.onStepStart?.(node.id, resolvedInput);

          const timeout = config.timeout
            ? parseDuration(config.timeout)
            : (this.config.defaultTimeout ?? DEFAULT_STEP_TIMEOUT_MS);

          return this.executeWithTimeout(
            () => this.executeStep(config, resolvedInput, context),
            timeout,
            node.id,
          );
        });

        this.config.onStepComplete?.(node.id, output);

        return {
          success: true,
          output,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        lastError = ensureError(error);

        if (attempt < maxAttempts && this.isRetryableError(lastError, retryConfig)) {
          await this.sleep(this.calculateRetryDelay(attempt, retryConfig));
          continue;
        }

        this.config.onStepError?.(node.id, lastError);

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

  private isRetryableError(error: Error, config: RetryConfig): boolean {
    if (config.retryIf) return config.retryIf(error);

    const retryablePatterns = [
      /timeout/i,
      /ECONNRESET/i,
      /ECONNREFUSED/i,
      /ETIMEDOUT/i,
      /rate limit/i,
      /429/,
      /503/,
      /502/,
    ];

    return retryablePatterns.some((pattern) => pattern.test(error.message));
  }

  private calculateRetryDelay(attempt: number, config: RetryConfig): number {
    const initialDelay = config.initialDelay ?? DEFAULT_RETRY_INITIAL_DELAY_MS;
    const maxDelay = config.maxDelay ?? DEFAULT_RETRY_MAX_DELAY_MS;

    let baseDelay = initialDelay;
    if (config.backoff === "exponential") baseDelay = initialDelay * Math.pow(2, attempt - 1);
    else if (config.backoff === "linear") baseDelay = initialDelay * attempt;

    const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1);
    return Math.floor(Math.min(baseDelay + jitter, maxDelay));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    fn: () => Promise<T>,
    timeout: number,
    nodeId: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(TIMEOUT_ERROR.create({ detail: `Step "${nodeId}" timed out after ${timeout}ms` }));
      }, timeout);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  private async executeStep(
    config: StepNodeConfig,
    input: unknown,
    context: WorkflowContext,
  ): Promise<unknown> {
    if (config.agent) return this.executeAgent(config.agent, input, context);
    if (config.tool) return this.executeTool(config.tool, input);
    throw INVALID_ARGUMENT.create({ detail: "Step must have either 'agent' or 'tool' specified" });
  }

  private async executeAgent(
    agent: string | Agent,
    input: unknown,
    context: WorkflowContext,
  ): Promise<unknown> {
    const resolvedAgent = typeof agent === "string" ? this.getAgent(agent) : agent;
    const agentInput = typeof input === "string" ? input : JSON.stringify(input);

    const response: AgentResponse = await resolvedAgent.generate({ input: agentInput, context });

    return {
      text: response.text,
      toolCalls: response.toolCalls,
      status: response.status,
      usage: response.usage,
    };
  }

  private async executeTool(tool: string | Tool, input: unknown): Promise<unknown> {
    const resolvedTool = typeof tool === "string" ? this.getTool(tool) : tool;

    return resolvedTool.execute(input as Record<string, unknown>, {
      agentId: "workflow",
      blobStorage: this.config.blobStorage,
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
