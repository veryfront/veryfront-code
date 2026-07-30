import { CONFIG_INVALID } from "#veryfront/errors";

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
  policy: ResolvedSkillSelectorPolicy;
  definitions: TDefinition[];
  allowedSkillIds: string[];
  skillSourcePaths: Record<string, string>;
  unresolvedEntries: UnresolvedSkillSelectorEntry[];
};

/** Empty selector snapshot for explicit none policies. */
export function createNoneSkillSelectorSnapshot<TDefinition>(
  policy: Extract<ResolvedSkillSelectorPolicy, { kind: "none" }> = { kind: "none" },
): ResolvedSkillSelectorSnapshot<TDefinition> {
  return {
    policy,
    definitions: [],
    allowedSkillIds: [],
    skillSourcePaths: {},
    unresolvedEntries: [],
  };
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
  return {
    policy,
    definitions,
    allowedSkillIds: definitions.map((definition) => getId(definition)),
    skillSourcePaths: Object.fromEntries(
      definitions
        .map((definition) => [getId(definition), getSourcePath?.(definition)] as const)
        .filter((entry): entry is readonly [string, string] => entry[1] !== undefined),
    ),
    unresolvedEntries,
  };
}

/** Resolve a presence-aware skill selector without throwing on explicit misses. */
export function resolveSkillSelector<TDefinition>(
  input: ResolveSkillSelectorInput<TDefinition>,
): ResolvedSkillSelectorSnapshot<TDefinition> {
  const visibleDefinitions = input.definitions.filter(input.isVisible);

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

  const byId = new Map<string, TDefinition>();
  const byOwnShortName = new Map<string, TDefinition>();

  for (const definition of visibleDefinitions) {
    const id = input.getId(definition);
    if (!byId.has(id)) {
      byId.set(id, definition);
    }

    const shortName = input.getShortName?.(definition);
    if (
      shortName !== undefined &&
      (input.isOwnShortNameCandidate?.(definition) ?? true) &&
      !byOwnShortName.has(shortName)
    ) {
      byOwnShortName.set(shortName, definition);
    }
  }

  const selectedDefinitions: TDefinition[] = [];
  const selectedIds = new Set<string>();
  const unresolvedEntries: UnresolvedSkillSelectorEntry[] = [];

  input.selector.forEach((requested, index) => {
    const definition = byOwnShortName.get(requested) ?? byId.get(requested);
    if (!definition) {
      unresolvedEntries.push({ index });
      return;
    }

    const id = input.getId(definition);
    if (!selectedIds.has(id)) {
      selectedIds.add(id);
      selectedDefinitions.push(definition);
    }
  });

  return buildSnapshot(
    { kind: "allowlist", entries: [...input.selector] },
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
