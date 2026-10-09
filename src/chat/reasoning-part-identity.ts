import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

const identities = createPrivateWeakStore<object, { id: string; open: boolean }>();

/** Retain stream identity internally without adding private metadata to UI schemas. */
export function bindReasoningPartIdentity<T extends object>(part: T, id: string, open: boolean): T {
  identities.set(part, { id, open });
  return part;
}

export function readReasoningPartIdentity(part: object): { id: string; open: boolean } | undefined {
  return identities.get(part);
}
