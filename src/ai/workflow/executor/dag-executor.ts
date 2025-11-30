/**
 * DAG Executor
 *
 * Executes workflow DAGs with proper dependency ordering and parallel execution
 */

import type {
  BranchNodeConfig,
  Checkpoint,
  NodeState,
  ParallelNodeConfig,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowRun,
} from "../types.ts";
import { generateId } from "../types.ts";
import type { StepExecutor } from "./step-executor.ts";
import type { CheckpointManager } from "./checkpoint-manager.ts";

/**
 * DAG executor configuration
 */
export interface DAGExecutorConfig {
  /** Step executor for running individual steps */
  stepExecutor: StepExecutor;
  /** Checkpoint manager for durability */
  checkpointManager?: CheckpointManager;
  /** Maximum concurrent parallel executions */
  maxConcurrency?: number;
  /** Callback when node execution starts */
  onNodeStart?: (nodeId: string) => void;
  /** Callback when node execution completes */
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  /** Callback when waiting for approval/event */
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Result of DAG execution
 */
export interface DAGExecutionResult {
  /** Whether the DAG completed successfully */
  completed: boolean;
  /** Whether the DAG is waiting (for approval/event) */
  waiting: boolean;
  /** Node that is waiting (if waiting) */
  waitingNode?: string;
  /** Final context after execution */
  context: WorkflowContext;
  /** Final node states */
  nodeStates: Record<string, NodeState>;
  /** Error if failed */
  error?: string;
}

/**
 * DAG Executor class
 *
 * Responsible for executing workflow DAGs with:
 * - Topological ordering for dependencies
 * - Parallel execution of independent nodes
 * - Support for branching and conditional logic
 * - Checkpointing for durability
 */
export class DAGExecutor {
  private config: DAGExecutorConfig;

  constructor(config: DAGExecutorConfig) {
    this.config = {
      maxConcurrency: 10,
      debug: false,
      ...config,
    };
  }

  /**
   * Execute a workflow DAG
   */
  async execute(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    startFromNode?: string,
  ): Promise<DAGExecutionResult> {
    const context = { ...run.context };
    const nodeStates = { ...run.nodeStates };

    // Build dependency graph
    const { adjList, inDegree, nodeMap } = this.buildGraph(nodes);

    // Update in-degrees for nodes whose dependencies are already completed
    // This handles resuming from checkpoints
    for (const [nodeId, state] of Object.entries(nodeStates)) {
      if (state.status === "completed" || state.status === "skipped") {
        // Decrement in-degree for all dependents of this completed node
        for (const dependent of adjList.get(nodeId) || []) {
          const currentDegree = inDegree.get(dependent) ?? 0;
          if (currentDegree > 0) {
            inDegree.set(dependent, currentDegree - 1);
          }
        }
      }
    }

    // Validate DAG (no cycles)
    if (this.hasCycle(nodes, adjList)) {
      return {
        completed: false,
        waiting: false,
        context,
        nodeStates,
        error: "Workflow DAG contains cycles",
      };
    }

    // Find starting nodes
    let ready: string[];
    if (startFromNode) {
      // Resume from specific node
      ready = [startFromNode];
    } else {
      // Start from nodes with no dependencies that haven't been completed
      ready = this.getReadyNodes(inDegree, nodeStates);
    }

    // Execute nodes in topological order
    while (ready.length > 0) {
      // Execute ready nodes in parallel (respecting max concurrency)
      const batch = ready.slice(0, this.config.maxConcurrency);
      ready = ready.slice(this.config.maxConcurrency);

      const results = await Promise.allSettled(
        batch.map((nodeId) =>
          this.executeNode(nodeMap.get(nodeId)!, context, nodeStates)
        ),
      );

      // Process results
      for (let i = 0; i < batch.length; i++) {
        const nodeId = batch[i]!;
        const result = results[i]!;

        if (result.status === "fulfilled") {
          const nodeResult = result.value;

          // Update node state
          nodeStates[nodeId] = nodeResult.state;
          Object.assign(context, nodeResult.contextUpdates);

          // Handle waiting state
          if (nodeResult.waiting) {
            return {
              completed: false,
              waiting: true,
              waitingNode: nodeId,
              context,
              nodeStates,
            };
          }

          // Checkpoint if configured
          const nodeConfig = nodeMap.get(nodeId);
          if (
            nodeResult.state.status === "completed" &&
            nodeConfig && this.shouldCheckpoint(nodeConfig)
          ) {
            await this.checkpoint(run.id, nodeId, context, nodeStates);
          }

          // Check if node failed (step returned success: false)
          if (nodeResult.state.status === "failed") {
            return {
              completed: false,
              waiting: false,
              context,
              nodeStates,
              error: `Node "${nodeId}" failed: ${nodeResult.state.error || "Unknown error"}`,
            };
          }

          // Update ready nodes based on completed dependencies
          if (nodeResult.state.status === "completed" || nodeResult.state.status === "skipped") {
            for (const dependent of adjList.get(nodeId) || []) {
              const newDegree = inDegree.get(dependent)! - 1;
              inDegree.set(dependent, newDegree);
            }
          }
        } else {
          // Node execution failed
          const error = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);

          nodeStates[nodeId] = {
            nodeId,
            status: "failed",
            error,
            attempt: (nodeStates[nodeId]?.attempt || 0) + 1,
            completedAt: new Date(),
          };

          // Fail fast - don't continue with other nodes
          return {
            completed: false,
            waiting: false,
            context,
            nodeStates,
            error: `Node "${nodeId}" failed: ${error}`,
          };
        }
      }

      // Get newly ready nodes
      const newReady = this.getReadyNodes(inDegree, nodeStates);
      ready = [...ready, ...newReady];
    }

    return {
      completed: true,
      waiting: false,
      context,
      nodeStates,
    };
  }

  /**
   * Execute a single node
   */
  private async executeNode(
    node: WorkflowNode,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<{
    state: NodeState;
    contextUpdates: Record<string, unknown>;
    waiting: boolean;
  }> {
    const nodeId = node.id;

    // Check if node is already completed (resuming from checkpoint)
    const existingState = nodeStates[nodeId];
    if (existingState?.status === "completed") {
      return { state: existingState, contextUpdates: {}, waiting: false };
    }

    this.config.onNodeStart?.(nodeId);

    // Check if should skip
    if (node.config.skip && (await node.config.skip(context))) {
      const state = this.config.stepExecutor.createSkippedState(nodeId);
      this.config.onNodeComplete?.(nodeId, state);
      return { state, contextUpdates: {}, waiting: false };
    }

    // Execute based on node type
    const config = node.config;

    switch (config.type) {
      case "step":
        return await this.executeStepNode(node, context);

      case "parallel":
        return await this.executeParallelNode(node, config, context, nodeStates);

      case "branch":
        return await this.executeBranchNode(node, config, context, nodeStates);

      case "wait":
        return await this.executeWaitNode(node, config, context);

      case "subWorkflow":
        throw new Error(
          `Sub-workflow execution is not yet implemented for node "${node.id}". ` +
            `Workaround: Flatten your workflow by inlining the sub-workflow steps directly, ` +
            `or use the parallel() or branch() DSL helpers to compose workflows.`,
        );

      default:
        throw new Error(
          `Unknown node type "${(config as WorkflowNodeConfig).type}" for node "${node.id}". ` +
          `Valid types are: step, parallel, branch, wait, subWorkflow`
        );
    }
  }

  /**
   * Execute a step node
   */
  private async executeStepNode(
    node: WorkflowNode,
    context: WorkflowContext,
  ): Promise<{
    state: NodeState;
    contextUpdates: Record<string, unknown>;
    waiting: boolean;
  }> {
    const result = await this.config.stepExecutor.execute(node, context);

    const state: NodeState = {
      nodeId: node.id,
      status: result.success ? "completed" : "failed",
      input: context.input,
      output: result.output,
      error: result.error,
      attempt: 1,
      startedAt: new Date(Date.now() - result.executionTime),
      completedAt: new Date(),
    };

    this.config.onNodeComplete?.(node.id, state);

    return {
      state,
      contextUpdates: result.success ? { [node.id]: result.output } : {},
      waiting: false,
    };
  }

  /**
   * Execute a parallel node
   */
  private async executeParallelNode(
    node: WorkflowNode,
    config: ParallelNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<{
    state: NodeState;
    contextUpdates: Record<string, unknown>;
    waiting: boolean;
  }> {
    const startTime = Date.now();

    // Execute child nodes using DAG executor recursively
    const result = await this.execute(config.nodes, {
      id: `${node.id}_parallel`,
      workflowId: "",
      status: "running",
      input: context.input,
      nodeStates: {},
      currentNodes: [],
      context,
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    });

    // Merge child node states
    Object.assign(nodeStates, result.nodeStates);

    const state: NodeState = {
      nodeId: node.id,
      status: result.completed ? "completed" : (result.waiting ? "running" : "failed"),
      output: result.context,
      error: result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
    };

    this.config.onNodeComplete?.(node.id, state);

    return {
      state,
      contextUpdates: result.context,
      waiting: result.waiting,
    };
  }

  /**
   * Execute a branch node
   */
  private async executeBranchNode(
    node: WorkflowNode,
    config: BranchNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<{
    state: NodeState;
    contextUpdates: Record<string, unknown>;
    waiting: boolean;
  }> {
    const startTime = Date.now();

    // Evaluate condition
    const conditionResult = await config.condition(context);

    // Select branch to execute
    const branchNodes = conditionResult ? config.then : (config.else || []);

    if (branchNodes.length === 0) {
      // No nodes to execute
      const state: NodeState = {
        nodeId: node.id,
        status: "completed",
        output: { branch: conditionResult ? "then" : "else", skipped: true },
        attempt: 1,
        startedAt: new Date(startTime),
        completedAt: new Date(),
      };

      return { state, contextUpdates: {}, waiting: false };
    }

    // Execute branch nodes
    const result = await this.execute(branchNodes, {
      id: `${node.id}_branch`,
      workflowId: "",
      status: "running",
      input: context.input,
      nodeStates: {},
      currentNodes: [],
      context,
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    });

    // Merge child node states
    Object.assign(nodeStates, result.nodeStates);

    const state: NodeState = {
      nodeId: node.id,
      status: result.completed ? "completed" : (result.waiting ? "running" : "failed"),
      output: {
        branch: conditionResult ? "then" : "else",
        result: result.context,
      },
      error: result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
    };

    this.config.onNodeComplete?.(node.id, state);

    return {
      state,
      contextUpdates: result.context,
      waiting: result.waiting,
    };
  }

  /**
   * Execute a wait node (approval or event)
   */
  private async executeWaitNode(
    node: WorkflowNode,
    config: WaitNodeConfig,
    context: WorkflowContext,
  ): Promise<{
    state: NodeState;
    contextUpdates: Record<string, unknown>;
    waiting: boolean;
  }> {
    // Notify that we're waiting
    this.config.onWaiting?.(node.id, config);

    const state: NodeState = {
      nodeId: node.id,
      status: "running",
      input: {
        type: config.waitType,
        message: config.message,
        payload: typeof config.payload === "function"
          ? await config.payload(context)
          : config.payload,
      },
      attempt: 1,
      startedAt: new Date(),
    };

    // Signal that workflow is now waiting
    return {
      state,
      contextUpdates: {},
      waiting: true,
    };
  }

  /**
   * Build dependency graph from nodes
   */
  private buildGraph(nodes: WorkflowNode[]): {
    adjList: Map<string, string[]>;
    inDegree: Map<string, number>;
    nodeMap: Map<string, WorkflowNode>;
  } {
    const adjList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const nodeMap = new Map<string, WorkflowNode>();

    // Initialize
    for (const node of nodes) {
      adjList.set(node.id, []);
      inDegree.set(node.id, 0);
      nodeMap.set(node.id, node);
    }

    // Build edges from dependencies
    for (const node of nodes) {
      for (const dep of node.dependsOn || []) {
        if (!adjList.has(dep)) {
          throw new Error(
            `Node "${node.id}" depends on unknown node "${dep}"`,
          );
        }
        adjList.get(dep)!.push(node.id);
        inDegree.set(node.id, inDegree.get(node.id)! + 1);
      }
    }

    // Also handle implicit sequential dependencies (nodes without explicit deps)
    // If no dependencies specified (undefined), assume sequential order
    // If dependsOn is explicitly set (even to []), respect that choice
    let prevNodeId: string | null = null;
    for (const node of nodes) {
      // Only add implicit deps if:
      // 1. dependsOn is undefined (not explicitly set)
      // 2. No other node explicitly depends on this node
      // 3. This node has no incoming edges yet
      if (node.dependsOn === undefined && prevNodeId) {
        const isDependent = this.hasAnyDependents(nodes, node.id);
        const currentInDegree = inDegree.get(node.id) ?? 0;

        if (!isDependent && currentInDegree === 0) {
          // This node is "floating" - no explicit deps and nothing depends on it
          // Create implicit dependency on previous node
          adjList.get(prevNodeId)!.push(node.id);
          inDegree.set(node.id, inDegree.get(node.id)! + 1);
        }
      }
      prevNodeId = node.id;
    }

    return { adjList, inDegree, nodeMap };
  }

  /**
   * Check if any node explicitly depends on the given node
   */
  private hasAnyDependents(nodes: WorkflowNode[], nodeId: string): boolean {
    return nodes.some((n) => n.dependsOn?.includes(nodeId));
  }

  /**
   * Get nodes that are ready to execute
   */
  private getReadyNodes(
    inDegree: Map<string, number>,
    nodeStates: Record<string, NodeState>,
  ): string[] {
    const ready: string[] = [];

    for (const [nodeId, degree] of inDegree) {
      // Node is ready if:
      // 1. No remaining dependencies (in-degree = 0)
      // 2. Not already completed/running/failed
      const state = nodeStates[nodeId];
      const isReady = degree === 0 &&
        (!state || state.status === "pending");

      if (isReady) {
        ready.push(nodeId);
      }
    }

    return ready;
  }

  /**
   * Check if DAG has cycles (using DFS)
   */
  private hasCycle(
    nodes: WorkflowNode[],
    adjList: Map<string, string[]>,
  ): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const dfs = (nodeId: string): boolean => {
      visited.add(nodeId);
      recursionStack.add(nodeId);

      for (const neighbor of adjList.get(nodeId) || []) {
        if (!visited.has(neighbor)) {
          if (dfs(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(nodeId);
      return false;
    };

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        if (dfs(node.id)) return true;
      }
    }

    return false;
  }

  /**
   * Check if node should be checkpointed
   */
  private shouldCheckpoint(node: WorkflowNode): boolean {
    return node.config.checkpoint ?? false;
  }

  /**
   * Create a checkpoint
   */
  private async checkpoint(
    runId: string,
    nodeId: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<void> {
    if (!this.config.checkpointManager) {
      return;
    }

    const checkpoint: Checkpoint = {
      id: generateId("cp"),
      nodeId,
      timestamp: new Date(),
      context: structuredClone(context),
      nodeStates: structuredClone(nodeStates),
    };

    await this.config.checkpointManager.save(runId, checkpoint);
  }
}
