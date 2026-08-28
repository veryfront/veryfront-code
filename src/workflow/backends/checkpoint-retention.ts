import type { Checkpoint, CheckpointResumeEnvelope, WorkflowContext } from "../types.ts";
import { serializeWorkflowJson } from "../context-serialization.ts";
import { MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES } from "../limits.ts";

const jsonParse = JSON.parse;
const structuredCloneValue = structuredClone;

function isStructuredCloneRangeError(error: unknown): boolean {
  return error instanceof RangeError;
}

function cloneCheckpointJson<T>(value: T, label: string): T {
  try {
    return structuredCloneValue(value);
  } catch (error) {
    if (!isStructuredCloneRangeError(error)) throw error;
  }
  return jsonParse(
    serializeWorkflowJson(value, label, undefined, { strictContext: false }),
  ) as T;
}

export function cloneRetainedCheckpoint(checkpoint: Checkpoint): Checkpoint {
  const { context, nodeStates, _resumeEnvelope, ...checkpointMetadata } = checkpoint;
  const clone: Checkpoint = {
    ...structuredCloneValue(checkpointMetadata),
    context: cloneCheckpointJson<WorkflowContext>(context, "checkpoint.context"),
    nodeStates: cloneCheckpointJson<Checkpoint["nodeStates"]>(
      nodeStates,
      "checkpoint.nodeStates",
    ),
  };
  if (_resumeEnvelope !== undefined) {
    clone._resumeEnvelope = cloneCheckpointJson<CheckpointResumeEnvelope>(
      _resumeEnvelope,
      "checkpoint._resumeEnvelope",
    );
  }
  return clone;
}

/**
 * Append a detached checkpoint and retain only the newest bounded history.
 * Retention is strictly append-ordered and never inspects durable timestamps.
 */
export function appendRetainedCheckpoint(
  checkpoints: Checkpoint[],
  checkpoint: Checkpoint,
): void {
  const snapshot = cloneRetainedCheckpoint(checkpoint);
  checkpoints.push(snapshot);
  const excess = checkpoints.length - MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES;
  if (excess > 0) checkpoints.splice(0, excess);
}

/**
 * Return history after deleting one oldest occurrence for each requested ID.
 * Checkpoint IDs are not unique, so Set-based filtering would also delete
 * newer occurrences that cleanup intends to retain.
 */
export function deleteOldestCheckpointOccurrences(
  checkpoints: readonly Checkpoint[],
  checkpointIds: readonly string[],
): Checkpoint[] {
  const remainingById = new Map<string, number>();
  for (const id of checkpointIds) {
    remainingById.set(id, (remainingById.get(id) ?? 0) + 1);
  }

  return checkpoints.filter((checkpoint) => {
    const remaining = remainingById.get(checkpoint.id) ?? 0;
    if (remaining === 0) return true;
    if (remaining === 1) remainingById.delete(checkpoint.id);
    else remainingById.set(checkpoint.id, remaining - 1);
    return false;
  });
}
