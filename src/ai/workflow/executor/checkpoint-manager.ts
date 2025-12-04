/**
 * Checkpoint Manager
 *
 * Handles workflow state checkpointing for durability and resume
 */

import type { Checkpoint, NodeState, WorkflowContext, WorkflowNode } from "../types.ts";
import { generateId } from "../types.ts";
import type { WorkflowBackend } from "../backends/types.ts";

/**
 * Checkpoint manager configuration
 */
export interface CheckpointManagerConfig {
  /** Backend for persisting checkpoints */
  backend: WorkflowBackend;
  /** Enable debug logging */
  debug?: boolean;
}

/**
 * Resume information returned when resuming from checkpoint
 */
export interface ResumeInfo {
  /** Checkpoint to resume from */
  checkpoint: Checkpoint;
  /** Node to start execution from */
  startFromNode: string;
  /** Restored context */
  context: WorkflowContext;
  /** Restored node states */
  nodeStates: Record<string, NodeState>;
}

/**
 * Checkpoint Manager class
 *
 * Responsible for:
 * - Saving checkpoints after step completion
 * - Loading checkpoints for resume
 * - Determining resume points
 */
export class CheckpointManager {
  private config: CheckpointManagerConfig;

  constructor(config: CheckpointManagerConfig) {
    this.config = {
      debug: false,
      ...config,
    };
  }

  /**
   * Save a checkpoint for a workflow run
   */
  async save(runId: string, checkpoint: Checkpoint): Promise<void> {
    if (this.config.debug) {
      console.log(`[CheckpointManager] Saving checkpoint ${checkpoint.id} for run ${runId}`);
    }

    await this.config.backend.saveCheckpoint(runId, checkpoint);
  }

  /**
   * Create and save a checkpoint
   */
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

  /**
   * Get the latest checkpoint for a workflow run
   */
  async getLatest(runId: string): Promise<Checkpoint | null> {
    return await this.config.backend.getLatestCheckpoint(runId);
  }

  /**
   * Get all checkpoints for a workflow run
   */
  async getAll(runId: string): Promise<Checkpoint[]> {
    if (this.config.backend.getCheckpoints) {
      return await this.config.backend.getCheckpoints(runId);
    }

    // Fallback: just return latest if getCheckpoints not implemented
    const latest = await this.getLatest(runId);
    return latest ? [latest] : [];
  }

  /**
   * Prepare resume information from a checkpoint
   */
  async prepareResume(
    runId: string,
    nodes: WorkflowNode[],
    fromCheckpoint?: string,
  ): Promise<ResumeInfo | null> {
    let checkpoint: Checkpoint | null;

    if (fromCheckpoint) {
      // Find specific checkpoint
      const all = await this.getAll(runId);
      checkpoint = all.find((c) => c.id === fromCheckpoint) || null;
    } else {
      // Use latest checkpoint
      checkpoint = await this.getLatest(runId);
    }

    if (!checkpoint) {
      return null;
    }

    // Find next node to execute after checkpoint
    const startFromNode = this.findNextNode(nodes, checkpoint);

    if (!startFromNode) {
      // No more nodes to execute
      return null;
    }

    return {
      checkpoint,
      startFromNode,
      context: structuredClone(checkpoint.context),
      nodeStates: structuredClone(checkpoint.nodeStates),
    };
  }

  /**
   * Find the next node to execute after a checkpoint
   */
  private findNextNode(
    nodes: WorkflowNode[],
    checkpoint: Checkpoint,
  ): string | null {
    const completedNodeId = checkpoint.nodeId;
    const nodeStates = checkpoint.nodeStates;

    // Build node lookup
    const nodeIndex = new Map<string, number>();
    nodes.forEach((node, index) => nodeIndex.set(node.id, index));

    // Find the checkpoint node's position
    const checkpointIndex = nodeIndex.get(completedNodeId);
    if (checkpointIndex === undefined) {
      // Checkpoint node not found, start from beginning
      const firstNode = nodes[0];
      return firstNode?.id ?? null;
    }

    // Look for the first incomplete node after the checkpoint
    for (let i = checkpointIndex + 1; i < nodes.length; i++) {
      const node = nodes[i];
      if (!node) continue;

      const state = nodeStates[node.id];

      // Find first node that hasn't completed
      if (!state || state.status === "pending") {
        return node.id;
      }
    }

    // Also check nodes that depend on the checkpoint node
    for (const node of nodes) {
      if (node.dependsOn?.includes(completedNodeId)) {
        const state = nodeStates[node.id];
        if (!state || state.status === "pending") {
          return node.id;
        }
      }
    }

    // No incomplete nodes found
    return null;
  }

  /**
   * Determine if a node should be checkpointed
   */
  shouldCheckpoint(node: WorkflowNode): boolean {
    const config = node.config;

    // Explicit checkpoint configuration
    if (config.checkpoint !== undefined) {
      return config.checkpoint;
    }

    // Default checkpointing rules:
    // - Always checkpoint after agent steps
    // - Always checkpoint before wait/approval
    // - Checkpoint after parallel completion
    switch (config.type) {
      case "step":
        // Checkpoint agent steps, but not tool steps by default
        return "agent" in config && !!config.agent;

      case "wait":
        // Always checkpoint before waiting
        return true;

      case "parallel":
        // Checkpoint after all parallel steps complete
        return true;

      case "branch":
        // Don't checkpoint branches by default
        return false;

      case "subWorkflow":
        // Always checkpoint after sub-workflow
        return true;

      default:
        return false;
    }
  }

  /**
   * Clean up old checkpoints (keep only the most recent N)
   */
  async cleanup(runId: string, keepCount: number = 5): Promise<void> {
    const all = await this.getAll(runId);

    if (all.length <= keepCount) {
      return;
    }

    // Sort by timestamp (newest first)
    all.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Get checkpoints to delete (all except the newest keepCount)
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

    // Use batch delete if available, otherwise delete one by one
    if (this.config.backend.deleteCheckpoints) {
      await this.config.backend.deleteCheckpoints(runId, idsToDelete);
    } else if (this.config.backend.deleteCheckpoint) {
      for (const id of idsToDelete) {
        await this.config.backend.deleteCheckpoint(runId, id);
      }
    }
    // If neither method is available, cleanup is a no-op
  }
}
