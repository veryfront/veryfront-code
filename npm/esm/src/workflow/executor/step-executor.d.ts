import type { Agent } from "../../agent/index.js";
import type { Tool } from "../../tool/index.js";
import type { NodeState, WorkflowContext, WorkflowNode } from "../types.js";
import type { BlobStorage } from "../blob/types.js";
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
export declare class StepExecutor {
    private config;
    constructor(config?: StepExecutorConfig);
    /**
     * Execute a step node with retry support
     */
    execute(node: WorkflowNode, context: WorkflowContext): Promise<StepResult>;
    /**
     * Check if error is retryable
     */
    private isRetryableError;
    /**
     * Calculate retry delay based on backoff strategy
     */
    private calculateRetryDelay;
    /**
     * Sleep for specified milliseconds
     */
    private sleep;
    /**
     * Resolve step input from context
     */
    private resolveInput;
    /**
     * Execute step with timeout
     *
     * Uses Promise.race() to properly handle timeout cleanup.
     * The timeout is always cleared in the finally block to prevent memory leaks.
     */
    private executeWithTimeout;
    /**
     * Execute the actual step (agent or tool)
     */
    private executeStep;
    /**
     * Execute an agent
     */
    private executeAgent;
    /**
     * Execute a tool
     */
    private executeTool;
    /** Format available items for error messages (shows first 5) */
    private formatAvailableItems;
    /** Resolve an item from a registry with helpful error messages */
    private resolveFromRegistry;
    private getAgent;
    private getTool;
    /**
     * Check if a step should be skipped
     */
    shouldSkip(node: WorkflowNode, context: WorkflowContext): Promise<boolean>;
    createInitialState(nodeId: string): NodeState;
    createRunningState(nodeId: string, input: unknown, attempt: number): NodeState;
    createCompletedState(result: StepResult, previousState: NodeState): NodeState;
    createSkippedState(nodeId: string): NodeState;
}
//# sourceMappingURL=step-executor.d.ts.map