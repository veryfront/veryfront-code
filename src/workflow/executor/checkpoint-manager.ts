import { logger as baseLogger } from "#veryfront/utils";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import type { Checkpoint, NodeState, WorkflowContext, WorkflowNode } from "../types.ts";
import { generateId } from "../types.ts";
import type { WorkflowBackend } from "../backends/types.ts";
import { buildGraph, getReadyNodes, updateInDegreesForCompletedNodes } from "./dag/graph.ts";

const logger = baseLogger.component("checkpoint-manager");
const numberIsSafeInteger = Number.isSafeInteger;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectHasOwn = Object.hasOwn;

function getOwnDataProperty<T>(value: unknown, key: PropertyKey): T | undefined {
  if (
    (typeof value !== "object" && typeof value !== "function") ||
    value === null
  ) return undefined;
  try {
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    return descriptor && objectHasOwn(descriptor, "value") ? descriptor.value as T : undefined;
  } catch {
    return undefined;
  }
}

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

/** Canonical run identity used to fence auxiliary writes from stale workers. */
export interface CheckpointOwnership {
  runId: string;
  workerId: string;
}

export class CheckpointManager {
  private config: CheckpointManagerConfig;

  constructor(config: CheckpointManagerConfig) {
    this.config = { debug: false, ...config };
  }

  async save(
    runId: string,
    checkpoint: Checkpoint,
    ownership?: CheckpointOwnership,
  ): Promise<boolean> {
    logger.debug("Saving checkpoint", { checkpointId: checkpoint.id, runId });

    if (ownership) {
      const saveOwned = this.config.backend.saveCheckpointIfStatusAndWorker;
      if (!saveOwned) return false;
      return await saveOwned.call(
        this.config.backend,
        runId,
        ownership.runId,
        ["running"],
        ownership.workerId,
        checkpoint,
      );
    }

    await this.config.backend.saveCheckpoint(runId, checkpoint);
    return true;
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
    const { backend } = this.config;
    if (backend.getCheckpoints) return backend.getCheckpoints(runId);

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
    const { adjList, inDegree } = buildGraph(nodes);
    const existingCompletedState = nodeStates[completedNodeId];
    const completedState: NodeState = existingCompletedState
      ? {
        ...existingCompletedState,
        status: "completed",
        completedAt: existingCompletedState.completedAt ?? checkpoint.timestamp,
      }
      : {
        nodeId: completedNodeId,
        status: "completed",
        attempt: 1,
        startedAt: checkpoint.timestamp,
        completedAt: checkpoint.timestamp,
      };
    const readinessStates = {
      ...nodeStates,
      [completedNodeId]: completedState,
    };
    updateInDegreesForCompletedNodes(readinessStates, adjList, inDegree);
    return getReadyNodes(inDegree, readinessStates)[0] ?? null;
  }

  shouldCheckpoint(node: WorkflowNode): boolean {
    const { config } = node;
    const explicitCheckpoint = getOwnDataProperty<unknown>(config, "checkpoint");

    if (explicitCheckpoint !== undefined) return explicitCheckpoint === true;

    const configType = getOwnDataProperty<string>(config, "type");
    if (configType === "step") {
      return !!getOwnDataProperty(config, "agent");
    }

    const checkpointDefaults: Record<string, boolean> = {
      wait: true,
      parallel: true,
      subWorkflow: true,
      branch: false,
    };

    return configType && objectHasOwn(checkpointDefaults, configType)
      ? checkpointDefaults[configType]!
      : false;
  }

  /** Retain the newest appended checkpoints, independent of their durable timestamps. */
  async cleanup(runId: string, keepCount: number = 5): Promise<void> {
    if (!numberIsSafeInteger(keepCount) || keepCount < 0) {
      throw INVALID_ARGUMENT.create({
        detail: "Checkpoint keepCount must be a non-negative safe integer",
      });
    }
    const all = await this.getAll(runId);
    if (all.length <= keepCount) return;

    const idsToDelete = all.slice(0, all.length - keepCount).map((checkpoint) => checkpoint.id);
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
