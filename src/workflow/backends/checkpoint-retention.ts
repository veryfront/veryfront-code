import type { Checkpoint } from "../types.ts";
import { MAX_WORKFLOW_CHECKPOINT_HISTORY_ENTRIES } from "../limits.ts";

/**
 * Append a detached checkpoint and retain only the newest bounded history.
 * Retention is strictly append-ordered and never inspects durable timestamps.
 */
export function appendRetainedCheckpoint(
  checkpoints: Checkpoint[],
  checkpoint: Checkpoint,
): void {
  const snapshot = structuredClone(checkpoint);
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
