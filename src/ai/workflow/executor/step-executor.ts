
import type { Agent, AgentResponse } from "../../types/agent.ts";
import type { Tool } from "../../types/tool.ts";
import type { NodeState, StepNodeConfig, WorkflowContext, WorkflowNode } from "../types.ts";
import { parseDuration } from "../types.ts";
import type { BlobStorage } from "../blob/types.ts";

const DEFAULT_STEP_TIMEOUT_MS = 5 * 60 * 1000;

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
    this.config = {
      defaultTimeout: DEFAULT_STEP_TIMEOUT_MS,
      ...config,
    };
  }

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

    try {
      const resolvedInput = await this.resolveInput(config.input, context);
      this.config.onStepStart?.(node.id, resolvedInput);

      const timeout = config.timeout ? parseDuration(config.timeout) : this.config.defaultTimeout!;

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
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.config.onStepError?.(node.id, error as Error);

      return {
        success: false,
        error: errorMessage,
        executionTime: Date.now() - startTime,
      };
    }
  }

  private async resolveInput(
    input: StepNodeConfig["input"],
    context: WorkflowContext,
  ): Promise<unknown> {
    if (input === undefined) {
      return context.input;
    }

    if (typeof input === "function") {
      return await input(context);
    }

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

  private async executeTool(
    tool: string | Tool,
    input: unknown,
  ): Promise<unknown> {
    const resolvedTool = typeof tool === "string" ? this.getTool(tool) : tool;

    const result = await resolvedTool.execute(
      input as Record<string, unknown>,
      {
        agentId: "workflow",
        blobStorage: this.config.blobStorage,
      },
    );

    return result;
  }

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

  createInitialState(nodeId: string): NodeState {
    return {
      nodeId,
      status: "pending",
      attempt: 0,
    };
  }

  createRunningState(nodeId: string, input: unknown, attempt: number): NodeState {
    return {
      nodeId,
      status: "running",
      input,
      attempt,
      startedAt: new Date(),
    };
  }

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

  createSkippedState(nodeId: string): NodeState {
    return {
      nodeId,
      status: "skipped",
      attempt: 0,
      completedAt: new Date(),
    };
  }
}
