import { type HostedTaskInputValue, snapshotHostedTaskInput } from "./task-input.ts";
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
    Object.keys(snapshot).sort((left, right) => left.localeCompare(right, "en")).join(",") !==
      "artifactVersions,payload,sourceEventIds,targetAgentId,type,version" ||
    snapshot.type !== ACCEPTED_TASK_INPUT_EVENT_TYPE || snapshot.version !== 1 ||
    typeof snapshot.targetAgentId !== "string" || !snapshot.targetAgentId ||
    snapshot.targetAgentId.length > 255 || !Array.isArray(snapshot.sourceEventIds) ||
    snapshot.sourceEventIds.length < 1 || snapshot.sourceEventIds.length > 8 ||
    snapshot.sourceEventIds.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
    new Set(snapshot.sourceEventIds).size !== snapshot.sourceEventIds.length ||
    !Array.isArray(snapshot.artifactVersions) || snapshot.artifactVersions.length < 1 ||
    snapshot.artifactVersions.length > 8
  ) throw new Error("Invalid accepted task input receipt");
  for (const ref of snapshot.artifactVersions) {
    if (
      Object.keys(ref).sort((left, right) => left.localeCompare(right, "en")).join(",") !==
        "path,sha256,size_bytes,version_id" ||
      typeof ref.path !== "string" || !ref.path || ref.path.length > 512 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref.version_id) ||
      !/^[a-f0-9]{64}$/.test(ref.sha256) || !Number.isSafeInteger(ref.size_bytes) ||
      ref.size_bytes < 0 || ref.size_bytes > 1_000_000_000
    ) throw new Error("Invalid accepted artifact version");
  }
  return snapshot;
}
