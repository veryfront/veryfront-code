/**
 * Step Executor
 *
 * Executes individual workflow steps (agents and tools)
 */

import type { Agent, AgentResponse } from "../../types/agent.ts";
import type { Tool } from "../../types/tool.ts";
import type {
  NodeState,
  RetryConfig,
  StepNodeConfig,
  WorkflowContext,
  WorkflowNode,
} from "../types.ts";
import { parseDuration } from "../types.ts";

/** Default retry configuration */
const DEFAULT_RETRY: RetryConfig = {
  maxAttempts: 1,
  backoff: "exponential",
  initialDelay: 1000,
  maxDelay: 30000,
};
import type { BlobStorage } from "../blob/types.ts";

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
  async execute(
    node: WorkflowNode,
    context: WorkflowContext,
  ): Promise<StepResult> {
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
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;

      try {
        // Notify start
        const resolvedInput = await this.resolveInput(config.input, context);
        this.config.onStepStart?.(node.id, resolvedInput);

        // Execute with timeout
        const timeout = config.timeout
          ? parseDuration(config.timeout)
          : this.config.defaultTimeout!;

        const output = await this.executeWithTimeout(
          () => this.executeStep(config, resolvedInput, context),
          timeout,
          node.id,
        );

        // Notify completion
        this.config.onStepComplete?.(node.id, output);

        return {
          success: true,
          output,
          executionTime: Date.now() - startTime,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if we should retry
        const shouldRetry = attempt < maxAttempts && this.isRetryableError(lastError, retryConfig);

        if (shouldRetry) {
          const delay = this.calculateRetryDelay(attempt, retryConfig);
          await this.sleep(delay);
          continue;
        }

        // Notify error (only on final failure)
        this.config.onStepError?.(node.id, lastError);

        return {
          success: false,
          error: lastError.message,
          executionTime: Date.now() - startTime,
        };
      }
    }

    // Should not reach here, but just in case
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
    // Check custom retryable condition
    if (config.retryIf) {
      return config.retryIf(error);
    }

    // Default: retry on timeout and network-like errors
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

    let delay: number;

    switch (config.backoff) {
      case "exponential":
        delay = initialDelay * Math.pow(2, attempt - 1);
        break;
      case "linear":
        delay = initialDelay * attempt;
        break;
      case "fixed":
      default:
        delay = initialDelay;
        break;
    }

    // Add jitter (±10%)
    const jitter = delay * 0.1 * (Math.random() * 2 - 1);
    delay = Math.min(delay + jitter, maxDelay);

    return Math.floor(delay);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolve step input from context
   */
  private async resolveInput(
    input: StepNodeConfig["input"],
    context: WorkflowContext,
  ): Promise<unknown> {
    if (input === undefined) {
      // Default to the original workflow input
      return context.input;
    }

    if (typeof input === "function") {
      return await input(context);
    }

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
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(`Step "${nodeId}" timed out after ${timeout}ms`));
      }, timeout);
    });

    try {
      return await Promise.race([fn(), timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
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
    if (config.agent) {
      return await this.executeAgent(config.agent, input, context);
    }

    if (config.tool) {
      return await this.executeTool(config.tool, input);
    }

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
    // Resolve agent from registry if string
    const resolvedAgent = typeof agent === "string" ? this.getAgent(agent) : agent;

    // Prepare input for agent
    const agentInput = typeof input === "string" ? input : JSON.stringify(input);

    // Execute agent
    const response: AgentResponse = await resolvedAgent.generate({
      input: agentInput,
      context,
    });

    // Return the agent's response
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
  private async executeTool(
    tool: string | Tool,
    input: unknown,
  ): Promise<unknown> {
    // Resolve tool from registry if string
    const resolvedTool = typeof tool === "string" ? this.getTool(tool) : tool;

    // Execute tool
    const result = await resolvedTool.execute(
      input as Record<string, unknown>,
      {
        agentId: "workflow",
        blobStorage: this.config.blobStorage,
      },
    );

    return result;
  }

  /**
   * Get agent from registry
   */
  private getAgent(id: string): Agent {
    if (!this.config.agentRegistry) {
      throw new Error(
        `Agent registry not configured. Cannot resolve agent "${id}"`,
      );
    }

    const agent = this.config.agentRegistry.get(id);
    if (!agent) {
      const available = this.config.agentRegistry.list?.() ?? [];
      const suggestion = available.length > 0
        ? ` Available agents: ${available.slice(0, 5).join(", ")}${
          available.length > 5 ? "..." : ""
        }`
        : " No agents are registered.";
      throw new Error(`Agent not found: "${id}".${suggestion}`);
    }

    return agent;
  }

  /**
   * Get tool from registry
   */
  private getTool(id: string): Tool {
    if (!this.config.toolRegistry) {
      throw new Error(
        `Tool registry not configured. Cannot resolve tool "${id}"`,
      );
    }

    const tool = this.config.toolRegistry.get(id);
    if (!tool) {
      const available = this.config.toolRegistry.list?.() ?? [];
      const suggestion = available.length > 0
        ? ` Available tools: ${available.slice(0, 5).join(", ")}${
          available.length > 5 ? "..." : ""
        }`
        : " No tools are registered.";
      throw new Error(`Tool not found: "${id}".${suggestion}`);
    }

    return tool;
  }

  /**
   * Check if a step should be skipped
   */
  async shouldSkip(
    node: WorkflowNode,
    context: WorkflowContext,
  ): Promise<boolean> {
    const config = node.config;

    if (!config.skip) {
      return false;
    }

    return await config.skip(context);
  }

  /**
   * Create initial node state
   */
  createInitialState(nodeId: string): NodeState {
    return {
      nodeId,
      status: "pending",
      attempt: 0,
    };
  }

  /**
   * Update node state for running
   */
  createRunningState(nodeId: string, input: unknown, attempt: number): NodeState {
    return {
      nodeId,
      status: "running",
      input,
      attempt,
      startedAt: new Date(),
    };
  }

  /**
   * Update node state for completion
   *
   * @param result - The step execution result
   * @param previousState - The previous node state (contains nodeId)
   */
  createCompletedState(
    result: StepResult,
    previousState: NodeState,
  ): NodeState {
    if (result.success) {
      return {
        ...previousState,
        status: "completed",
        output: result.output,
        completedAt: new Date(),
      };
    }

    return {
      ...previousState,
      status: "failed",
      error: result.error,
      completedAt: new Date(),
    };
  }

  /**
   * Update node state for skip
   */
  createSkippedState(nodeId: string): NodeState {
    return {
      nodeId,
      status: "skipped",
      attempt: 0,
      completedAt: new Date(),
    };
  }
}
