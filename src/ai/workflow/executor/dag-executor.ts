
import type {
  BranchNodeConfig,
  Checkpoint,
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
} from "../types.ts";
import { generateId } from "../types.ts";
import type { StepExecutor } from "./step-executor.ts";
import type { CheckpointManager } from "./checkpoint-manager.ts";

export interface DAGExecutorConfig {
  stepExecutor: StepExecutor;
  checkpointManager?: CheckpointManager;
  maxConcurrency?: number;
  onNodeStart?: (nodeId: string) => void;
  onNodeComplete?: (nodeId: string, state: NodeState) => void;
  onWaiting?: (nodeId: string, waitConfig: WaitNodeConfig) => void;
  debug?: boolean;
}

export interface DAGExecutionResult {
  completed: boolean;
  waiting: boolean;
  waitingNode?: string;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
  error?: string;
}

export class DAGExecutor {
  private config: DAGExecutorConfig;

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

    const { adjList, inDegree, nodeMap } = this.buildGraph(nodes);

    for (const [nodeId, state] of Object.entries(nodeStates)) {
      if (state.status === "completed" || state.status === "skipped") {
        for (const dependent of adjList.get(nodeId) || []) {
          const currentDegree = inDegree.get(dependent) ?? 0;
          if (currentDegree > 0) {
            inDegree.set(dependent, currentDegree - 1);
          }
        }
      }
    }

    if (this.hasCycle(nodes, adjList)) {
      return {
        completed: false,
        waiting: false,
        context,
        nodeStates,
        error: "Workflow DAG contains cycles",
      };
    }

    let ready: string[];
    if (startFromNode) {
      ready = [startFromNode];
    } else {
      ready = this.getReadyNodes(inDegree, nodeStates);
    }

    while (ready.length > 0) {
      const batch = ready.slice(0, this.config.maxConcurrency);
      ready = ready.slice(this.config.maxConcurrency);

      const results = await Promise.allSettled(
        batch.map((nodeId) => this.executeNode(nodeMap.get(nodeId)!, context, nodeStates)),
      );

      for (let i = 0; i < batch.length; i++) {
        const nodeId = batch[i]!;
        const result = results[i]!;

        if (result.status === "fulfilled") {
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
          if (
            nodeResult.state.status === "completed" &&
            nodeConfig && this.shouldCheckpoint(nodeConfig)
          ) {
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
              const newDegree = inDegree.get(dependent)! - 1;
              inDegree.set(dependent, newDegree);
            }
          }
        } else {
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
      }

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

      default:
        throw new Error(
          `Unknown node type "${(config as WorkflowNodeConfig).type}" for node "${node.id}". ` +
            `Valid types are: step, parallel, map, branch, wait, subWorkflow`,
        );
    }
  }

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

    const childNodes: WorkflowNode[] = [];

    const isWorkflowDef = (p: any): p is WorkflowDefinition => !!p.steps;


    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const childId = `${node.id}_${i}`;

      let childNode: WorkflowNode;

      if (isWorkflowDef(config.processor)) {
        childNode = {
          id: childId,
          config: {
            type: "subWorkflow",
            workflow: config.processor,
            input: item,
            retry: config.retry,
            checkpoint: false,
          } as SubWorkflowNodeConfig,
        };
      } else {
        const processorConfig = { ...config.processor.config } as any;

        if (processorConfig.type === "step") {
          processorConfig.input = item;
        }

        childNode = {
          id: childId,
          config: processorConfig,
        };
      }

      childNodes.push(childNode);
    }

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

      const outputs = childNodes.map((child) => {
        const childState = result.nodeStates[child.id];
        return childState?.output;
      });

      const state: NodeState = {
        nodeId: node.id,
        status: result.completed ? "completed" : (result.waiting ? "running" : "failed"),
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
      this.config.maxConcurrency = originalConcurrency!;
    }
  }

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

    let workflowDef: WorkflowDefinition;
    if (typeof config.workflow === "string") {
      throw new Error(
        "Resolving workflow by ID is not yet supported in this execution context. Pass the WorkflowDefinition object.",
      );
    } else {
      workflowDef = config.workflow;
    }

    const input = typeof config.input === "function"
      ? await config.input(context)
      : (config.input ?? context.input);

    let steps: WorkflowNode[];
    if (typeof workflowDef.steps === "function") {
      steps = workflowDef.steps({
        input,
        context,
      });
    } else {
      steps = workflowDef.steps;
    }

    const subRunId = `${node.id}_sub_${generateId()}`;

    const result = await this.execute(steps, {
      id: subRunId,
      workflowId: workflowDef.id,
      status: "running",
      input,
      nodeStates: {},
      currentNodes: [],
      context: {
        input,
      },
      checkpoints: [],
      pendingApprovals: [],
      createdAt: new Date(),
    });

    let finalOutput = result.context;

    if (result.completed && config.output) {
      finalOutput = config.output(result.context) as any;
    }

    const state: NodeState = {
      nodeId: node.id,
      status: result.completed ? "completed" : (result.waiting ? "running" : "failed"),
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

  private async executeWaitNode(
    node: WorkflowNode,
    config: WaitNodeConfig,
    context: WorkflowContext,
  ): Promise<{
    state: NodeState;
    contextUpdates: Record<string, unknown>;
    waiting: boolean;
  }> {
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

    return {
      state,
      contextUpdates: {},
      waiting: true,
    };
  }

  private buildGraph(nodes: WorkflowNode[]): {
    adjList: Map<string, string[]>;
    inDegree: Map<string, number>;
    nodeMap: Map<string, WorkflowNode>;
  } {
    const adjList = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    const nodeMap = new Map<string, WorkflowNode>();

    for (const node of nodes) {
      adjList.set(node.id, []);
      inDegree.set(node.id, 0);
      nodeMap.set(node.id, node);
    }

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

    let prevNodeId: string | null = null;
    for (const node of nodes) {
      if (node.dependsOn === undefined && prevNodeId) {
        const isDependent = this.hasAnyDependents(nodes, node.id);
        const currentInDegree = inDegree.get(node.id) ?? 0;

        if (!isDependent && currentInDegree === 0) {
          adjList.get(prevNodeId)!.push(node.id);
          inDegree.set(node.id, inDegree.get(node.id)! + 1);
        }
      }
      prevNodeId = node.id;
    }

    return { adjList, inDegree, nodeMap };
  }

  private hasAnyDependents(nodes: WorkflowNode[], nodeId: string): boolean {
    return nodes.some((n) => n.dependsOn?.includes(nodeId));
  }

  private getReadyNodes(
    inDegree: Map<string, number>,
    nodeStates: Record<string, NodeState>,
  ): string[] {
    const ready: string[] = [];

    for (const [nodeId, degree] of inDegree) {
      const state = nodeStates[nodeId];
      const isReady = degree === 0 &&
        (!state || state.status === "pending");

      if (isReady) {
        ready.push(nodeId);
      }
    }

    return ready;
  }

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

  private shouldCheckpoint(node: WorkflowNode): boolean {
    return node.config.checkpoint ?? false;
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
