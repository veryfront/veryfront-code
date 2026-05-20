import type { WorkflowQueueItem, WorkflowRun } from "../../types.ts";

interface QueueRequeueBackend {
  getRun(runId: string): Promise<WorkflowRun | null>;
  enqueue(job: WorkflowQueueItem): Promise<void>;
}

export async function requeueRun(backend: QueueRequeueBackend, runId: string): Promise<void> {
  const run = await backend.getRun(runId);
  if (!run) return;

  await backend.enqueue({
    runId: run.id,
    workflowId: run.workflowId,
    input: run.input,
    createdAt: new Date(),
  });
}
