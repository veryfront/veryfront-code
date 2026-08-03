import { isTriggerId } from "./validation.ts";

/** Supported local trigger target kinds. */
export type TriggerTargetKind = "task" | "workflow" | "agent";

/** Canonical reference to a runnable project definition. */
export interface TriggerTarget {
  /** Definition kind resolved by project runtime discovery. */
  kind: TriggerTargetKind;
  /** Canonical slash-separated definition identifier. */
  id: string;
}

function readOwnDataProperty(value: object, key: PropertyKey): unknown {
  const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

/**
 * Validate and copy a trigger target without retaining caller-owned state.
 */
export function snapshotTriggerTarget(value: unknown): TriggerTarget | null {
  if (typeof value !== "object" || value === null) return null;

  try {
    const kind = readOwnDataProperty(value, "kind");
    const id = readOwnDataProperty(value, "id");
    if (
      (kind !== "task" && kind !== "workflow" && kind !== "agent") ||
      !isTriggerId(id)
    ) {
      return null;
    }
    return { kind, id };
  } catch {
    return null;
  }
}

/** Return true only for canonical targets stored in own data properties. */
export function isTriggerTarget(value: unknown): value is TriggerTarget {
  return snapshotTriggerTarget(value) !== null;
}
