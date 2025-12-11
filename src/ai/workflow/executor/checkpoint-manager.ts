
import type { Checkpoint, NodeState, WorkflowContext, WorkflowNode } from "../types.ts";
import { generateId } from "../types.ts";
import type { WorkflowBackend } from "../backends/types.ts";

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
    this.config = {
      debug: false,
      ...config,
    };
  }

  async save(runId: string, checkpoint: Checkpoint): Promise<void> {
    if (this.config.debug) {
      console.log(`[CheckpointManager] Saving checkpoint ${checkpoint.id} for run ${runId}`);
    }

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

  async getLatest(runId: string): Promise<Checkpoint | null> {
    return await this.config.backend.getLatestCheckpoint(runId);
  }

  async getAll(runId: string): Promise<Checkpoint[]> {
    if (this.config.backend.getCheckpoints) {
      return await this.config.backend.getCheckpoints(runId);
    }

    const latest = await this.getLatest(runId);
    return latest ? [latest] : [];
  }

  async prepareResume(
    runId: string,
    nodes: WorkflowNode[],
    fromCheckpoint?: string,
  ): Promise<ResumeInfo | null> {
    let checkpoint: Checkpoint | null;

    if (fromCheckpoint) {
      const all = await this.getAll(runId);
      checkpoint = all.find((c) => c.id === fromCheckpoint) || null;
    } else {
      checkpoint = await this.getLatest(runId);
    }

    if (!checkpoint) {
      return null;
    }

    const startFromNode = this.findNextNode(nodes, checkpoint);

    if (!startFromNode) {
      return null;
    }

    return {
      checkpoint,
      startFromNode,
      context: structuredClone(checkpoint.context),
      nodeStates: structuredClone(checkpoint.nodeStates),
    };
  }

  private findNextNode(
    nodes: WorkflowNode[],
    checkpoint: Checkpoint,
  ): string | null {
    const completedNodeId = checkpoint.nodeId;
    const nodeStates = checkpoint.nodeStates;

    const nodeIndex = new Map<string, number>();
    nodes.forEach((node, index) => nodeIndex.set(node.id, index));

    const checkpointIndex = nodeIndex.get(completedNodeId);
    if (checkpointIndex === undefined) {
      const firstNode = nodes[0];
      return firstNode?.id ?? null;
    }

    for (let i = checkpointIndex + 1; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;

      const state = nodeStates[node.id];

      if (!state || state.status === "pending") {
        return node.id;
      }
    }

    for (const node of nodes) {
      if (node.dependsOn?.includes(completedNodeId)) {
        const state = nodeStates[node.id];
        if (!state || state.status === "pending") {
          return node.id;
        }
      }
    }

    return null;
  }

  shouldCheckpoint(node: WorkflowNode): boolean {
    const config = node.config;

    if (config.checkpoint !== undefined) {
      return config.checkpoint;
    }

    switch (config.type) {
      case "step":
        return "agent" in config && !!config.agent;

      case "wait":
        return true;

      case "parallel":
        return true;

      case "branch":
        return false;

      case "subWorkflow":
        return true;

      default:
        return false;
    }
  }

  async cleanup(runId: string, keepCount: number = 5): Promise<void> {
    const all = await this.getAll(runId);

    if (all.length <= keepCount) {
      return;
    }

    all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const toDelete = all.slice(keepCount);
    const idsToDelete = toDelete.map((c) => c.id);

    if (idsToDelete.length === 0) {
      return;
    }

    if (this.config.debug) {
      console.log(
        `[CheckpointManager] Cleaning up ${idsToDelete.length} old checkpoints for run ${runId}`,
      );
    }

    if (this.config.backend.deleteCheckpoints) {
      await this.config.backend.deleteCheckpoints(runId, idsToDelete);
    } else if (this.config.backend.deleteCheckpoint) {
      for (const id of idsToDelete) {
        await this.config.backend.deleteCheckpoint(runId, id);
      }
    }
  }
}
