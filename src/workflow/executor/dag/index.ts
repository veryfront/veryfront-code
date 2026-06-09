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
  NodeState,
  ParallelNodeConfig,
  SubWorkflowNodeConfig,
  WaitNodeConfig,
  WorkflowContext,
  WorkflowNode,
  WorkflowNodeConfig,
  WorkflowRun,
} from "../../types.ts";
import { generateId } from "../../types.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED } from "#veryfront/errors";

export type { DAGExecutionResult, DAGExecutorConfig, NodeExecutionResult } from "./types.ts";

import type {
  DAGExecutionResult,
  DAGExecutorConfig,
  DAGExecutorInternalConfig,
  NodeExecutionResult,
} from "./types.ts";
import { deriveNodeStatus, shouldCheckpoint } from "./utils.ts";
import { buildGraph, getReadyNodes, hasCycle, updateInDegreesForCompletedNodes } from "./graph.ts";
import { executeLoopNodeStrategy } from "./loop-node-strategy.ts";
import { executeMapNodeStrategy } from "./map-node-strategy.ts";
import type { ChildGraphExecutionOptions } from "./node-strategy-types.ts";

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
            attempt: (nodeStates[nodeId]?.attempt ?? 0) + 1,
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
            error: `Node "${nodeId}" failed: ${nodeResult.state.error ?? "Unknown error"}`,
          };
        }

        if (nodeResult.state.status === "completed" || nodeResult.state.status === "skipped") {
          for (const dependent of adjList.get(nodeId) ?? []) {
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
        return executeMapNodeStrategy({
          node,
          config,
          context,
          nodeStates,
          runtime: {
            executeChildGraph: (nodes, run, options) => this.executeChildGraph(nodes, run, options),
            onNodeComplete: this.config.onNodeComplete,
          },
        });
      case "branch":
        return this.executeBranchNode(node, config, context, nodeStates);
      case "wait":
        return this.executeWaitNode(node, config, context);
      case "subWorkflow":
        return this.executeSubWorkflowNode(node, config, context);
      case "loop":
        return executeLoopNodeStrategy({
          node,
          config,
          context,
          nodeStates,
          runtime: {
            executeChildGraph: (nodes, run) => this.executeChildGraph(nodes, run),
            onNodeComplete: this.config.onNodeComplete,
          },
        });
      default:
        throw INVALID_ARGUMENT.create({
          detail:
            `Unknown node type "${(config as WorkflowNodeConfig).type}" for node "${node.id}". ` +
            "Valid types are: step, parallel, map, branch, wait, subWorkflow, loop",
        });
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
      // Carry already-accumulated child states so completed children are
      // skipped on resume instead of re-executing (H8).
      nodeStates,
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

  private async executeBranchNode(
    node: WorkflowNode,
    config: BranchNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now();

    const conditionResult = await config.condition(context);
    const branchNodes = conditionResult ? config.then : (config.else ?? []);

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
      // Carry already-accumulated child states so completed children are
      // skipped on resume instead of re-executing (H8).
      nodeStates,
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
  ): Promise<NodeExecutionResult> {
    const startTime = Date.now();

    if (typeof config.workflow === "string") {
      throw NOT_SUPPORTED.create({
        detail:
          "Resolving workflow by ID is not yet supported in this execution context. Pass the WorkflowDefinition object.",
      });
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

  private async executeChildGraph(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    options?: ChildGraphExecutionOptions,
  ): Promise<DAGExecutionResult> {
    if (!options?.maxConcurrency) {
      return await this.execute(nodes, run);
    }

    // Run the child graph on a scoped executor rather than mutating
    // this.config.maxConcurrency. Concurrent child graphs (e.g. parallel map
    // nodes) would otherwise race on the shared field and leave the parent
    // executor's concurrency permanently corrupted.
    const childExecutor = new DAGExecutor({
      ...this.config,
      maxConcurrency: options.maxConcurrency,
    });
    return await childExecutor.execute(nodes, run);
  }
}
