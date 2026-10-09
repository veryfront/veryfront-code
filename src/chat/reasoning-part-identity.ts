import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

/** Minimal shape shared by UI-message and stream-projection reasoning parts. */
export interface ReasoningPartShape {
  type: "reasoning";
  text: string;
}

const identities = createPrivateWeakStore<ReasoningPartShape, { id: string; open: boolean }>();

/** Retain stream identity internally without adding private metadata to UI schemas. */
export function bindReasoningPartIdentity<T extends ReasoningPartShape>(
  part: T,
  id: string,
  open: boolean,
): T {
  identities.set(part, { id, open });
  return part;
}

export function readReasoningPartIdentity(
  part: ReasoningPartShape,
): { id: string; open: boolean } | undefined {
  return identities.get(part);
}
