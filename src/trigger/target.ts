export type TriggerTargetKind = "task" | "workflow" | "agent";

export interface TriggerTarget {
  kind: TriggerTargetKind;
  id: string;
}

export function isTriggerTarget(value: unknown): value is TriggerTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  return (
    (target.kind === "task" || target.kind === "workflow" || target.kind === "agent") &&
    typeof target.id === "string" &&
    target.id.trim().length > 0
  );
}
