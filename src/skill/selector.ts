import { CONFIG_INVALID } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import {
  SKILL_ID_MAX_LENGTH,
  SKILL_SELECTOR_MAX_DEFINITIONS,
  SKILL_SELECTOR_MAX_ENTRIES,
} from "./limits.ts";
import { hasControlCharacters, isWellFormedUtf16 } from "./string-safety.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const defineOwnProperty = Object.defineProperty;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const mapGet = Map.prototype.get;
const mapHas = Map.prototype.has;
const mapSet = Map.prototype.set;
const NativeMap = Map;
const NativeSet = Set;
const NativeTypeError = TypeError;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const objectFreeze = Object.freeze;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;

function appendOwnArrayElement<T>(values: T[], value: T): void {
  defineOwnProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function freeze<T>(value: T): Readonly<T> {
  return objectFreeze(value);
}

// Preserve the established mutable-array API type while enforcing immutability
// at runtime. This avoids a TypeScript-breaking change for existing consumers.
function freezeArray<T>(value: T[]): T[] {
  objectFreeze(value);
  return value;
}

function readOwnArrayElement<T>(
  values: readonly T[],
  index: number,
): { present: boolean; value?: T } {
  const descriptor = getOwnPropertyDescriptor(values, index);
  if (descriptor === undefined) return { present: false };
  if (!(apply(objectHasOwnProperty, descriptor, ["value"]) as boolean)) {
    throw new NativeTypeError(`Skill selector array entry ${index} must be a data property`);
  }
  return { present: true, value: descriptor.value as T };
}

/** Authored skill selector policy after preserving property presence. */
export type ResolvedSkillSelectorPolicy =
  | { kind: "all-visible"; source: "omitted" | "true" }
  | { kind: "none" }
  | { kind: "allowlist"; entries: string[] };

/** Sanitized unresolved explicit selector entry. */
export type UnresolvedSkillSelectorEntry = {
  index: number;
};

/** Deterministic resolved selector snapshot shared by skill catalog adapters. */
export type ResolvedSkillSelectorSnapshot<TDefinition> = {
  readonly policy: ResolvedSkillSelectorPolicy;
  readonly definitions: TDefinition[];
  readonly allowedSkillIds: string[];
  readonly skillSourcePaths: Readonly<Record<string, string>>;
  readonly unresolvedEntries: UnresolvedSkillSelectorEntry[];
};

function freezeSelectorPolicy(
  policy: ResolvedSkillSelectorPolicy,
): ResolvedSkillSelectorPolicy {
  if (policy.kind === "allowlist") {
    const entries: string[] = [];
    for (let index = 0; index < policy.entries.length; index += 1) {
      const entry = readOwnArrayElement(policy.entries, index);
      if (!entry.present) {
        throw new NativeTypeError(`Skill selector array entry ${index} must be present`);
      }
      appendOwnArrayElement(entries, entry.value as string);
    }
    return freeze({
      kind: "allowlist",
      entries: freezeArray(entries),
    });
  }
  return policy.kind === "none"
    ? freeze({ kind: "none" })
    : freeze({ kind: "all-visible", source: policy.source });
}

/** Empty selector snapshot for explicit none policies. */
export function createNoneSkillSelectorSnapshot<TDefinition>(
  policy: Extract<ResolvedSkillSelectorPolicy, { kind: "none" }> = { kind: "none" },
): ResolvedSkillSelectorSnapshot<TDefinition> {
  return freeze({
    policy: freezeSelectorPolicy(policy),
    definitions: freezeArray<TDefinition>([]),
    allowedSkillIds: freezeArray<string>([]),
    skillSourcePaths: freeze({}),
    unresolvedEntries: freezeArray<UnresolvedSkillSelectorEntry>([]),
  });
}

type ResolveSkillSelectorInput<TDefinition> = {
  definitions: readonly TDefinition[];
  selector: true | readonly string[] | undefined;
  getId: (definition: TDefinition) => string;
  isVisible: (definition: TDefinition) => boolean;
  getShortName?: (definition: TDefinition) => string | undefined;
  isOwnShortNameCandidate?: (definition: TDefinition) => boolean;
  getSourcePath?: (definition: TDefinition) => string | undefined;
};

const UNAVAILABLE_SKILLS_MESSAGE =
  "One or more configured skills are not available to this agent. " +
  "Update the skills selector to use visible skill IDs or this agent's own skill short names.";

function buildSnapshot<TDefinition>(
  policy: ResolvedSkillSelectorPolicy,
  definitions: TDefinition[],
  getId: (definition: TDefinition) => string,
  getSourcePath: ((definition: TDefinition) => string | undefined) | undefined,
  unresolvedEntries: UnresolvedSkillSelectorEntry[],
): ResolvedSkillSelectorSnapshot<TDefinition> {
  const definitionSnapshot: TDefinition[] = [];
  const allowedSkillIds: string[] = [];
  const skillSourcePaths: Record<string, string> = {};
  for (let index = 0; index < definitions.length; index += 1) {
    const definition = readOwnArrayElement(definitions, index);
    if (!definition.present) {
      throw new NativeTypeError(`Skill selector definition ${index} must be present`);
    }
    const value = definition.value as TDefinition;
    const id = getId(value);
    if (typeof id !== "string") {
      throw new NativeTypeError("Skill selector definition id must be a string");
    }
    const sourcePath = getSourcePath?.(value);
    if (sourcePath !== undefined && typeof sourcePath !== "string") {
      throw new NativeTypeError("Skill selector source path must be a string");
    }
    appendOwnArrayElement(definitionSnapshot, value);
    appendOwnArrayElement(allowedSkillIds, id);
    if (sourcePath !== undefined) {
      defineOwnProperty(skillSourcePaths, id, {
        configurable: true,
        enumerable: true,
        value: sourcePath,
        writable: true,
      });
    }
  }

  const unresolvedSnapshot: UnresolvedSkillSelectorEntry[] = [];
  for (let index = 0; index < unresolvedEntries.length; index += 1) {
    const entry = readOwnArrayElement(unresolvedEntries, index);
    if (!entry.present) {
      throw new NativeTypeError(`Unresolved skill selector entry ${index} must be present`);
    }
    appendOwnArrayElement(
      unresolvedSnapshot,
      freeze({ index: (entry.value as UnresolvedSkillSelectorEntry).index }),
    );
  }

  return freeze({
    policy: freezeSelectorPolicy(policy),
    definitions: freezeArray(definitionSnapshot),
    allowedSkillIds: freezeArray(allowedSkillIds),
    skillSourcePaths: freeze(skillSourcePaths),
    unresolvedEntries: freezeArray(unresolvedSnapshot),
  });
}

/** Resolve a presence-aware skill selector without throwing on explicit misses. */
export function resolveSkillSelector<TDefinition>(
  input: ResolveSkillSelectorInput<TDefinition>,
): ResolvedSkillSelectorSnapshot<TDefinition> {
  if (!arrayIsArray(input.definitions) || isProxyWithoutHooks(input.definitions)) {
    throw new NativeTypeError("Skill selector definitions must be an array");
  }
  if (input.definitions.length > SKILL_SELECTOR_MAX_DEFINITIONS) {
    throw new RangeError(
      `Skill selector accepts at most ${SKILL_SELECTOR_MAX_DEFINITIONS} definitions`,
    );
  }
  const visibleDefinitions: TDefinition[] = [];
  for (let index = 0; index < input.definitions.length; index += 1) {
    const definition = readOwnArrayElement(input.definitions, index);
    if (!definition.present) {
      throw new NativeTypeError(`Skill selector definition ${index} must be present`);
    }
    const value = definition.value as TDefinition;
    if (input.isVisible(value)) appendOwnArrayElement(visibleDefinitions, value);
  }

  if (input.selector === undefined || input.selector === true) {
    return buildSnapshot(
      {
        kind: "all-visible",
        source: input.selector === true ? "true" : "omitted",
      },
      visibleDefinitions,
      input.getId,
      input.getSourcePath,
      [],
    );
  }

  if (input.selector.length === 0) {
    return createNoneSkillSelectorSnapshot();
  }

  if (!arrayIsArray(input.selector) || isProxyWithoutHooks(input.selector)) {
    throw new NativeTypeError("Skill selector allowlist must be an array");
  }
  if (input.selector.length > SKILL_SELECTOR_MAX_ENTRIES) {
    throw new RangeError(
      `Skill selector allowlist accepts at most ${SKILL_SELECTOR_MAX_ENTRIES} entries`,
    );
  }
  const selectorEntries: string[] = [];
  for (let index = 0; index < input.selector.length; index += 1) {
    const entry = readOwnArrayElement(input.selector, index);
    if (!entry.present) {
      throw new NativeTypeError(`Skill selector entry ${index} must be present`);
    }
    if (typeof entry.value !== "string") {
      throw new NativeTypeError(`Skill selector entry ${index} must be a string`);
    }
    if (
      entry.value.length === 0 ||
      entry.value.length > SKILL_ID_MAX_LENGTH ||
      !isWellFormedUtf16(entry.value) ||
      hasControlCharacters(entry.value)
    ) {
      throw new NativeTypeError(
        `Skill selector entry ${index} must be a non-empty bounded identifier`,
      );
    }
    appendOwnArrayElement(selectorEntries, entry.value);
  }

  const byId = new NativeMap<string, TDefinition>();
  const byOwnShortName = new NativeMap<string, TDefinition>();

  for (let index = 0; index < visibleDefinitions.length; index += 1) {
    const definition = visibleDefinitions[index]!;
    const id = input.getId(definition);
    if (!(apply(mapHas, byId, [id]) as boolean)) {
      apply(mapSet, byId, [id, definition]);
    }

    const shortName = input.getShortName?.(definition);
    if (
      shortName !== undefined &&
      (input.isOwnShortNameCandidate?.(definition) ?? true) &&
      !(apply(mapHas, byOwnShortName, [shortName]) as boolean)
    ) {
      apply(mapSet, byOwnShortName, [shortName, definition]);
    }
  }

  const selectedDefinitions: TDefinition[] = [];
  const selectedIds = new NativeSet<string>();
  const unresolvedEntries: UnresolvedSkillSelectorEntry[] = [];

  for (let index = 0; index < selectorEntries.length; index += 1) {
    const requested = selectorEntries[index]!;
    const definition = apply(mapGet, byOwnShortName, [requested]) as TDefinition | undefined ??
      apply(mapGet, byId, [requested]) as TDefinition | undefined;
    if (!definition) {
      appendOwnArrayElement(unresolvedEntries, { index });
      continue;
    }

    const id = input.getId(definition);
    if (!(apply(setHas, selectedIds, [id]) as boolean)) {
      apply(setAdd, selectedIds, [id]);
      appendOwnArrayElement(selectedDefinitions, definition);
    }
  }

  return buildSnapshot(
    { kind: "allowlist", entries: selectorEntries },
    selectedDefinitions,
    input.getId,
    input.getSourcePath,
    unresolvedEntries,
  );
}

/** Throw the generic selector configuration error for unresolved explicit entries. */
export function assertResolvedSkillSelector<TDefinition>(
  snapshot: ResolvedSkillSelectorSnapshot<TDefinition>,
): void {
  if (snapshot.unresolvedEntries.length === 0) {
    return;
  }

  throw CONFIG_INVALID.create({
    detail: UNAVAILABLE_SKILLS_MESSAGE,
  });
}
