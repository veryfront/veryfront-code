import type { NodeStatus, WorkflowNode } from "../../types.ts";

export function deriveNodeStatus(completed: boolean, waiting: boolean): NodeStatus {
  if (completed) return "completed";
  if (waiting) return "running";
  return "failed";
}

export function shouldCheckpoint(node: WorkflowNode): boolean {
  return node.config.checkpoint ?? false;
}

export function sleep(ms: number, abortSignal?: AbortSignal): Promise<void> {
  abortSignal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      abortSignal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timeoutId);
      abortSignal?.removeEventListener("abort", onAbort);
      reject(abortSignal?.reason);
    };
    abortSignal?.addEventListener("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();
  });
}
