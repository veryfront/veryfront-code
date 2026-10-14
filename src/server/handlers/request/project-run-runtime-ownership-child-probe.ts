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
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const isSafeInteger = Number.isSafeInteger;
function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
function readCanonicalDescendantCounts(
  value: unknown,
): { total: number; active: number; hasFailures: boolean } | undefined {
  if (!record(value)) return undefined;
  const descendants = ownValue(value, "descendants");
  if (descendants === undefined) {
    return ownValue(value, "descendant_count") === undefined &&
        ownValue(value, "active_descendant_count") === undefined
      ? { total: 0, active: 0, hasFailures: false }
      : undefined;
  }
  if (!record(descendants)) return undefined;
  const total = ownValue(descendants, "total");
  const active = ownValue(descendants, "active");
  const hasFailures = ownValue(descendants, "has_failures");
  return typeof total === "number" && isSafeInteger(total) && total >= 0 &&
      typeof active === "number" && isSafeInteger(active) && active >= 0 &&
      typeof hasFailures === "boolean"
    ? { total, active, hasFailures }
    : undefined;
}
function readStableParentProjection(
  value: unknown,
  projectId: string,
  canonicalRunId: string,
): unknown | undefined {
  if (
    !record(value) || ownValue(value, "project_id") !== projectId ||
    ownValue(value, "id") !== canonicalRunId || typeof ownValue(value, "status") !== "string"
  ) {
    return undefined;
  }
  const descendants = readCanonicalDescendantCounts(value);
  if (descendants === undefined) return undefined;
  const parentRunId = ownValue(value, "parent_run_id");
  const rootRunId = ownValue(value, "root_run_id");
  return {
    id: canonicalRunId,
    project_id: projectId,
    status: ownValue(value, "status"),
    parent_run_id: typeof parentRunId === "string" || parentRunId === null
      ? parentRunId
      : undefined,
    root_run_id: typeof rootRunId === "string" || rootRunId === null ? rootRunId : undefined,
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
      if (!record(acknowledgement) || ownValue(acknowledgement, "appended_count") !== 1) {
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
    const beforeProjection = readStableParentProjection(
      before,
      input.projectId,
      input.canonicalRunId,
    );
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
    const afterProjection = readStableParentProjection(
      after,
      input.projectId,
      input.canonicalRunId,
    );
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
