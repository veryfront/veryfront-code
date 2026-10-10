import type { ToolExecutionContext } from "#veryfront/tool/types.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

/** A skill body the provider received, identified by its skill ID and advertised references. */
export type ProviderObservedSkillBody = Readonly<{
  skillId: string;
  references: readonly string[];
}>;

const providerObservedSkillBodies = createPrivateWeakStore<
  object,
  ReadonlyMap<string, ReadonlySet<string>>
>();

function compareCodeUnits(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

function referenceListKey(references: readonly string[]): string {
  // Reference paths are strict relative paths and never contain NUL.
  return [...references].sort(compareCodeUnits).join("\u0000");
}

export function setProviderObservedSkillBodies(
  context: ToolExecutionContext,
  bodies: readonly ProviderObservedSkillBody[],
): void {
  const observed = createPrivateMap<string, Set<string>>();
  for (const body of bodies) {
    let keys = observed.get(body.skillId);
    if (keys === undefined) {
      keys = createPrivateSet<string>();
      observed.set(body.skillId, keys);
    }
    keys.add(referenceListKey(body.references));
  }
  providerObservedSkillBodies.set(context, observed);
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

/** Whether any body of the skill was observed; undefined when no snapshot is attached. */
export function hasProviderObservedSkillBody(
  context: ToolExecutionContext | undefined,
  skillId: string,
): boolean | undefined {
  if (context === undefined) return undefined;
  return providerObservedSkillBodies.get(context)?.has(skillId);
}

/**
 * Whether the provider observed a body of the skill that advertised exactly these
 * references; undefined when no snapshot is attached.
 */
export function hasProviderObservedSkillReferences(
  context: ToolExecutionContext | undefined,
  skillId: string,
  references: readonly string[],
): boolean | undefined {
  if (context === undefined) return undefined;
  const observed = providerObservedSkillBodies.get(context);
  if (observed === undefined) return undefined;
  return observed.get(skillId)?.has(referenceListKey(references)) ?? false;
}
