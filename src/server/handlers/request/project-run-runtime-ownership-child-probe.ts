import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { privateJsonStringify } from "#veryfront/security/private-json.ts";
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
const errorProto = Error.prototype,
  isProto = Object.prototype.isPrototypeOf,
  exec = RegExp.prototype.exec,
  apply = Reflect.apply;
const denial = /(?:^|\D)(401|403)(?:\D|$)/;
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
function readCanonicalDescendantCounts(
  value: unknown,
): { total: number; active: number } | undefined {
  if (!record(value)) return undefined;
  const descendants = value.descendants;
  if (!record(descendants)) return undefined;
  const total = descendants.total;
  const active = descendants.active;
  return typeof total === "number" && Number.isSafeInteger(total) && total >= 0 &&
      typeof active === "number" && Number.isSafeInteger(active) && active >= 0
    ? { total, active }
    : undefined;
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
      const acknowledgement: unknown = await events.post(`${runPath}/events`, {
        events: [{ type: "STEP_STARTED", stepId: invocation }],
      }, { signal });
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
    const beforeDescendants = readCanonicalDescendantCounts(before);
    if (
      !record(before) || before.project_id !== input.projectId || beforeDescendants === undefined
    ) {
      throw new Error("Child lineage readback is incomplete");
    }
    let rejected = false;
    try {
      await writer.postRaw("/runs", retained.wire, { signal, idempotencyKey: retained.key });
    } catch (error) {
      const message =
        apply(isProto, errorProto, [error]) && record(error) && typeof error.message === "string"
          ? error.message
          : "";
      if (!apply(exec, denial, [message])) {
        throw new Error("Child admission failed without authorization denial");
      }
      rejected = true;
    }
    if (!rejected) throw new Error("Child creation was accepted after cancellation");
    const after: unknown = await reader.get(runPath, undefined, { signal });
    const afterDescendants = readCanonicalDescendantCounts(after);
    if (
      !record(after) || after.project_id !== input.projectId || afterDescendants === undefined ||
      afterDescendants.total !== beforeDescendants.total ||
      afterDescendants.active !== beforeDescendants.active
    ) {
      throw new Error("Denied child creation changed parent state or lineage");
    }
    const beforeHash = await computeHash(privateJsonStringify(before)),
      afterHash = await computeHash(privateJsonStringify(after));
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
