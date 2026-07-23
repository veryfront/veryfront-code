import { isValidTriggerId } from "./validation.ts";

/** Trigger target categories supported by source-defined schedules and webhooks. */
export type TriggerTargetKind = "task" | "workflow" | "agent";

/** Identifies the runtime primitive that a trigger starts. */
export interface TriggerTarget {
  /** Runtime primitive category. */
  kind: TriggerTargetKind;
  /** Canonical task, workflow, or agent identifier. */
  id: string;
}

function isTriggerTargetKind(value: unknown): value is TriggerTargetKind {
  return value === "task" || value === "workflow" || value === "agent";
}

/** Create a detached trigger target after descriptor-safe validation. */
export function snapshotTriggerTarget(value: unknown): TriggerTarget | undefined {
  if (!value || typeof value !== "object") return undefined;

  try {
    if (Array.isArray(value)) return undefined;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const keys = Reflect.ownKeys(value);
    if (
      keys.length !== 2 || !keys.includes("kind") || !keys.includes("id") ||
      keys.some((key) => typeof key !== "string")
    ) {
      return undefined;
    }

    const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
    const idDescriptor = Object.getOwnPropertyDescriptor(value, "id");
    if (
      !kindDescriptor?.enumerable || !("value" in kindDescriptor) ||
      !idDescriptor?.enumerable || !("value" in idDescriptor) ||
      !isTriggerTargetKind(kindDescriptor.value) || !isValidTriggerId(idDescriptor.value)
    ) {
      return undefined;
    }

    return { kind: kindDescriptor.value, id: idDescriptor.value };
  } catch {
    return undefined;
  }
}

/** Return whether a value is an exact, canonical trigger target. */
export function isTriggerTarget(value: unknown): value is TriggerTarget {
  return snapshotTriggerTarget(value) !== undefined;
}
