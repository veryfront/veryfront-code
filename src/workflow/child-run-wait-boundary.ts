import type { WorkflowChildRunWaitBoundary, WorkflowRun } from "./types.ts";
import {
  MAX_WORKFLOW_CHILD_RUN_DEPENDENCIES,
  MAX_WORKFLOW_CHILD_RUN_ID_CODE_UNITS,
  MAX_WORKFLOW_CHILD_RUN_NODE_ID_CODE_UNITS,
} from "./limits.ts";
import { isCanonicalNonEmptyString } from "./dsl/validation.ts";

/** Read the child-run waits named by the run's current durable pause. */
export function childRunWaitBoundary(run: WorkflowRun): WorkflowChildRunWaitBoundary[] {
  return run.currentNodes.flatMap((nodeId) => {
    const state = run.nodeStates[nodeId];
    const input = state?.input as { type?: unknown; runIds?: unknown } | undefined;
    if (
      (state?.status !== "running" && state?.status !== "completed") ||
      input?.type !== "child_run" || !Array.isArray(input.runIds) || input.runIds.length === 0 ||
      input.runIds.length > MAX_WORKFLOW_CHILD_RUN_DEPENDENCIES ||
      nodeId.length > MAX_WORKFLOW_CHILD_RUN_NODE_ID_CODE_UNITS ||
      input.runIds.some((runId) =>
        !isCanonicalNonEmptyString(runId) ||
        runId.length > MAX_WORKFLOW_CHILD_RUN_ID_CODE_UNITS || !/^[a-zA-Z0-9_-]+$/.test(runId)
      ) ||
      typeof state._waitInstanceId !== "string" || state._waitInstanceId.length === 0
    ) return [];
    return [{ nodeId, waitInstanceId: state._waitInstanceId, runIds: input.runIds as string[] }];
  });
}

/** Compare the exact wait instances and child ids that make up one pause boundary. */
export function sameChildRunWaitBoundary(
  current: readonly WorkflowChildRunWaitBoundary[],
  expected: readonly WorkflowChildRunWaitBoundary[],
): boolean {
  if (current.length !== expected.length) return false;
  return current.every((boundary, index) => {
    const candidate = expected[index];
    return candidate !== undefined && boundary.nodeId === candidate.nodeId &&
      boundary.waitInstanceId === candidate.waitInstanceId &&
      boundary.runIds.length === candidate.runIds.length &&
      boundary.runIds.every((runId, runIndex) => runId === candidate.runIds[runIndex]);
  });
}
