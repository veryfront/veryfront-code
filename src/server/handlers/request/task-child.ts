import type { TaskContext } from "#veryfront/task/types.ts";
import { ORCHESTRATION_ERROR } from "#veryfront/errors";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { readProjectExecutionParent } from "./project-run-parent.ts";

const encodeComponent = encodeURIComponent;
const readJson = Response.prototype.json;
const apply = Reflect.apply;

/** Ingress owns credentials; task code gets only a parent-bound child capability. */
export function createTaskChildRunner(binding: {
  runId: string;
  projectId: string;
  apiUrl: string;
  eventToken?: string;
  authToken: string;
  signal: AbortSignal;
  fetch: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
}): NonNullable<TaskContext["runChild"]> {
  return async (request) => {
    binding.signal.throwIfAborted();
    if (
      !request.idempotencyKey || request.idempotencyKey.length > 255 ||
      /\s/.test(request.idempotencyKey)
    ) {
      throw ORCHESTRATION_ERROR.create({ detail: "Task child requires a stable Idempotency-Key" });
    }
    const { canonicalRunId: parentId, attemptId } = readProjectExecutionParent(
      binding.eventToken ?? "",
      binding.runId,
      binding.projectId,
    );
    const key = await computeHash(`${parentId}:${request.idempotencyKey}`);
    const invocationKey = `task-child:${key}`;
    const startKey = await computeHash(`${parentId}:${attemptId}:${request.idempotencyKey}`);
    const headers = {
      Authorization: `Bearer ${binding.authToken}`,
      "Content-Type": "application/json",
    };
    const start = await binding.fetch(`${binding.apiUrl}/runs/${parentId}/events`, {
      method: "POST",
      signal: binding.signal,
      headers: {
        ...headers,
        Authorization: `Bearer ${binding.eventToken}`,
        "Idempotency-Key": `task-child-start:${startKey}`,
      },
      body: JSON.stringify({ events: [{ type: "STEP_STARTED", stepId: invocationKey }] }),
    });
    if (!start.ok) {
      throw ORCHESTRATION_ERROR.create({ detail: `Task child start failed (${start.status})` });
    }
    await start.body?.cancel();
    const admitted = await binding.fetch(`${binding.apiUrl}/runs`, {
      method: "POST",
      signal: binding.signal,
      headers: {
        ...headers,
        "Idempotency-Key": invocationKey,
        "X-Veryfront-Run-Event-Token": binding.eventToken!,
      },
      body: JSON.stringify({
        project_id: binding.projectId,
        parent_run_id: parentId,
        target: request.target,
        input: request.input ?? null,
      }),
    });
    if (!admitted.ok) {
      throw ORCHESTRATION_ERROR.create({
        detail: `Task child admission failed (${admitted.status})`,
      });
    }
    const receipt = await apply(readJson, admitted, []);
    const childId = receipt.run_id ?? receipt.id;
    if (typeof childId !== "string") {
      throw ORCHESTRATION_ERROR.create({ detail: "Task child admission omitted its identity" });
    }
    while (true) {
      binding.signal.throwIfAborted();
      const response = await binding.fetch(
        `${binding.apiUrl}/runs/${encodeComponent(childId)}`,
        { headers, signal: binding.signal },
      );
      if (!response.ok) {
        throw ORCHESTRATION_ERROR.create({
          detail: `Task child read failed (${response.status})`,
        });
      }
      const child = await apply(readJson, response, []);
      if (child.parent_run_id !== parentId || child.project_id !== binding.projectId) {
        throw ORCHESTRATION_ERROR.create({
          detail: "Task child result does not match its parent and project",
        });
      }
      if (child.status === "completed") return child.output;
      if (child.status === "failed" || child.status === "cancelled") {
        throw ORCHESTRATION_ERROR.create({
          detail: `Task child ${child.status}`,
        });
      }
      await (binding.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))))(
        250,
      );
    }
  };
}
