/**
 * DAG Executor
 *
 * Executes workflow DAGs with proper dependency ordering and parallel execution.
 *
 * @module ai/workflow/executor/dag
 */

import type {
  BranchNodeConfig,
  Checkpoint,
  LoopExecutionContext,
  LoopNodeConfig,
  MapNodeConfig,
  NodeState,
  ParallelNodeConfig,
  SubWorkflowNodeConfig,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowRun,
} from "../../types.ts";
import { generateId, parseDuration } from "../../types.ts";

export type { DAGExecutionResult, DAGExecutorConfig, NodeExecutionResult } from "./types.ts";

import type {
  DAGExecutionResult,
  DAGExecutorConfig,
  DAGExecutorInternalConfig,
  NodeExecutionResult,
} from "./types.ts";
import { deriveNodeStatus, shouldCheckpoint, sleep } from "./utils.ts";
import { buildGraph, getReadyNodes, hasCycle, updateInDegreesForCompletedNodes } from "./graph.ts";

export class DAGExecutor {
  private config: DAGExecutorInternalConfig;

  constructor(config: DAGExecutorConfig) {
    this.config = {
      maxConcurrency: 10,
      debug: false,
      ...config,
    };
  }

  async execute(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    startFromNode?: string,
  ): Promise<DAGExecutionResult> {
    const context = { ...run.context };
    const nodeStates = { ...run.nodeStates };

    const { adjList, inDegree, nodeMap } = buildGraph(nodes);

    updateInDegreesForCompletedNodes(nodeStates, adjList, inDegree);

    if (hasCycle(nodes, adjList)) {
      return {
        completed: false,
        waiting: false,
        context,
        nodeStates,
        error: "Workflow DAG contains cycles",
      };
    }

    let ready = startFromNode ? [startFromNode] : getReadyNodes(inDegree, nodeStates);

    while (ready.length > 0) {
      const batch = ready.slice(0, this.config.maxConcurrency);
      ready = ready.slice(this.config.maxConcurrency);

      const results = await Promise.allSettled(
        batch.map((nodeId) => this.executeNode(nodeMap.get(nodeId)!, context, nodeStates)),
      );

      for (let i = 0; i < batch.length; i++) {
        const nodeId = batch[i]!;
        const result = results[i]!;

        if (result.status !== "fulfilled") {
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

          return {
            completed: false,
            waiting: false,
            context,
            nodeStates,
            error: `Node "${nodeId}" failed: ${error}`,
          };
        }

        const nodeResult = result.value;

        nodeStates[nodeId] = nodeResult.state;
        Object.assign(context, nodeResult.contextUpdates);

        if (nodeResult.waiting) {
          return {
            completed: false,
            waiting: true,
            waitingNode: nodeId,
            context,
            nodeStates,
          };
        }

        const nodeConfig = nodeMap.get(nodeId);
        if (nodeResult.state.status === "completed" && nodeConfig && shouldCheckpoint(nodeConfig)) {
          await this.checkpoint(run.id, nodeId, context, nodeStates);
        }

        if (nodeResult.state.status === "failed") {
          return {
            completed: false,
            waiting: false,
            context,
            nodeStates,
            error: `Node "${nodeId}" failed: ${nodeResult.state.error || "Unknown error"}`,
          };
        }

        if (nodeResult.state.status === "completed" || nodeResult.state.status === "skipped") {
          for (const dependent of adjList.get(nodeId) || []) {
            inDegree.set(dependent, inDegree.get(dependent)! - 1);
          }
        }
      }

      ready = [...ready, ...getReadyNodes(inDegree, nodeStates)];
    }

    return {
      completed: true,
      waiting: false,
      context,
      nodeStates,
    };
  }

  private async executeNode(
    node: WorkflowNode,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<NodeExecutionResult> {
    const nodeId = node.id;

    const existingState = nodeStates[nodeId];
    if (existingState?.status === "completed") {
      return { state: existingState, contextUpdates: {}, waiting: false };
    }

    this.config.onNodeStart?.(nodeId);

    if (node.config.skip && (await node.config.skip(context))) {
      const state = this.config.stepExecutor.createSkippedState(nodeId);
      this.config.onNodeComplete?.(nodeId, state);
      return { state, contextUpdates: {}, waiting: false };
    }

    const config = node.config;

    switch (config.type) {
      case "step":
        return this.executeStepNode(node, context);

      case "parallel":
        return this.executeParallelNode(node, config, context, nodeStates);

      case "map":
        return this.executeMapNode(node, config, context, nodeStates);

      case "branch":
        return this.executeBranchNode(node, config, context, nodeStates);

      case "wait":
        return this.executeWaitNode(node, config, context);

      case "subWorkflow":
        return this.executeSubWorkflowNode(node, config, context, nodeStates);

      case "loop":
        return this.executeLoopNode(node, config, context, nodeStates);

      default:
        throw new Error(
          `Unknown node type "${(config as WorkflowNodeConfig).type}" for node "${node.id}". ` +
            "Valid types are: step, parallel, map, branch, wait, subWorkflow, loop",
        );
    }
  }

  private async executeStepNode(
    node: WorkflowNode,
    context: WorkflowContext,
  ): Promise<NodeExecutionResult> {
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

  private async executeParallelNode(
    node: WorkflowNode,
    config: ParallelNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now();

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

  private async executeMapNode(
    node: WorkflowNode,
    config: MapNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now();

    const items = typeof config.items === "function" ? await config.items(context) : config.items;

    if (!Array.isArray(items)) {
      throw new Error(`Map node "${node.id}" items must be an array`);
    }

    if (items.length === 0) {
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

    const isWorkflowDef = (p: unknown): p is WorkflowDefinition =>
      typeof p === "object" && p !== null && "steps" in p;

    const childNodes: WorkflowNode[] = items.map((item, i) => {
      const childId = `${node.id}_${i}`;

      if (isWorkflowDef(config.processor)) {
        return {
          id: childId,
          config: {
            type: "subWorkflow",
            workflow: config.processor,
            input: item,
            retry: config.retry,
            checkpoint: false,
          },
        };
      }

      const processorConfig: WorkflowNodeConfig = {
        ...(config.processor as WorkflowNode).config,
      };

      if (processorConfig.type === "step") {
        processorConfig.input = item as Record<string, unknown>;
      }

      return { id: childId, config: processorConfig };
    });

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
        nodeStates: {},
        currentNodes: [],
        context: { ...context },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
      });

      Object.assign(nodeStates, result.nodeStates);

      const outputs = childNodes.map((child) => result.nodeStates[child.id]?.output);

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
      this.config.maxConcurrency = originalConcurrency;
    }
  }

  private async executeBranchNode(
    node: WorkflowNode,
    config: BranchNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now();

    const conditionResult = await config.condition(context);
    const branchNodes = conditionResult ? config.then : (config.else || []);

    if (branchNodes.length === 0) {
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

  private async executeWaitNode(
    node: WorkflowNode,
    config: WaitNodeConfig,
    context: WorkflowContext,
  ): Promise<NodeExecutionResult> {
    this.config.onWaiting?.(node.id, config);

    const payload = typeof config.payload === "function"
      ? await config.payload(context)
      : config.payload;

    const state: NodeState = {
      nodeId: node.id,
      status: "running",
      input: {
        type: config.waitType,
        message: config.message,
        payload,
      },
      attempt: 1,
      startedAt: new Date(),
    };

    return {
      state,
      contextUpdates: {},
      waiting: true,
    };
  }

  private async executeSubWorkflowNode(
    node: WorkflowNode,
    config: SubWorkflowNodeConfig,
    context: WorkflowContext,
    _nodeStates: Record<string, NodeState>,
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now();

    if (typeof config.workflow === "string") {
      throw new Error(
        "Resolving workflow by ID is not yet supported in this execution context. Pass the WorkflowDefinition object.",
      );
    }

    const workflowDef = config.workflow;

    const input = typeof config.input === "function"
      ? await config.input(context)
      : (config.input ?? context.input);

    const steps = typeof workflowDef.steps === "function"
      ? workflowDef.steps({ input, context })
      : workflowDef.steps;

    const subRunId = `${node.id}_sub_${generateId()}`;

    const result = await this.execute(steps, {
      id: subRunId,
      workflowId: workflowDef.id,
      status: "running",
      input,
      nodeStates: {},
      currentNodes: [],
      context: { input },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    });

    let finalOutput: unknown = result.context;
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

  private async executeLoopNode(
    node: WorkflowNode,
    config: LoopNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now();
    const previousResults: unknown[] = [];
    let iteration = 0;
    let exitReason: "condition" | "maxIterations" | "error" = "condition";
    let lastError: string | undefined;

    const existingLoopState = context[`${node.id}_loop_state`] as
      | { iteration: number; previousResults: unknown[] }
      | undefined;

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

      if (!(await config.while(context, loopContext))) {
        exitReason = "condition";
        break;
      }

      const steps = typeof config.steps === "function"
        ? config.steps(context, loopContext)
        : config.steps;

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

      if (result.waiting) {
        Object.assign(nodeStates, result.nodeStates);

        const state: NodeState = {
          nodeId: node.id,
          status: "running",
          output: { iteration, waiting: true, previousResults },
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

      if (result.error) {
        lastError = result.error;
        exitReason = "error";
        break;
      }

      previousResults.push(result.context);
      Object.assign(context, result.context);
      Object.assign(nodeStates, result.nodeStates);

      if (config.delay && iteration < config.maxIterations - 1) {
        const delayMs = typeof config.delay === "number"
          ? config.delay
          : parseDuration(config.delay);
        await sleep(delayMs);
      }

      iteration++;
    }

    if (iteration >= config.maxIterations && exitReason !== "condition") {
      exitReason = "maxIterations";
    }

    const finalLoopContext: LoopExecutionContext = {
      iteration,
      totalIterations: iteration,
      previousResults,
      isFirstIteration: false,
      isLastAllowedIteration: true,
    };

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
