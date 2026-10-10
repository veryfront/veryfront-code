import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

const providerObservedSkillBodies = createPrivateWeakStore<object, ReadonlySet<string>>();

export function setProviderObservedSkillBodies(
  context: ToolExecutionContext,
  ids: readonly string[],
): void {
  providerObservedSkillBodies.set(context, createPrivateSet(ids));
}

export function inheritProviderObservedSkillBodies(
  source: ToolExecutionContext | undefined,
  target: ToolExecutionContext,
): void {
  if (source === undefined) return;
  const observed = providerObservedSkillBodies.get(source);
  if (observed !== undefined) {
    providerObservedSkillBodies.set(target, observed);
  }
}

export function hasProviderObservedSkillBody(
  context: ToolExecutionContext | undefined,
  skillId: string,
): boolean | undefined {
  if (context === undefined) return undefined;
  return providerObservedSkillBodies.get(context)?.has(skillId);
}
