/**
 * Step Executor
 *
 * Executes individual workflow steps (agents and tools)
 */
import * as dntShim from "../../../_dnt.shims.js";


import type { Agent, AgentResponse } from "../../agent/index.js";
import type { Tool } from "../../tool/index.js";
import type {
  NodeState,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.js";
import { parseDuration } from "../types.js";
import type { BlobStorage } from "../blob/types.js";

/** Default retry configuration */
const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 1,
  backoff: "exponential",
  initialDelay: 1000,
  maxDelay: 30000,
};

/** Default timeout for workflow steps (5 minutes) */
const DEFAULT_STEP_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Agent registry for looking up agents by ID
 */
export interface AgentRegistry {
  get(id: string): Agent | undefined;
  /** Optional: List all registered agent IDs (for error messages) */
  list?(): string[];
}

/**
 * Tool registry for looking up tools by ID
 */
export interface ToolRegistry {
  get(id: string): Tool | undefined;
  /** Optional: List all registered tool IDs (for error messages) */
  list?(): string[];
}

/**
 * Step executor configuration
 */
export interface StepExecutorConfig {
  /** Agent registry for looking up agents */
  agentRegistry?: AgentRegistry;
  /** Tool registry for looking up tools */
  toolRegistry?: ToolRegistry;
  /** Default timeout for steps (in milliseconds) */
  defaultTimeout?: number;
  /** Blob storage access */
  blobStorage?: BlobStorage;
  /** Callback when step starts */
  onStepStart?: (nodeId: string, input: unknown) => void;
  /** Callback when step completes */
  onStepComplete?: (nodeId: string, output: unknown) => void;
  /** Callback when step fails */
  onStepError?: (nodeId: string, error: Error) => void;
}

/**
 * Result of executing a step
 */
export interface StepResult {
  /** Whether the step succeeded */
  success: boolean;
  /** Output from the step (if successful) */
  output?: unknown;
  /** Error message (if failed) */
  error?: string;
  /** Execution time in milliseconds */
  executionTime: number;
}

/**
 * Step Executor class
 *
 * Responsible for executing individual workflow steps by invoking
 * the appropriate agent or tool.
 */
export class StepExecutor {
  private config: StepExecutorConfig;

  constructor(config: StepExecutorConfig = {}) {
    this.config = {
      defaultTimeout: DEFAULT_STEP_TIMEOUT_MS,
      ...config,
    };
  }

  /**
   * Execute a step node with retry support
   */
  async execute(node: WorkflowNode, context: WorkflowContext): Promise<StepResult> {
    const startTime = Date.now();
    const config = node.config as StepNodeConfig;

    if (config.type !== "step") {
      throw new Error(
        `StepExecutor can only execute 'step' nodes, but node "${node.id}" has type '${config.type}'. ` +
          `This is likely a bug in the DAG executor routing.`,
      );
    }

    const retryConfig = { ...DEFAULT_RETRY, ...config.retry };
    const maxAttempts = retryConfig.maxAttempts ?? 1;

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resolvedInput = await this.resolveInput(config.input, context);
        this.config.onStepStart?.(node.id, resolvedInput);

        const timeout = config.timeout
          ? parseDuration(config.timeout)
          : (this.config.defaultTimeout ?? DEFAULT_STEP_TIMEOUT_MS);

        const output = await this.executeWithTimeout(
          () => this.executeStep(config, resolvedInput, context),
          timeout,
          node.id,
        );

        this.config.onStepComplete?.(node.id, output);

        return {
          success: true,
          output,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        const shouldRetry = attempt < maxAttempts && this.isRetryableError(lastError, retryConfig);

        if (shouldRetry) {
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

  /**
   * Check if error is retryable
   */
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

  /**
   * Calculate retry delay based on backoff strategy
   */
  private calculateRetryDelay(attempt: number, config: RetryConfig): number {
    const initialDelay = config.initialDelay ?? 1000;
    const maxDelay = config.maxDelay ?? 30000;

    const baseDelay = config.backoff === "exponential"
      ? initialDelay * Math.pow(2, attempt - 1)
      : config.backoff === "linear"
      ? initialDelay * attempt
      : initialDelay;

    // Add jitter (±10%) and cap at maxDelay
    const jitter = baseDelay * 0.1 * (Math.random() * 2 - 1);
    return Math.floor(Math.min(baseDelay + jitter, maxDelay));
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => dntShim.setTimeout(resolve, ms));
  }

  /**
   * Resolve step input from context
   */
  private async resolveInput(
    input: StepNodeConfig["input"],
    context: WorkflowContext,
  ): Promise<unknown> {
    if (input === undefined) return context.input;
    if (typeof input === "function") return await input(context);
    return input;
  }

  /**
   * Execute step with timeout
   *
   * Uses Promise.race() to properly handle timeout cleanup.
   * The timeout is always cleared in the finally block to prevent memory leaks.
   */
  private async executeWithTimeout<T>(
    fn: () => Promise<T>,
    timeout: number,
    nodeId: string,
  ): Promise<T> {
    let timeoutId: ReturnType<typeof dntShim.setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = dntShim.setTimeout(() => {
        reject(new Error(`Step "${nodeId}" timed out after ${timeout}ms`));
      }, timeout);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  /**
   * Execute the actual step (agent or tool)
   */
  private async executeStep(
    config: StepNodeConfig,
    input: unknown,
    context: WorkflowContext,
  ): Promise<unknown> {
    if (config.agent) return await this.executeAgent(config.agent, input, context);
    if (config.tool) return await this.executeTool(config.tool, input);
    throw new Error("Step must have either 'agent' or 'tool' specified");
  }

  /**
   * Execute an agent
   */
  private async executeAgent(
    agent: string | Agent,
    input: unknown,
    context: WorkflowContext,
  ): Promise<unknown> {
    const resolvedAgent = typeof agent === "string" ? this.getAgent(agent) : agent;
    const agentInput = typeof input === "string" ? input : JSON.stringify(input);

    const response: AgentResponse = await resolvedAgent.generate({
      input: agentInput,
      context,
    });

    return {
      text: response.text,
      toolCalls: response.toolCalls,
      status: response.status,
      usage: response.usage,
    };
  }

  /**
   * Execute a tool
   */
  private async executeTool(tool: string | Tool, input: unknown): Promise<unknown> {
    const resolvedTool = typeof tool === "string" ? this.getTool(tool) : tool;

    return await resolvedTool.execute(input as Record<string, unknown>, {
      agentId: "workflow",
      blobStorage: this.config.blobStorage,
    });
  }

  /** Format available items for error messages (shows first 5) */
  private formatAvailableItems(items: string[]): string {
    if (items.length === 0) return "";
    const preview = items.slice(0, 5).join(", ");
    return ` Available: ${preview}${items.length > 5 ? "..." : ""}`;
  }

  /** Resolve an item from a registry with helpful error messages */
  private resolveFromRegistry<T>(
    id: string,
    registry: { get(id: string): T | undefined; list?(): string[] } | undefined,
    type: "agent" | "tool",
  ): T {
    const label = type.charAt(0).toUpperCase() + type.slice(1);

    if (!registry) {
      throw new Error(`${label} registry not configured. Cannot resolve ${type} "${id}"`);
    }

    const item = registry.get(id);
    if (item) return item;

    const available = registry.list?.() ?? [];
    const suggestion = available.length > 0
      ? this.formatAvailableItems(available)
      : ` No ${type}s are registered.`;

    throw new Error(`${label} not found: "${id}".${suggestion}`);
  }

  private getAgent(id: string): Agent {
    return this.resolveFromRegistry(id, this.config.agentRegistry, "agent");
  }

  private getTool(id: string): Tool {
    return this.resolveFromRegistry(id, this.config.toolRegistry, "tool");
  }

  /**
   * Check if a step should be skipped
   */
  async shouldSkip(node: WorkflowNode, context: WorkflowContext): Promise<boolean> {
    const { skip } = node.config;
    if (!skip) return false;
    return await skip(context);
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
