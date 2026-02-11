import { logger as baseLogger } from "#veryfront/utils";
import type { Checkpoint, NodeState, WorkflowContext, WorkflowNode } from "../types.ts";
import { generateId } from "../types.ts";
import type { WorkflowBackend } from "../backends/types.ts";

const logger = baseLogger.component("checkpoint-manager");

export interface CheckpointManagerConfig {
  backend: WorkflowBackend;
  debug?: boolean;
}

export interface ResumeInfo {
  checkpoint: Checkpoint;
  startFromNode: string;
  context: WorkflowContext;
  nodeStates: Record<string, NodeState>;
}

export class CheckpointManager {
  private config: CheckpointManagerConfig;

  constructor(config: CheckpointManagerConfig) {
    this.config = { debug: false, ...config };
  }

  async save(runId: string, checkpoint: Checkpoint): Promise<void> {
    logger.debug("Saving checkpoint", { checkpointId: checkpoint.id, runId });
    await this.config.backend.saveCheckpoint(runId, checkpoint);
  }

  async createCheckpoint(
    runId: string,
    nodeId: string,
    context: WorkflowContext,
    nodeStates: Record<string, NodeState>,
  ): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: generateId("cp"),
      nodeId,
      timestamp: new Date(),
      context: structuredClone(context),
      nodeStates: structuredClone(nodeStates),
    };

    await this.save(runId, checkpoint);
    return checkpoint;
  }

  getLatest(runId: string): Promise<Checkpoint | null> {
    return this.config.backend.getLatestCheckpoint(runId);
  }

  async getAll(runId: string): Promise<Checkpoint[]> {
    const { getCheckpoints } = this.config.backend;
    if (getCheckpoints) return getCheckpoints(runId);

    const latest = await this.getLatest(runId);
    return latest ? [latest] : [];
  }

  async prepareResume(
    runId: string,
    nodes: WorkflowNode[],
    fromCheckpoint?: string,
  ): Promise<ResumeInfo | null> {
    const checkpoint = fromCheckpoint
      ? (await this.getAll(runId)).find((c) => c.id === fromCheckpoint) ?? null
      : await this.getLatest(runId);

    if (!checkpoint) return null;

    const startFromNode = this.findNextNode(nodes, checkpoint);
    if (!startFromNode) return null;

    return {
      checkpoint,
      startFromNode,
      context: structuredClone(checkpoint.context),
      nodeStates: structuredClone(checkpoint.nodeStates),
    };
  }

  private findNextNode(nodes: WorkflowNode[], checkpoint: Checkpoint): string | null {
    const { nodeId: completedNodeId, nodeStates } = checkpoint;

    const nodeIndex = new Map<string, number>();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (node) nodeIndex.set(node.id, i);
    }

    const checkpointIndex = nodeIndex.get(completedNodeId);
    if (checkpointIndex === undefined) return nodes[0]?.id ?? null;

    for (let i = checkpointIndex + 1; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;

      const state = nodeStates[node.id];
      if (!state || state.status === "pending") return node.id;
    }

    for (const node of nodes) {
      if (!node.dependsOn?.includes(completedNodeId)) continue;

      const state = nodeStates[node.id];
      if (!state || state.status === "pending") return node.id;
    }

    return null;
  }

  shouldCheckpoint(node: WorkflowNode): boolean {
    const { config } = node;

    if (config.checkpoint !== undefined) return config.checkpoint;

    if (config.type === "step") {
      return "agent" in config && !!config.agent;
    }

    const checkpointDefaults: Record<string, boolean> = {
      wait: true,
      parallel: true,
      subWorkflow: true,
      branch: false,
    };

    return checkpointDefaults[config.type] ?? false;
  }

  async cleanup(runId: string, keepCount: number = 5): Promise<void> {
    const all = await this.getAll(runId);
    if (all.length <= keepCount) return;

    all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const idsToDelete = all.slice(keepCount).map((c) => c.id);
    if (idsToDelete.length === 0) return;

    logger.debug("Cleaning up old checkpoints", {
      count: idsToDelete.length,
      runId,
    });

    const { backend } = this.config;

    if (backend.deleteCheckpoints) {
      await backend.deleteCheckpoints(runId, idsToDelete);
      return;
    }

    if (!backend.deleteCheckpoint) return;

    for (const id of idsToDelete) {
      await backend.deleteCheckpoint(runId, id);
    }
  }
}
