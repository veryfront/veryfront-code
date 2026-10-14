import type { ToolExecutionContext } from "./types.ts";
import { joinPrivateArray } from "#veryfront/security/private-array.ts";
import { createPrivateMap } from "#veryfront/security/private-map.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";
import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";
import { compareStrings } from "#veryfront/utils/compare.ts";

/** A skill body the provider received, identified by its skill ID and advertised references. */
export type ProviderObservedSkillBody = Readonly<{
  skillId: string;
  references: readonly string[];
}>;

const providerObservedSkillBodies = createPrivateWeakStore<
  object,
  ReadonlyMap<string, ReadonlySet<string>>
>();
const objectHasOwn = Object.hasOwn;

function referenceListKey(references: readonly string[]): string {
  const snapshot: string[] = [];
  for (let index = 0; index < references.length; index += 1) {
    if (!objectHasOwn(references, index)) continue;
    const reference = references[index]!;
    let insertIndex = snapshot.length;
    while (insertIndex > 0 && compareStrings(snapshot[insertIndex - 1]!, reference) > 0) {
      defineOwnDataProperty(snapshot, insertIndex, snapshot[insertIndex - 1], {
        configurable: true,
        enumerable: true,
        writable: true,
      });
      insertIndex -= 1;
    }
    defineOwnDataProperty(snapshot, insertIndex, reference, {
      configurable: true,
      enumerable: true,
      writable: true,
    });
  }
  // Reference paths are strict relative paths and never contain NUL.
  return joinPrivateArray(snapshot, "\u0000");
}

export function setProviderObservedSkillBodies(
  context: ToolExecutionContext,
  bodies: readonly ProviderObservedSkillBody[],
): void {
  const observed = createPrivateMap<string, Set<string>>();
  for (let index = 0; index < bodies.length; index += 1) {
    if (!objectHasOwn(bodies, index)) continue;
    const body = bodies[index]!;
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
