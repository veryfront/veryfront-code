/**
 * DAG Executor
 *
 * Executes workflow DAGs with proper dependency ordering and parallel execution
 */

import type {
  BranchNodeConfig,
  Checkpoint,
  LoopExecutionContext,
  LoopNodeConfig,
  MapNodeConfig,
  NodeState,
  NodeStatus,
  ParallelNodeConfig,
  SubWorkflowNodeConfig,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowRun,
} from "../types.ts";
import { generateId, parseDuration } from "../types.ts";
import type { StepExecutor } from "./step-executor.ts";
import type { CheckpointManager } from "./checkpoint-manager.ts";

/**
 * Derives NodeStatus from execution result flags
 */
function deriveNodeStatus(completed: boolean, waiting: boolean): NodeStatus {
  if (completed) return "completed";
  if (waiting) return "running";
  return "failed";
}

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
        batch.map((nodeId) => this.executeNode(nodeMap.get(nodeId)!, context, nodeStates)),
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

      case "map":
        return await this.executeMapNode(node, config as MapNodeConfig, context, nodeStates);

      case "branch":
        return await this.executeBranchNode(node, config as BranchNodeConfig, context, nodeStates);

      case "wait":
        return await this.executeWaitNode(node, config as WaitNodeConfig, context);

      case "subWorkflow":
        return await this.executeSubWorkflowNode(
          node,
          config as SubWorkflowNodeConfig,
          context,
          nodeStates,
        );

      case "loop":
        return await this.executeLoopNode(
          node,
          config as LoopNodeConfig,
          context,
          nodeStates,
        );

      default:
        throw new Error(
          `Unknown node type "${(config as WorkflowNodeConfig).type}" for node "${node.id}". ` +
            `Valid types are: step, parallel, map, branch, wait, subWorkflow, loop`,
        );
    }
  }

  /**
   * Execute a map node (dynamic fan-out)
   */
  private async executeMapNode(
    node: WorkflowNode,
    config: MapNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<{
    state: NodeState;
    contextUpdates: Record<string, unknown>;
    waiting: boolean;
  }> {
    const startTime = Date.now();

    // 1. Resolve items collection
    const items = typeof config.items === "function" ? await config.items(context) : config.items;

    if (!Array.isArray(items)) {
      throw new Error(`Map node "${node.id}" items must be an array`);
    }

    if (items.length === 0) {
      // Empty collection, done immediately
      const state: NodeState = {
        nodeId: node.id,
        status: "completed",
        output: [],
        attempt: 1,
        startedAt: new Date(startTime),
        completedAt: new Date(),
      };
      return { state, contextUpdates: { [node.id]: [] }, waiting: false };
    }

    // 2. Generate child nodes for each item
    const childNodes: WorkflowNode[] = [];

    // Check if processor is a WorkflowDefinition or a single node
    const isWorkflowDef = (p: unknown): p is WorkflowDefinition =>
      typeof p === "object" && p !== null && "steps" in p;

    // We'll map each item to a set of nodes
    // For simplicity in this implementation, if processor is a single node, we clone it.
    // If it's a workflow def, we'd need to expand it (similar to subworkflow).
    // Here we assume it's a single node structure for the "map" pattern or a simple chain.
    // To support complex subworkflows per item, best to wrap in a SubWorkflowNode.

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const childId = `${node.id}_${i}`;

      let childNode: WorkflowNode;

      if (isWorkflowDef(config.processor)) {
        // Create a SubWorkflow node for this item
        childNode = {
          id: childId,
          config: {
            type: "subWorkflow",
            workflow: config.processor,
            input: item,
            retry: config.retry,
            checkpoint: false, // Don't checkpoint individual map items by default
          } as SubWorkflowNodeConfig,
        };
      } else {
        // Clone the single processor node
        // We must override the input to be the current item
        // config.processor is narrowed to WorkflowNode here (not WorkflowDefinition)
        const processorConfig = {
          ...(config.processor as WorkflowNode).config,
        } as WorkflowNodeConfig;

        // If it's a step node, ensure input receives the item
        if (processorConfig.type === "step") {
          processorConfig.input = item as Record<string, unknown>;
        }

        childNode = {
          id: childId,
          config: processorConfig,
        };
      }

      childNodes.push(childNode);
    }

    // 3. Execute child nodes
    // We use a temporary DAG execution for these nodes
    // The maxConcurrency from config overrides default
    const originalConcurrency = this.config.maxConcurrency;
    if (config.concurrency) {
      this.config.maxConcurrency = config.concurrency;
    }

    try {
      const result = await this.execute(childNodes, {
        id: `${node.id}_map`,
        workflowId: "",
        status: "running",
        input: context.input,
        nodeStates: {}, // Start fresh for map iteration
        currentNodes: [],
        context: { ...context }, // Pass copy of context so they can read global state
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
      });

      // Merge child node states into parent for visibility
      Object.assign(nodeStates, result.nodeStates);

      // Collect outputs in order
      const outputs = childNodes.map((child) => {
        const childState = result.nodeStates[child.id];
        return childState?.output;
      });

      const state: NodeState = {
        nodeId: node.id,
        status: deriveNodeStatus(result.completed, result.waiting),
        output: outputs,
        error: result.error,
        attempt: 1,
        startedAt: new Date(startTime),
        completedAt: result.completed ? new Date() : undefined,
      };

      this.config.onNodeComplete?.(node.id, state);

      return {
        state,
        contextUpdates: result.completed ? { [node.id]: outputs } : {},
        waiting: result.waiting,
      };
    } finally {
      // Restore concurrency setting
      this.config.maxConcurrency = originalConcurrency!;
    }
  }

  /**
   * Execute a sub-workflow node
   */
  private async executeSubWorkflowNode(
    node: WorkflowNode,
    config: SubWorkflowNodeConfig,
    context: WorkflowContext,
    _nodeStates: Record<string, NodeState>,
  ): Promise<{
    state: NodeState;
    contextUpdates: Record<string, unknown>;
    waiting: boolean;
  }> {
    const startTime = Date.now();

    // 1. Resolve workflow definition
    let workflowDef: WorkflowDefinition;
    if (typeof config.workflow === "string") {
      throw new Error(
        "Resolving workflow by ID is not yet supported in this execution context. Pass the WorkflowDefinition object.",
      );
    } else {
      workflowDef = config.workflow;
    }

    // 2. Resolve input
    const input = typeof config.input === "function"
      ? await config.input(context)
      : (config.input ?? context.input);

    // 3. Expand steps (handle dynamic steps builder)
    let steps: WorkflowNode[];
    if (typeof workflowDef.steps === "function") {
      steps = workflowDef.steps({
        input,
        context,
      });
    } else {
      steps = workflowDef.steps;
    }

    // 4. Execute sub-workflow
    // We create a new isolated run context for the subworkflow
    const subRunId = `${node.id}_sub_${generateId()}`;

    // Execute recursively
    const result = await this.execute(steps, {
      id: subRunId,
      workflowId: workflowDef.id,
      status: "running",
      input,
      nodeStates: {},
      currentNodes: [],
      context: {
        input, // Subworkflow starts with fresh context scoped to its input
        // We do NOT inherit parent context to ensure isolation,
        // unless explicitly passed via input.
      },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    });

    // 5. Process result
    // Type is unknown since config.output can return any type
    let finalOutput: unknown = result.context; // Default output is the final context

    // If sub-workflow has explicit output transformation
    if (result.completed && config.output) {
      finalOutput = config.output(result.context);
    }

    const state: NodeState = {
      nodeId: node.id,
      status: deriveNodeStatus(result.completed, result.waiting),
      output: finalOutput,
      error: result.error,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: result.completed ? new Date() : undefined,
    };

    this.config.onNodeComplete?.(node.id, state);

    return {
      state,
      contextUpdates: result.completed ? { [node.id]: finalOutput } : {},
      waiting: result.waiting,
    };
  }

  /**
   * Execute a loop node
   */
  private async executeLoopNode(
    node: WorkflowNode,
    config: LoopNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<{
    state: NodeState;
    contextUpdates: Record<string, unknown>;
    waiting: boolean;
  }> {
    const startTime = Date.now();
    const previousResults: unknown[] = [];
    let iteration = 0;
    let exitReason: "condition" | "maxIterations" | "error" = "condition";
    let lastError: string | undefined;

    // Check for resumed loop state
    const existingLoopState = context[`${node.id}_loop_state`] as {
      iteration: number;
      previousResults: unknown[];
    } | undefined;

    if (existingLoopState) {
      iteration = existingLoopState.iteration;
      previousResults.push(...existingLoopState.previousResults);
    }

    while (iteration < config.maxIterations) {
      const loopContext: LoopExecutionContext = {
        iteration,
        totalIterations: iteration,
        previousResults: [...previousResults],
        isFirstIteration: iteration === 0,
        isLastAllowedIteration: iteration === config.maxIterations - 1,
      };

      // Check while condition
      const shouldContinue = await config.while(context, loopContext);
      if (!shouldContinue) {
        exitReason = "condition";
        break;
      }

      // Get steps for this iteration
      const steps = typeof config.steps === "function"
        ? config.steps(context, loopContext)
        : config.steps;

      // Execute iteration steps
      const result = await this.execute(steps, {
        id: `${node.id}_iter_${iteration}`,
        workflowId: "",
        status: "running",
        input: context.input,
        nodeStates: {},
        currentNodes: [],
        context: { ...context, _loop: loopContext },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
      });

      // Handle waiting state (e.g., waitForApproval within loop)
      if (result.waiting) {
        Object.assign(nodeStates, result.nodeStates);

        const state: NodeState = {
          nodeId: node.id,
          status: "running",
          output: {
            iteration,
            waiting: true,
            previousResults,
          },
          attempt: 1,
          startedAt: new Date(startTime),
        };

        return {
          state,
          contextUpdates: {
            ...result.context,
            [`${node.id}_loop_state`]: { iteration, previousResults },
          },
          waiting: true,
        };
      }

      // Handle error
      if (result.error) {
        lastError = result.error;
        exitReason = "error";
        break;
      }

      // Store iteration result and merge context
      previousResults.push(result.context);
      Object.assign(context, result.context);
      Object.assign(nodeStates, result.nodeStates);

      // Apply delay between iterations
      if (config.delay && iteration < config.maxIterations - 1) {
        const delayMs = typeof config.delay === "number"
          ? config.delay
          : parseDuration(config.delay);
        await this.sleep(delayMs);
      }

      iteration++;
    }

    // Check if we hit max iterations
    if (iteration >= config.maxIterations && exitReason !== "condition") {
      exitReason = "maxIterations";
    }

    // Build final loop context
    const finalLoopContext: LoopExecutionContext = {
      iteration,
      totalIterations: iteration,
      previousResults,
      isFirstIteration: false,
      isLastAllowedIteration: true,
    };

    // Call appropriate completion handler
    let completionUpdates: Record<string, unknown> = {};
    if (exitReason === "maxIterations" && config.onMaxIterations) {
      completionUpdates = await config.onMaxIterations(context, finalLoopContext);
    } else if (exitReason === "condition" && config.onComplete) {
      completionUpdates = await config.onComplete(context, finalLoopContext);
    }

    const output = {
      exitReason,
      iterations: iteration,
      previousResults,
      ...completionUpdates,
    };

    const state: NodeState = {
      nodeId: node.id,
      status: exitReason === "error" ? "failed" : "completed",
      output,
      error: lastError,
      attempt: 1,
      startedAt: new Date(startTime),
      completedAt: new Date(),
    };

    this.config.onNodeComplete?.(node.id, state);

    return {
      state,
      contextUpdates: {
        [node.id]: output,
        ...completionUpdates,
      },
      waiting: false,
    };
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      status: deriveNodeStatus(result.completed, result.waiting),
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
      status: deriveNodeStatus(result.completed, result.waiting),
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
