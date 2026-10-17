import { type HostedTaskInputValue, snapshotHostedTaskInput } from "./task-input.ts";
const keys = Object.keys, isArray = Array.isArray, safeInteger = Number.isSafeInteger;
const apply = Reflect.apply, sort = Array.prototype.sort, join = Array.prototype.join;
const exec = RegExp.prototype.exec;
const NativeError = Error;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = /^[a-f0-9]{64}$/;
function sortedKeys(value: HostedAcceptedTaskInputEvent | HostedArtifactVersionReference): string {
  const names = keys(value);
  apply(sort, names, [(left: string, right: string) => left < right ? -1 : left > right ? 1 : 0]);
  return apply(join, names, [","]) as string;
}
function validSourceEventIds(ids: readonly number[]): boolean {
  for (let index = 0; index < ids.length; index++) {
    const id = ids[index]!;
    if (!safeInteger(id) || id <= 0) return false;
    for (let previous = 0; previous < index; previous++) {
      if (ids[previous] === id) return false;
    }
  }
  return true;
}
export const ACCEPTED_TASK_INPUT_EVENT_TYPE = "AGENT_RUN_TASK_INPUT_ACCEPTED" as const;
export type HostedArtifactVersionReference = Readonly<
  { path: string; version_id: string; sha256: string; size_bytes: number }
>;
export type HostedAcceptedTaskInputEvent = Readonly<
  {
    type: typeof ACCEPTED_TASK_INPUT_EVENT_TYPE;
    version: 1;
    targetAgentId: string;
    sourceEventIds: readonly number[];
    artifactVersions: readonly HostedArtifactVersionReference[];
    payload: Readonly<Record<string, HostedTaskInputValue>>;
  }
>;
export function snapshotHostedAcceptedTaskInputEvent(
  value: HostedAcceptedTaskInputEvent,
): HostedAcceptedTaskInputEvent {
  // Bounded plain JSON validation runs before caller values reach secret-bearing transport.
  const snapshot = snapshotHostedTaskInput({
    version: 1,
    projectId: "bounded",
    rootRunId: "bounded",
    runId: "bounded",
    payload: value,
  }).payload as HostedAcceptedTaskInputEvent;
  if (
    sortedKeys(snapshot) !==
      "artifactVersions,payload,sourceEventIds,targetAgentId,type,version" ||
    snapshot.payload === null || typeof snapshot.payload !== "object" ||
    isArray(snapshot.payload) ||
    snapshot.type !== ACCEPTED_TASK_INPUT_EVENT_TYPE || snapshot.version !== 1 ||
    typeof snapshot.targetAgentId !== "string" || !snapshot.targetAgentId ||
    snapshot.targetAgentId.length > 255 || !isArray(snapshot.sourceEventIds) ||
    snapshot.sourceEventIds.length < 1 || snapshot.sourceEventIds.length > 8 ||
    !validSourceEventIds(snapshot.sourceEventIds) ||
    !isArray(snapshot.artifactVersions) || snapshot.artifactVersions.length < 1 ||
    snapshot.artifactVersions.length > 8
  ) throw new NativeError("Invalid accepted task input receipt");
  for (let index = 0; index < snapshot.artifactVersions.length; index++) {
    const ref = snapshot.artifactVersions[index]!;
    if (
      sortedKeys(ref) !==
        "path,sha256,size_bytes,version_id" ||
      typeof ref.path !== "string" || !ref.path || ref.path.length > 512 ||
      typeof ref.version_id !== "string" || !apply(exec, uuid, [ref.version_id]) ||
      typeof ref.sha256 !== "string" || !apply(exec, sha256, [ref.sha256]) ||
      !safeInteger(ref.size_bytes) ||
      ref.size_bytes < 0 || ref.size_bytes > 1_000_000_000
    ) throw new NativeError("Invalid accepted artifact version");
  }
  return snapshot;
}
