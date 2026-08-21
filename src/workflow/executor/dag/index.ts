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
  ExecutionScope,
  NodeExecutionResult,
} from "./types.ts";
import { deriveNodeStatus, shouldCheckpoint } from "./utils.ts";
import { buildGraph, getReadyNodes, hasCycle, updateInDegreesForCompletedNodes } from "./graph.ts";
import { executeLoopNodeStrategy } from "./loop-node-strategy.ts";
import {
  setActiveSpanAttributes,
  setActiveSpanErrorStatus,
  withSpan,
} from "#veryfront/observability/tracing/otlp-setup.ts";
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
  mergeContextPatches,
} from "./context-patch.ts";

const RESUMABLE_COMPOSITE_TYPES = new Set(["branch", "parallel", "map", "loop", "subWorkflow"]);

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
    abortSignal?: AbortSignal,
    ownership?: CheckpointOwnership,
  ): Promise<DAGExecutionResult> {
    const scope: ExecutionScope = {
      rootRunId: run.id,
      executionRunId: run.id,
      // Read the reason execution stopped once, here, from the only run record
      // that carries it. Every child graph below runs against a synthetic run
      // whose status is always "running" and would otherwise read a crash.
      resumingWait: run.status === "waiting",
      ownership,
    };
    const { contextPatch: _contextPatch, ...result } = await runWithWorkflowSourceIntegrationPolicy(
      run,
      () => this.executeUnwrapped(nodes, run, scope, startFromNode, abortSignal),
    );
    return result;
  }

  private async executeUnwrapped(
    nodes: WorkflowNode[],
    run: WorkflowRun,
    scope: ExecutionScope,
    startFromNode?: string,
    abortSignal?: AbortSignal,
  ): Promise<DAGInternalExecutionResult> {
    abortSignal?.throwIfAborted();
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
    if (!startFromNode) {
      // A node recorded as running means different things depending on why the
      // run stopped, and the two must not be confused.
      //
      // A waiting run parked deliberately: the running node is a composite whose
      // child is on a human decision. Re-enter it so the child resumes.
      //
      // Any other run reaching here is recovering from a worker that died
      // mid-node. Nothing will ever write that node a terminal state, and
      // getReadyNodes does not consider it ready, so leaving it be strands the
      // run. Re-run it. That matches what already happens when a worker dies
      // before writing any state at all -- the node looks untouched and runs
      // again -- except that the recorded attempt now bounds the retries.
      //
      // This reads the reason off the scope, never off `run`: a child graph's
      // run is synthetic and permanently "running", so inferring it here would
      // charge every nested composite re-entry to the crash budget on an
      // ordinary approval.
      const { resumingWait } = scope;
      // Only the top-level run has a row in the backend to write. Composites
      // execute their children against synthetic runs (`${node.id}_parallel`,
      // `_branch`, `_iter_N`) whose node states are a different keyspace: a loop
      // iteration's run carries only that iteration's children. Persisting one
      // of those under the real run id would replace the run's whole node-state
      // map with an iteration-local fragment, stranding every completed
      // top-level node as pending and re-running the workflow from the start --
      // the duplicate side effect this recovery path exists to prevent.
      // Child recoveries are persisted by the parent when it returns.
      const isDurableRun = run.id === scope.rootRunId;
      const exhausted: Array<{ nodeId: string; attempts: number; maxAttempts: number }> = [];
      for (const [nodeId, degree] of inDegree) {
        if (degree !== 0 || ready.includes(nodeId)) continue;
        const state = nodeStates[nodeId];
        if (state?.status !== "running") continue;
        const node = nodeMap.get(nodeId);
        if (!node) continue;
        // A composite recorded running on a wait resume encloses the decision.
        // Re-enter it so the child resumes; nothing crashed, so it spends no
        // recovery budget.
        if (resumingWait && RESUMABLE_COMPOSITE_TYPES.has(node.config.type)) {
          ready.push(nodeId);
          continue;
        }
        // A wait recorded as running is parked on its decision, never a dead
        // worker: nothing executes while it waits, so there is nothing to
        // recover. Re-running it would re-raise an approval that already exists.
        // This also matters inside a loop or branch child graph, whose synthetic
        // run is always "running" even while its wait is parked.
        if (node.config.type === "wait") continue;

        // Anything else recorded running falls through to recovery even on a
        // wait resume. Parked and interrupted are not exclusive: a worker can
        // die with a step in flight, leave a sibling wait parked, and the run
        // then reaches "waiting" with that step still marked running. Treating
        // the whole resume as "nothing to recover" strands it -- and because
        // nothing is left ready, the graph reports completion and the workflow
        // finishes having silently skipped it.

        // The step executor restarts its own retry loop at 1 and overwrites the
        // recorded attempt, so it cannot bound anything across worker deaths.
        // Count them here instead, or repeated crashes re-run the node forever
        // and duplicate whatever side effect it performs.
        //
        // An interrupted attempt never finished, so it does not consume the
        // node's retry budget outright -- a default node still gets recovered
        // once. What it does consume is one recovery: the count below is
        // written back before scheduling, and nothing overwrites it if the
        // worker dies again, so the next resume sees a higher number.
        const maxAttempts = node.config.retry?.maxAttempts ?? 1;
        const attempts = state.attempt ?? 0;
        if (attempts > maxAttempts) {
          exhausted.push({ nodeId, attempts, maxAttempts });
          continue;
        }
        nodeStates[nodeId] = { ...state, attempt: attempts + 1 };
        if (isDurableRun) {
          const recovered = await this.config.onRecoveryScheduled?.({
            runId: scope.rootRunId,
            nodeId,
            nodeStates: structuredClone(nodeStates),
            ownership: scope.ownership,
          });
          if (recovered === false) {
            throw ORCHESTRATION_ERROR.create({
              detail:
                `Cannot recover workflow node "${nodeId}" because execution ownership changed`,
            });
          }
        }
        ready.push(nodeId);
      }

      if (exhausted.length > 0) {
        const first = exhausted[0]!;
        for (const { nodeId, attempts, maxAttempts } of exhausted) {
          nodeStates[nodeId] = {
            ...nodeStates[nodeId]!,
            status: "failed",
            error:
              `Interrupted after ${attempts} of ${maxAttempts} attempt(s); retry budget exhausted`,
            completedAt: new Date(),
          };
        }
        return {
          completed: false,
          waiting: false,
          context,
          nodeStates,
          contextPatch,
          error: `Node "${first.nodeId}" was interrupted after ${first.attempts} of ` +
            `${first.maxAttempts} attempt(s); retry budget exhausted`,
        };
      }
    }

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
            scope,
            abortSignal,
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

          nodeStates[nodeId] = {
            nodeId,
            status: "failed",
            error,
            attempt: (nodeStates[nodeId]?.attempt ?? 0) + 1,
            completedAt: new Date(),
          };

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

        nodeStates[nodeId] = nodeResult.state;

        if (nodeResult.waiting) {
          // A composite reports the child that actually suspended. Falling back
          // to this node covers a top-level wait, which is its own waiting node.
          if (!outcome) outcome = { kind: "waiting", nodeId: nodeResult.waitingNode ?? nodeId };
          continue;
        }

        const nodeConfig = nodeMap.get(nodeId);
        if (nodeResult.state.status === "completed" && nodeConfig && shouldCheckpoint(nodeConfig)) {
          await this.checkpoint(run.id, nodeId, context, nodeStates, scope.ownership);
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
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    abortSignal?.throwIfAborted();
    const nodeId = node.id;

    const existingState = nodeStates[nodeId];
    if (existingState?.status === "completed") {
      // Replayed from a checkpoint: no work happens in this execution, so no span.
      return { state: existingState, contextPatch: createSetContextPatch(), waiting: false };
    }

    return await withSpan(
      `workflow.node ${nodeId}`,
      async () => {
        const result = await this.dispatchNode(
          node,
          context,
          nodeStates,
          scope,
          abortSignal,
        );
        // A failing node returns a failed state rather than throwing, so the span's own
        // catch never runs. Without this the span stays UNSET and a failed run is
        // indistinguishable from a successful one in any trace backend.
        setActiveSpanAttributes({ "workflow.node.status": result.state.status });
        if (result.state.status === "failed") {
          // The failure must be visible to errored-span queries, but the node's error
          // text is user-supplied and can carry customer data -- the same reason retry
          // events carry a classification rather than a message. Identify the node, not
          // the failure text; the detail stays in the run record and the logs.
          setActiveSpanErrorStatus(new Error(`Node "${nodeId}" failed`));
        }
        return result;
      },
      {
        "workflow.run_id": scope.rootRunId,
        "workflow.node.id": nodeId,
        "workflow.node.type": node.config.type,
      },
      {
        errorStatus: () => new Error(`Node "${nodeId}" failed`),
      },
    );
  }

  /** Executes a node's type-specific strategy. Always runs inside its `workflow.node` span. */
  private async dispatchNode(
    node: WorkflowNode,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    const nodeId = node.id;
    this.config.onNodeStart?.(nodeId);

    if (node.config.skip) {
      const shouldSkip = await node.config.skip(context);
      abortSignal?.throwIfAborted();
      if (shouldSkip) {
        setActiveSpanAttributes({ "workflow.node.skipped": true });
        const state = this.config.stepExecutor.createSkippedState(nodeId);
        this.config.onNodeComplete?.(nodeId, state);
        return { state, contextPatch: createSetContextPatch(), waiting: false };
      }
    }

    const config = node.config;

    switch (config.type) {
      case "step":
        return this.executeStepNode(node, context, scope.executionRunId, abortSignal);
      case "parallel":
        return executeCompositeNodeWithPolicy({
          node,
          parentSignal: abortSignal,
          cancellationGracePeriod: this.config.cancellationGracePeriod,
          execute: (attemptSignal) =>
            this.executeParallelNode(node, config, context, nodeStates, scope, attemptSignal),
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
                  this.executeChildGraph(nodes, run, scope, options, attemptSignal),
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
              scope,
              attemptSignal,
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
            this.executeSubWorkflowNode(node, config, context, nodeStates, scope, attemptSignal),
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
                  this.executeChildGraph(nodes, run, scope, undefined, attemptSignal),
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
    runId: string,
    abortSignal?: AbortSignal,
  ): Promise<NodeExecutionResult> {
    const result = await this.config.stepExecutor.execute(
      node,
      context,
      abortSignal,
      runId,
    );
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
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
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
      scope,
      undefined,
      abortSignal,
    );
    abortSignal?.throwIfAborted();

    // Keep successful child work inside this isolated composite transaction so
    // a parent retry can skip completed children without losing their context.
    // The outer batch commits this snapshot only if the composite eventually
    // completes or waits; a final failed state discards it in full.
    applyContextPatch(context, result.contextPatch);
    applyRecordPatch(nodeStates, createRecordPatch({}, result.nodeStates));

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
      waitingNode: result.waitingNode,
    };
  }

  private async executeBranchNode(
    node: WorkflowNode,
    config: BranchNodeConfig,
    conditionResult: boolean,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
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
      scope,
      undefined,
      abortSignal,
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
      waitingNode: result.waitingNode,
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
    nodeStates: Record<string, NodeState>,
    scope: ExecutionScope,
    abortSignal?: AbortSignal,
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

    const input = typeof config.input === "function"
      ? await config.input(context)
      : (config.input ?? context.input);
    abortSignal?.throwIfAborted();

    const steps = typeof workflowDef.steps === "function"
      ? workflowDef.steps({ input, context })
      : workflowDef.steps;
    abortSignal?.throwIfAborted();

    const subRunId = `${node.id}_sub_${generateId()}`;
    // The sub-run record is synthetic and never persisted, so its id is a debugging
    // attribute only — `workflow.run_id` keeps pointing at the root run.
    setActiveSpanAttributes({
      "workflow.sub_run_id": subRunId,
      "workflow.sub_workflow_id": workflowDef.id,
    });

    const result = await this.executeUnwrapped(
      steps,
      {
        id: subRunId,
        workflowId: workflowDef.id,
        status: "running",
        input,
        nodeStates: { ...nodeStates },
        currentNodes: [],
        context: { input },
        checkpoints: [],
        pendingApprovals: [],
        createdAt: new Date(),
        sourceIntegrationPolicy: captureWorkflowSourceIntegrationPolicy(),
      },
      scope,
      undefined,
      abortSignal,
    );
    abortSignal?.throwIfAborted();

    applyRecordPatch(nodeStates, createRecordPatch(nodeStates, result.nodeStates));

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
      waitingNode: result.waitingNode,
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
    scope: ExecutionScope,
    options?: ChildGraphExecutionOptions,
    abortSignal?: AbortSignal,
  ): Promise<DAGInternalExecutionResult> {
    if (!options?.maxConcurrency) {
      return await this.executeUnwrapped(nodes, run, scope, undefined, abortSignal);
    }

    // Run the child graph on a scoped executor rather than mutating
    // this.config.maxConcurrency. Concurrent child graphs (e.g. parallel map
    // nodes) would otherwise race on the shared field and leave the parent
    // executor's concurrency permanently corrupted.
    const childExecutor = new DAGExecutor({
      ...this.config,
      maxConcurrency: options.maxConcurrency,
    });
    return await childExecutor.executeUnwrapped(nodes, run, scope, undefined, abortSignal);
  }
}
