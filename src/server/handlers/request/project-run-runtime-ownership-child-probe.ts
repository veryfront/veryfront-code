import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
import { isRuntimeOwnershipProbeApiAuthorityError } from "./project-run-runtime-ownership-probe.ts";
export interface OwnershipChildClient {
  get<T>(
    path: string,
    params?: Record<string, string>,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
  post<T>(path: string, body?: unknown, options?: { signal?: AbortSignal }): Promise<T>;
  postRaw<T>(
    path: string,
    body: string,
    options?: { signal?: AbortSignal; idempotencyKey?: string },
  ): Promise<T>;
}
export interface OwnershipChildProof {
  requestHash: string;
  runBeforeHash?: string;
  runAfterHash?: string;
  authorizationDenied: boolean;
}
const encode = encodeURIComponent;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
function readCanonicalDescendantCounts(
  value: unknown,
): { total: number; active: number; hasFailures: boolean } | undefined {
  if (!record(value)) return undefined;
  const descendants = value.descendants;
  if (descendants === undefined) {
    return value.descendant_count === undefined && value.active_descendant_count === undefined
      ? { total: 0, active: 0, hasFailures: false }
      : undefined;
  }
  if (!record(descendants)) return undefined;
  const total = descendants.total;
  const active = descendants.active;
  const hasFailures = descendants.has_failures;
  return typeof total === "number" && Number.isSafeInteger(total) && total >= 0 &&
      typeof active === "number" && Number.isSafeInteger(active) && active >= 0 &&
      typeof hasFailures === "boolean"
    ? { total, active, hasFailures }
    : undefined;
}
function readStableParentProjection(value: unknown, projectId: string): unknown | undefined {
  if (
    !record(value) || value.project_id !== projectId || typeof value.id !== "string" ||
    typeof value.status !== "string"
  ) {
    return undefined;
  }
  const descendants = readCanonicalDescendantCounts(value);
  if (descendants === undefined) return undefined;
  return {
    id: value.id,
    project_id: value.project_id,
    status: value.status,
    parent_run_id: typeof value.parent_run_id === "string" || value.parent_run_id === null
      ? value.parent_run_id
      : undefined,
    root_run_id: typeof value.root_run_id === "string" || value.root_run_id === null
      ? value.root_run_id
      : undefined,
    descendants,
  };
}

/** Prepare one legitimate task invocation while current; later POST /runs directly with its retained issuer authority. */
export function createRuntimeOwnershipChildProbe(
  input: {
    projectId: string;
    canonicalRunId: string;
    targetTaskId: string;
    createWriter(signal: AbortSignal): OwnershipChildClient;
    createReader(signal: AbortSignal): OwnershipChildClient;
    createEvents(signal: AbortSignal): OwnershipChildClient;
  },
) {
  let retained: { wire: string; key: string; sourcePath: string } | undefined;
  return async (
    request: { sourcePath: string; staleAfterCancel: boolean; signal: AbortSignal },
  ): Promise<OwnershipChildProof> => {
    const { signal } = request;
    const writer = input.createWriter(signal), reader = input.createReader(signal);
    const runPath = `/runs/${encode(input.canonicalRunId)}`;
    if (!request.staleAfterCancel) {
      const invocation = `task-child:${await computeHash(
        `${input.canonicalRunId}:${request.sourcePath}:owned-child-proof`,
      )}`;
      const events = input.createEvents(signal);
      const startKey = `task-child-start:${await computeHash(
        `${input.canonicalRunId}:${request.sourcePath}:owned-child-proof:start`,
      )}`;
      const acknowledgement: unknown = await events.postRaw(
        `${runPath}/events`,
        privateJsonStringify({ events: [{ type: "STEP_STARTED", stepId: invocation }] }),
        { signal, idempotencyKey: startKey },
      );
      if (!record(acknowledgement) || acknowledgement.appended_count !== 1) {
        throw new Error("Owned child invocation was not acknowledged");
      }
      const wire = privateJsonStringify({
        project_id: input.projectId,
        parent_run_id: input.canonicalRunId,
        target: { type: "task", id: input.targetTaskId },
        input: { runtimeOwnershipChildProbe: true },
      });
      retained = { wire, key: invocation, sourcePath: request.sourcePath };
      return { requestHash: await computeHash(wire), authorizationDenied: false };
    }
    if (!retained || retained.sourcePath !== request.sourcePath) {
      throw new Error("No current owned child invocation receipt");
    }
    const before: unknown = await reader.get(runPath, undefined, { signal });
    const beforeProjection = readStableParentProjection(before, input.projectId);
    if (beforeProjection === undefined) {
      throw new Error("Child lineage readback is incomplete");
    }
    let rejected = false;
    try {
      await writer.postRaw("/runs", retained.wire, { signal, idempotencyKey: retained.key });
    } catch (error) {
      if (!isRuntimeOwnershipProbeApiAuthorityError(error, "child-admission")) {
        throw new Error("Child admission failed without authorization denial");
      }
      rejected = true;
    }
    if (!rejected) throw new Error("Child creation was accepted after cancellation");
    const after: unknown = await reader.get(runPath, undefined, { signal });
    const afterProjection = readStableParentProjection(after, input.projectId);
    if (afterProjection === undefined) {
      throw new Error("Denied child creation changed parent state or lineage");
    }
    const beforeHash = await computeHash(privateJsonStringify(beforeProjection)),
      afterHash = await computeHash(privateJsonStringify(afterProjection));
    if (beforeHash !== afterHash) {
      throw new Error("Denied child creation changed parent state or lineage");
    }
    return {
      requestHash: await computeHash(retained.wire),
      runBeforeHash: beforeHash,
      runAfterHash: afterHash,
      authorizationDenied: true,
    };
  };
}
