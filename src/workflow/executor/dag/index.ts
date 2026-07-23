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
import { generateId, validateConcurrency } from "../../types.ts";
import {
  captureWorkflowSourceIntegrationPolicy,
  runWithWorkflowSourceIntegrationPolicy,
} from "../../source-integration-policy.ts";
import { INVALID_ARGUMENT, NOT_SUPPORTED, ORCHESTRATION_ERROR } from "#veryfront/errors";
import type { CheckpointOwnership } from "../checkpoint-manager.ts";

export type { DAGExecutionResult, DAGExecutorConfig, NodeExecutionResult } from "./types.ts";

import type {
  DAGExecutionResult,
  DAGExecutorConfig,
  DAGExecutorInternalConfig,
  DAGInternalExecutionResult,
  NodeExecutionResult,
} from "./types.ts";
import { deriveNodeStatus, shouldCheckpoint } from "./utils.ts";
import { buildGraph, getReadyNodes, hasCycle, updateInDegreesForCompletedNodes } from "./graph.ts";
import { executeLoopNodeStrategy } from "./loop-node-strategy.ts";
import { executeMapNodeStrategy } from "./map-node-strategy.ts";
import type { ChildGraphExecutionOptions } from "./node-strategy-types.ts";
import { executeCompositeNodeWithPolicy } from "./composite-node-execution.ts";
import {
  applyContextPatch,
  applyRecordPatch,
  cloneExecutionState,
  createContextPatch,
  createRecordPatch,
  createSetContextPatch,
  getOwnRecordValue,
  mergeContextPatches,
  setOwnRecordValue,
} from "./context-patch.ts";
import { childNodeScope, ROOT_NODE_SCOPE, WorkflowNodeNamespace } from "./node-namespace.ts";

export class DAGExecutor {
  private config: DAGExecutorInternalConfig;

  constructor(config: DAGExecutorConfig) {
    const maxConcurrency = config.maxConcurrency === undefined ? 10 : config.maxConcurrency;
    validateConcurrency(maxConcurrency, "maxConcurrency");
    this.config = {
      ...config,
      maxConcurrency,
      debug: config.debug ?? false,
    };
  }

  async execute(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    startFromNode?: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<DAGExecutionResult> {
    const nodeNamespace = new WorkflowNodeNamespace();
    const { contextPatch: _contextPatch, ...result } = await runWithWorkflowSourceIntegrationPolicy(
      run,
      () =>
        this.executeUnwrapped(
          nodes,
          run,
          nodeNamespace,
          ROOT_NODE_SCOPE,
          startFromNode,
          abortSignal,
          ownership,
        ),
    );
    return result;
  }

  private async executeUnwrapped(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    nodeNamespace: WorkflowNodeNamespace,
    nodeScope: string,
    startFromNode?: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<DAGInternalExecutionResult> {
    abortSignal?.throwIfAborted();
    nodeNamespace.preclaimStatic(nodes, nodeScope);
    const context = cloneExecutionState(run.context, "Workflow context");
    const nodeStates = cloneExecutionState(run.nodeStates, "Workflow node states");
    let contextPatch = createSetContextPatch();

    const { adjList, inDegree, nodeMap } = buildGraph(nodes);

    updateInDegreesForCompletedNodes(nodeStates, adjList, inDegree);

    if (hasCycle(nodes, adjList)) {
      return {
        completed: false,
        waiting: false,
        context,
        nodeStates,
        contextPatch,
        error: "Workflow DAG contains cycles",
      };
    }

    let ready = startFromNode ? [startFromNode] : getReadyNodes(inDegree, nodeStates);

    while (ready.length > 0) {
      abortSignal?.throwIfAborted();
      const batch = ready.slice(0, this.config.maxConcurrency);
      ready = ready.slice(this.config.maxConcurrency);

      // Clone the batch baseline and each node's view deeply. Workflow context
      // is durable, structured-cloneable state, so this matches checkpoint and
      // resume semantics while preventing nested mutation from crossing an
      // in-flight node boundary.
      const baseContext = cloneExecutionState(context, "Workflow context");
      const baseNodeStates = cloneExecutionState(nodeStates, "Workflow node states");
      const contextSnapshots = batch.map(() =>
        cloneExecutionState(baseContext, "Workflow context")
      );
      const nodeStateSnapshots = batch.map(() =>
        cloneExecutionState(baseNodeStates, "Workflow node states")
      );

      const results = await Promise.allSettled(
        batch.map((nodeId, i) =>
          this.executeNode(
            nodeMap.get(nodeId)!,
            contextSnapshots[i]!,
            nodeStateSnapshots[i]!,
            nodeNamespace,
            nodeScope,
            abortSignal,
            ownership,
          )
        ),
      );
      // Wait for the full in-flight batch to settle before propagating abort so
      // the caller keeps its lock until cooperative cleanup has completed.
      abortSignal?.throwIfAborted();

      // Record the state of EVERY node in the batch before deciding the batch's
      // outcome. The whole batch already ran (Promise.allSettled), so returning
      // on the first failure would drop the persisted state of later nodes that
      // actually succeeded, and those would re-execute on resume. We capture
      // the earliest waiting/failed node (preserving index-order precedence) and
      // return only after all states are recorded.
      let outcome: { kind: "waiting" | "failed"; nodeId: string; error?: string } | undefined;

      for (let i = 0; i < batch.length; i++) {
        const nodeId = batch[i]!;
        const result = results[i]!;

        if (result.status !== "fulfilled") {
          const error = result.reason instanceof Error
            ? result.reason.message
            : String(result.reason);

          setOwnRecordValue(nodeStates, nodeId, {
            nodeId,
            status: "failed",
            error,
            attempt: (getOwnRecordValue(nodeStates, nodeId)?.attempt ?? 0) + 1,
            completedAt: new Date(),
          });

          if (!outcome) outcome = { kind: "failed", nodeId, error };
          continue;
        }

        const nodeResult = result.value;

        // Convert mutable callback effects into explicit top-level patches.
        // Patches are applied in node declaration order, preserving the existing
        // deterministic policy that a later sibling wins a same-key write.
        const nodeStateSnapshot = nodeStateSnapshots[i]!;
        applyRecordPatch(nodeStates, createRecordPatch(baseNodeStates, nodeStateSnapshot));
        const contextSnapshot = contextSnapshots[i]!;
        const nodeContextPatch = nodeResult.state.status === "failed"
          ? createSetContextPatch()
          : mergeContextPatches(
            createContextPatch(baseContext, contextSnapshot),
            nodeResult.contextPatch,
          );
        const isolatedContextPatch = cloneExecutionState(
          nodeContextPatch,
          "Workflow context changes",
        );
        applyContextPatch(context, isolatedContextPatch);
        contextPatch = mergeContextPatches(contextPatch, isolatedContextPatch);

        setOwnRecordValue(nodeStates, nodeId, nodeResult.state);

        if (nodeResult.waiting) {
          if (!outcome) outcome = { kind: "waiting", nodeId };
          continue;
        }

        const nodeConfig = nodeMap.get(nodeId);
        if (nodeResult.state.status === "completed" && nodeConfig && shouldCheckpoint(nodeConfig)) {
          await this.checkpoint(run.id, nodeId, context, nodeStates, ownership);
        }

        if (nodeResult.state.status === "failed") {
          if (!outcome) {
            outcome = {
              kind: "failed",
              nodeId,
              error: nodeResult.state.error ?? "Unknown error",
            };
          }
          continue;
        }

        if (nodeResult.state.status === "completed" || nodeResult.state.status === "skipped") {
          for (const dependent of adjList.get(nodeId) ?? []) {
            inDegree.set(dependent, inDegree.get(dependent)! - 1);
          }
        }
      }

      if (outcome?.kind === "waiting") {
        return {
          completed: false,
          waiting: true,
          waitingNode: outcome.nodeId,
          context,
          nodeStates,
          contextPatch,
        };
      }

      if (outcome?.kind === "failed") {
        return {
          completed: false,
          waiting: false,
          context,
          nodeStates,
          contextPatch,
          error: `Node "${outcome.nodeId}" failed: ${outcome.error}`,
        };
      }

      // Merge freshly-unblocked nodes with any overflow nodes still queued in
      // `ready` (the slice beyond maxConcurrency that has not run yet). Those
      // overflow nodes have inDegree 0 and no recorded state, so
      // getReadyNodes() would return them again. De-duplicate to avoid
      // scheduling (and double-decrementing dependents for) a node that is
      // already queued.
      const queued = new Set(ready);
      for (const nodeId of getReadyNodes(inDegree, nodeStates)) {
        if (queued.has(nodeId)) continue;
        queued.add(nodeId);
        ready.push(nodeId);
      }
    }

    return {
      completed: true,
      waiting: false,
      context,
      nodeStates,
      contextPatch,
    };
  }

  private async executeNode(
    node: WorkflowNode,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    nodeNamespace: WorkflowNodeNamespace,
    nodeScope: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const nodeId = node.id;

    const existingState = getOwnRecordValue(nodeStates, nodeId);
    if (existingState?.status === "completed") {
      return { state: existingState, contextPatch: createSetContextPatch(), waiting: false };
    }

    this.config.onNodeStart?.(nodeId);

    if (node.config.skip) {
      const shouldSkip = await node.config.skip(context);
      abortSignal?.throwIfAborted();
      if (shouldSkip) {
        const state = this.config.stepExecutor.createSkippedState(nodeId);
        this.config.onNodeComplete?.(nodeId, state);
        return { state, contextPatch: createSetContextPatch(), waiting: false };
      }
    }

    const config = node.config;

    switch (config.type) {
      case "step":
        return this.executeStepNode(node, context, abortSignal);
      case "parallel":
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: (attemptSignal) =>
            this.executeParallelNode(
              node,
              config,
              context,
              nodeStates,
              nodeNamespace,
              nodeScope,
              attemptSignal,
              ownership,
            ),
        });
      case "map":
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: (attemptSignal) =>
            executeMapNodeStrategy({
              node,
              config,
              context,
              nodeStates,
              runtime: {
                executeChildGraph: (nodes, run, options) =>
                  this.executeChildGraph(
                    nodes,
                    run,
                    nodeNamespace,
                    childNodeScope(nodeScope, "map", node.id),
                    options,
                    attemptSignal,
                    ownership,
                  ),
                onNodeComplete: this.config.onNodeComplete,
                abortSignal: attemptSignal,
              },
            }),
        });
      case "branch": {
        // A composite retry is another attempt at the same selected branch.
        // Cache the first successful condition result so context produced by a
        // partially successful child cannot switch the retry to the other arm.
        let hasSelectedBranch = false;
        let selectedBranch = false;
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: async (attemptSignal) => {
            if (!hasSelectedBranch) {
              selectedBranch = await config.condition(context);
              attemptSignal.throwIfAborted();
              hasSelectedBranch = true;
            }
            return await this.executeBranchNode(
              node,
              config,
              selectedBranch,
              context,
              nodeStates,
              nodeNamespace,
              nodeScope,
              attemptSignal,
              ownership,
            );
          },
        });
      }
      case "wait":
        return this.executeWaitNode(node, config, context, abortSignal);
      case "subWorkflow":
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: (attemptSignal) =>
            this.executeSubWorkflowNode(
              node,
              config,
              context,
              nodeNamespace,
              attemptSignal,
              ownership,
            ),
        });
      case "loop":
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: (attemptSignal) =>
            executeLoopNodeStrategy({
              node,
              config,
              context,
              nodeStates,
              runtime: {
                executeChildGraph: (nodes, run) =>
                  this.executeChildGraph(
                    nodes,
                    run,
                    nodeNamespace,
                    childNodeScope(nodeScope, "loop", node.id),
                    undefined,
                    attemptSignal,
                    ownership,
                  ),
                onNodeComplete: this.config.onNodeComplete,
                abortSignal: attemptSignal,
              },
            }),
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
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    const result = await this.config.stepExecutor.execute(node, context, abortSignal);
    abortSignal?.throwIfAborted();

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
      contextPatch: createSetContextPatch(result.success ? { [node.id]: result.output } : {}),
      waiting: false,
    };
  }

  private async executeParallelNode(
    node: WorkflowNode,
    config: ParallelNodeConfig,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    nodeNamespace: WorkflowNodeNamespace,
    nodeScope: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const startTime = Date.now();

    const result = await this.executeUnwrapped(
      config.nodes,
      {
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
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      nodeNamespace,
      childNodeScope(nodeScope, "parallel", node.id),
      undefined,
      abortSignal,
      ownership,
    );
    abortSignal?.throwIfAborted();

    // Keep successful child work inside this isolated composite transaction so
    // a parent retry can skip completed children without losing their context.
    // The outer batch commits this snapshot only if the composite eventually
    // completes or waits; a final failed state discards it in full.
    applyContextPatch(context, result.contextPatch);
    applyRecordPatch(nodeStates, createRecordPatch(nodeStates, result.nodeStates));

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
      contextPatch: result.contextPatch,
      waiting: result.waiting,
    };
  }

  private async executeBranchNode(
    node: WorkflowNode,
    config: BranchNodeConfig,
    conditionResult: boolean,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    nodeNamespace: WorkflowNodeNamespace,
    nodeScope: string,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const startTime = Date.now();

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

      return { state, contextPatch: createSetContextPatch(), waiting: false };
    }

    const result = await this.executeUnwrapped(
      branchNodes,
      {
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
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      nodeNamespace,
      childNodeScope(nodeScope, conditionResult ? "branch-then" : "branch-else", node.id),
      undefined,
      abortSignal,
      ownership,
    );
    abortSignal?.throwIfAborted();

    applyContextPatch(context, result.contextPatch);
    applyRecordPatch(nodeStates, createRecordPatch(nodeStates, result.nodeStates));

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
      contextPatch: result.contextPatch,
      waiting: result.waiting,
    };
  }

  private async executeWaitNode(
    node: WorkflowNode,
    config: WaitNodeConfig,
    context: WorkflowContext,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    this.config.onWaiting?.(node.id, config);

    const payload = typeof config.payload === "function"
      ? await config.payload(context)
      : config.payload;
    abortSignal?.throwIfAborted();

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
      contextPatch: createSetContextPatch(),
      waiting: true,
    };
  }

  private async executeSubWorkflowNode(
    node: WorkflowNode,
    config: SubWorkflowNodeConfig,
    context: WorkflowContext,
    nodeNamespace: WorkflowNodeNamespace,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const startTime = Date.now();

    if (typeof config.workflow === "string") {
      throw NOT_SUPPORTED.create({
        detail:
          "Resolving workflow by ID is not yet supported in this execution context. Pass the WorkflowDefinition object.",
      });
    }

    const workflowDef = config.workflow;
    const subWorkflowNamespace = nodeNamespace.forkForDefinition(workflowDef);

    const input = typeof config.input === "function"
      ? await config.input(context)
      : (config.input ?? context.input);
    abortSignal?.throwIfAborted();

    const steps = typeof workflowDef.steps === "function"
      ? workflowDef.steps({ input, context })
      : workflowDef.steps;
    abortSignal?.throwIfAborted();

    const subRunId = `${node.id}_sub_${generateId()}`;

    const result = await this.executeUnwrapped(
      steps,
      {
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
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      subWorkflowNamespace,
      `${ROOT_NODE_SCOPE}:${JSON.stringify(workflowDef.id)}`,
      undefined,
      abortSignal,
      ownership,
    );
    abortSignal?.throwIfAborted();

    let finalOutput: unknown = result.context;
    if (result.completed && config.output) {
      finalOutput = config.output(result.context);
      abortSignal?.throwIfAborted();
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
      contextPatch: createSetContextPatch(result.completed ? { [node.id]: finalOutput } : {}),
      waiting: result.waiting,
    };
  }

  private async checkpoint(
    runId: string,
    nodeId: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    ownership?: CheckpointOwnership,
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

    const saved = await this.config.checkpointManager.save(runId, checkpoint, ownership);
    // Legacy test/double implementations returned void. Only an explicit false
    // from the owner-aware CheckpointManager means the fenced append was denied.
    if (saved === false) {
      throw ORCHESTRATION_ERROR.create({
        detail: "Workflow execution ownership changed before checkpoint persistence",
      });
    }
  }

  private async executeChildGraph(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    nodeNamespace: WorkflowNodeNamespace,
    nodeScope: string,
    options?: ChildGraphExecutionOptions,
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<DAGInternalExecutionResult> {
    if (options?.maxConcurrency === undefined) {
      return await this.executeUnwrapped(
        nodes,
        run,
        nodeNamespace,
        nodeScope,
        undefined,
        abortSignal,
        ownership,
      );
    }

    // Run the child graph on a scoped executor rather than mutating
    // this.config.maxConcurrency. Concurrent child graphs (e.g. parallel map
    // nodes) would otherwise race on the shared field and leave the parent
    // executor's concurrency permanently corrupted.
    const childExecutor = new DAGExecutor({
      ...this.config,
      maxConcurrency: options.maxConcurrency,
    });
    return await childExecutor.executeUnwrapped(
      nodes,
      run,
      nodeNamespace,
      nodeScope,
      undefined,
      abortSignal,
      ownership,
    );
  }
}
