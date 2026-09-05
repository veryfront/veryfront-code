import type { ToolDefinition } from "#veryfront/tool";
import { parseIntegrationToolIdentity } from "#veryfront/integrations/source-policy.ts";
import type { RuntimeToolLoadingMode } from "./runtime-tool-config.ts";
import { isOwnDataPropertyDescriptor } from "./data-property-descriptor.ts";

const ArraySort = Array.prototype.sort;
const SetAdd = Set.prototype.add;
const SetHas = Set.prototype.has;

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return ReflectApply(SetHas, set, [value]);
}

/** Framework-owned model-facing tool used to load authorized schemas. */
export const TOOL_SEARCH_TOOL_NAME = "tool_search";

const DEFAULT_BOOTSTRAP_TOOL_NAMES = new Set(["load_skill"]);
const TOOL_SEARCH_RESULT_LIMIT = 5;
/** Which field a query term matched on, strongest evidence first. */
type ToolSearchMatchField = "exactName" | "name" | "description" | "parameterDescription";

/** Ordering for a whole-query match: lower wins. */
const TOOL_SEARCH_FIELD_PRECEDENCE: Record<ToolSearchMatchField, number> = {
  exactName: 0,
  name: 1,
  description: 2,
  parameterDescription: 3,
};

/** Contribution to a per-term score: higher wins. Keyed by the same union as the
 * precedence above so the two orderings cannot drift apart silently. */
const TOOL_SEARCH_FIELD_WEIGHTS: Record<ToolSearchMatchField, number> = {
  exactName: 4,
  name: 3,
  description: 2,
  parameterDescription: 1,
};
const TOOL_SEARCH_QUERY_MAX_BYTES = 256;
const TOOL_SEARCH_CANDIDATE_LIMIT = 4_096;
const TOOL_SEARCH_NAME_MAX_BYTES = 256;
const TOOL_SEARCH_DESCRIPTION_MAX_BYTES = 4_096;
const TOOL_SEARCH_SCHEMA_MAX_DEPTH = 64;
const TOOL_SEARCH_SCHEMA_MAX_NODES = 4_096;
const TOOL_SEARCH_SCHEMA_MAX_BYTES = 65_536;
const TOOL_SEARCH_TOTAL_SCHEMA_NODES = 65_536;
const TOOL_SEARCH_TOTAL_SCHEMA_BYTES = 524_288;
const UTF8_ENCODER = new TextEncoder();
const ArrayIsArray = Array.isArray;
const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ReflectApply = Reflect.apply;
const ReflectOwnKeys = Reflect.ownKeys;

/** Run-local mutable exposure state. Create a new state for every child run. */
export type ToolExposureState = {
  loadedToolNames: Set<string>;
};

/** Authorized, visible, and deferred definitions for one model step. */
export type ToolExposurePlan = {
  authorized: ToolDefinition[];
  visible: ToolDefinition[];
  deferred: ToolDefinition[];
  loadedToolNames: Set<string>;
  maxLoadedTools?: number;
};

/** Private versioned state persisted by the framework between resumed steps. */
export type ToolExposureCheckpoint = {
  /** v1 names were lexicographically sorted; v2 preserves oldest-to-newest recency. */
  version: 1 | 2;
  loadedToolNames: string[];
};

export const AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT_EVENT_TYPE =
  "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT" as const;

/** Private durable event carrying trusted tool exposure state. */
export type ToolExposureCheckpointEvent = ToolExposureCheckpoint & {
  type: typeof AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT_EVENT_TYPE;
};

/** Schema-free model-visible search result. */
export type ToolSearchMatch = {
  name: string;
  description: string;
  status: "available" | "loaded";
};

/** Search output plus bounded observability counters. */
export type ToolSearchResult = {
  matches: ToolSearchMatch[];
  resultCount: number;
  loadedCount: number;
  miss: boolean;
};

type SearchableTool = ToolSearchMatch & {
  /** Normalized once at snapshot time: matching rescans every candidate per term. */
  normalizedName: string;
  normalizedDescription: string;
  parameterDescriptions: string[];
};

type SchemaSearchBudget = {
  nodes: number;
  bytes: number;
};

function normalizeSearchText(value: string): string {
  return value.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32))
    .replaceAll("_", " ").trim().replace(/\s+/g, " ");
}

/**
 * Recognize `<namespace>__<tool_id>` on the raw query, before normalization
 * rewrites `_` to a space and destroys the separator.
 *
 * Defers to the authorization layer's grammar rather than restating it: a query
 * search accepts but authorization rejects, or the reverse, is a disagreement
 * about what a canonical id even is.
 */
function parseCanonicalIntegrationQuery(
  query: string,
): { namespace: string; canonicalName: string | null } | null {
  const trimmed = query.trim().toLowerCase();
  const separator = trimmed.indexOf("__");
  if (separator <= 0) return null;

  const identity = parseIntegrationToolIdentity(trimmed);
  if (identity !== null) {
    return {
      namespace: identity.integration,
      canonicalName: `${identity.integration}__${identity.toolId}`,
    };
  }

  // `__` is the reserved integration namespace separator and `assertLocalToolId`
  // forbids it in local ids, so a query carrying it is asking for an integration
  // tool even when the rest is malformed (`jira__list__projects`). Keep such a
  // query on the namespace path: otherwise normalization collapses it onto a
  // local id like `jira_list_projects`, which then wins the phrase match.
  const namespace = trimmed.slice(0, separator);
  return parseIntegrationToolIdentity(`${namespace}__placeholder`) === null
    ? null
    : { namespace, canonicalName: null };
}

/**
 * Match a namespace as a whole token, never as a substring.
 *
 * Namespaces can be very short (`exa` is a real integration), so substring
 * evidence would admit any tool whose text merely contains `example`. Normalized
 * text is lowercase with `_` rewritten to spaces, so the boundaries are anything
 * that is not alphanumeric.
 */
function createNamespaceTokenPattern(namespaceTerm: string): RegExp {
  const escaped = namespaceTerm.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`);
}

function toSearchMatch(tool: SearchableTool): ToolSearchMatch {
  return { name: tool.name, description: tool.description, status: tool.status };
}

function compareToolSearchMatches(left: ToolSearchMatch, right: ToolSearchMatch): number {
  return (left.status === right.status ? 0 : left.status === "available" ? -1 : 1) ||
    compareAscii(left.name, right.name);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isUtf8LengthWithin(value: string, maxBytes: number): boolean {
  return value.length <= maxBytes && UTF8_ENCODER.encode(value).byteLength <= maxBytes;
}

/** Return whether a persisted name matches the existing non-empty tool id contract. */
export function isValidToolExposureCheckpointName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Return whether a checkpoint version can be restored by this runtime. */
export function isSupportedToolExposureCheckpointVersion(
  value: unknown,
): value is ToolExposureCheckpoint["version"] {
  return value === 1 || value === 2;
}

/**
 * Collect searchable schema descriptions without recursion or property reads.
 * Getters are never invoked. Proxy reflection traps can still run; failures are
 * caught and make only that schema non-searchable.
 */
function snapshotSchemaDescriptions(
  root: unknown,
  aggregate: SchemaSearchBudget,
): string[] | null {
  if (aggregate.nodes >= TOOL_SEARCH_TOTAL_SCHEMA_NODES) return null;
  if (aggregate.bytes >= TOOL_SEARCH_TOTAL_SCHEMA_BYTES) return null;

  const descriptions: string[] = [];
  const seen = new WeakSet<object>();
  const stack: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let nodes = 0;
  let bytes = 0;

  const debitBytes = (value: string): boolean => {
    if (value.length > TOOL_SEARCH_SCHEMA_MAX_BYTES) return false;
    const length = UTF8_ENCODER.encode(value).byteLength;
    bytes += length;
    aggregate.bytes += length;
    return bytes <= TOOL_SEARCH_SCHEMA_MAX_BYTES &&
      aggregate.bytes <= TOOL_SEARCH_TOTAL_SCHEMA_BYTES;
  };

  try {
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || current.depth > TOOL_SEARCH_SCHEMA_MAX_DEPTH) return null;
      nodes += 1;
      aggregate.nodes += 1;
      if (
        nodes > TOOL_SEARCH_SCHEMA_MAX_NODES ||
        aggregate.nodes > TOOL_SEARCH_TOTAL_SCHEMA_NODES
      ) return null;

      if (typeof current.value === "string") {
        if (!debitBytes(current.value)) return null;
        continue;
      }
      if (!current.value || typeof current.value !== "object") continue;
      if (seen.has(current.value)) return null;
      seen.add(current.value);

      const isArray = ArrayIsArray(current.value);
      const prototype = ReflectApply(ObjectGetPrototypeOf, undefined, [current.value]);
      if (prototype !== null && prototype !== (isArray ? Array.prototype : Object.prototype)) {
        return null;
      }
      const keys = ReflectOwnKeys(current.value);
      if (keys.length > TOOL_SEARCH_SCHEMA_MAX_NODES - nodes) return null;

      let arrayLength: number | null = null;
      if (isArray) {
        const lengthDescriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
          current.value,
          "length",
        ]) as PropertyDescriptor | undefined;
        if (!isOwnDataPropertyDescriptor(lengthDescriptor)) return null;
        const length = lengthDescriptor.value;
        if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) return null;
        arrayLength = length;
      }

      for (const key of keys) {
        if (isArray && key === "length") continue;
        if (typeof key !== "string" || !debitBytes(key)) return null;
        if (isArray) {
          const index = Number(key);
          if (
            !Number.isSafeInteger(index) || index < 0 || index >= (arrayLength ?? 0) ||
            String(index) !== key
          ) return null;
        }
        const descriptor = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
          current.value,
          key,
        ]) as PropertyDescriptor | undefined;
        if (!isOwnDataPropertyDescriptor(descriptor) || !descriptor.enumerable) return null;
        if (key === "description" && typeof descriptor.value === "string") {
          descriptions.push(normalizeSearchText(descriptor.value));
        }
        stack.push({ value: descriptor.value, depth: current.depth + 1 });
      }
    }
  } catch {
    return null;
  }

  return descriptions;
}

function snapshotSearchableTool(
  tool: ToolDefinition,
  status: ToolSearchMatch["status"],
  budget: SchemaSearchBudget,
): SearchableTool | null {
  try {
    if (!tool || typeof tool !== "object" || ArrayIsArray(tool)) return null;
    const name = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      tool,
      "name",
    ]) as PropertyDescriptor | undefined;
    const description = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      tool,
      "description",
    ]) as PropertyDescriptor | undefined;
    const parameters = ReflectApply(ObjectGetOwnPropertyDescriptor, undefined, [
      tool,
      "parameters",
    ]) as PropertyDescriptor | undefined;
    if (
      !isOwnDataPropertyDescriptor(name) || typeof name.value !== "string" ||
      name.value.length === 0 ||
      !isUtf8LengthWithin(name.value, TOOL_SEARCH_NAME_MAX_BYTES) ||
      !isOwnDataPropertyDescriptor(description) || typeof description.value !== "string" ||
      !isUtf8LengthWithin(description.value, TOOL_SEARCH_DESCRIPTION_MAX_BYTES) ||
      (parameters && !isOwnDataPropertyDescriptor(parameters))
    ) return null;
    return {
      name: name.value,
      description: description.value,
      status,
      normalizedName: normalizeSearchText(name.value),
      normalizedDescription: normalizeSearchText(description.value),
      parameterDescriptions: parameters
        ? snapshotSchemaDescriptions(parameters.value, budget) ?? []
        : [],
    };
  } catch {
    return null;
  }
}

function getMatchedField(
  query: string,
  tool: SearchableTool,
): ToolSearchMatchField | null {
  if (tool.normalizedName === query) return "exactName";
  if (tool.normalizedName.includes(query)) return "name";
  if (tool.normalizedDescription.includes(query)) return "description";
  return tool.parameterDescriptions.some((description) => description.includes(query))
    ? "parameterDescription"
    : null;
}

function collectSearchCandidates(input: {
  available: readonly ToolDefinition[];
  authorized: readonly ToolDefinition[];
}): SearchableTool[] {
  const budget: SchemaSearchBudget = { nodes: 0, bytes: 0 };
  const candidates: SearchableTool[] = [];
  let examinedCandidates = 0;
  const append = (tools: readonly ToolDefinition[], status: ToolSearchMatch["status"]): void => {
    for (const tool of tools) {
      if (examinedCandidates >= TOOL_SEARCH_CANDIDATE_LIMIT) return;
      examinedCandidates += 1;
      const snapshot = snapshotSearchableTool(tool, status, budget);
      if (snapshot) candidates.push(snapshot);
    }
  };
  append(input.available, "available");
  append(input.authorized, "loaded");
  return candidates;
}

/** Rank candidates against the query taken as one phrase, strongest field first. */
function rankWholeQueryMatches(
  query: string,
  candidates: readonly SearchableTool[],
): ToolSearchMatch[] {
  const ranked: { precedence: number; match: ToolSearchMatch }[] = [];
  for (const candidate of candidates) {
    const field = getMatchedField(query, candidate);
    if (field === null) continue;
    ranked.push({
      precedence: TOOL_SEARCH_FIELD_PRECEDENCE[field],
      match: toSearchMatch(candidate),
    });
  }
  return ranked
    .sort((left, right) =>
      left.precedence - right.precedence || compareToolSearchMatches(left.match, right.match)
    )
    .map(({ match }) => match);
}

/**
 * Score candidates across independent query terms.
 *
 * Two properties matter, and the previous pure-OR fallback had neither. First,
 * a term is weighted by how few candidates it matches, so a rare term such as an
 * integration namespace outweighs a common one such as `list`. Second, a
 * candidate must match at least one *selective* term to be returned at all;
 * otherwise a query containing one common word returns whichever tools happen to
 * sort first, and reports it as a hit.
 */
function scoreToolExposureTerms(
  terms: readonly string[],
  candidates: readonly SearchableTool[],
): ToolSearchMatch[] {
  const total = candidates.length;
  if (total === 0 || terms.length === 0) return [];

  const weightedTerms = terms.map((term) => {
    let documentFrequency = 0;
    for (const candidate of candidates) {
      if (getMatchedField(term, candidate) !== null) documentFrequency += 1;
    }
    return {
      term,
      documentFrequency,
      inverseDocumentFrequency: documentFrequency === 0
        ? 0
        : Math.log((total + 1) / (documentFrequency + 0.5)),
    };
  });
  const averageDocumentFrequency = weightedTerms.reduce(
    (sum, { documentFrequency }) => sum + documentFrequency,
    0,
  ) / weightedTerms.length;

  const scored: { score: number; match: ToolSearchMatch }[] = [];
  for (const candidate of candidates) {
    let score = 0;
    let matchedTermCount = 0;
    let matchedSelectiveTerm = false;
    for (const { term, documentFrequency, inverseDocumentFrequency } of weightedTerms) {
      const field = getMatchedField(term, candidate);
      if (field === null) continue;
      matchedTermCount += 1;
      score += inverseDocumentFrequency * TOOL_SEARCH_FIELD_WEIGHTS[field];
      if (documentFrequency <= averageDocumentFrequency) matchedSelectiveTerm = true;
    }
    // Selectivity suppresses filler, which only means anything when there is
    // something better to prefer. A candidate matching *every* term is not filler
    // however common those terms are: in a one-tool catalog every term matches
    // everything, so the floor alone would report a certain match as a miss.
    if (!matchedSelectiveTerm && matchedTermCount < terms.length) continue;
    scored.push({ score, match: toSearchMatch(candidate) });
  }

  return scored
    .sort((left, right) =>
      right.score - left.score || compareToolSearchMatches(left.match, right.match)
    )
    .map(({ match }) => match);
}

function rankToolExposureMatches(input: {
  query: string;
  available: readonly ToolDefinition[];
  authorized: readonly ToolDefinition[];
}): ToolSearchMatch[] {
  if (!isUtf8LengthWithin(input.query, TOOL_SEARCH_QUERY_MAX_BYTES)) return [];
  const query = normalizeSearchText(input.query);
  if (!query) return [];
  const candidates = collectSearchCandidates(input);

  // Canonical integration ids are classified before any normalized matching.
  // Normalization maps `jira__list_projects` and the *local* id `jira_list_projects`
  // onto the same text, so a phrase pass here would hand back a same-named local
  // tool instead of the namespace the caller actually asked for. Only the real
  // canonical name satisfies a canonical query; anything else is namespace discovery.
  const canonical = parseCanonicalIntegrationQuery(input.query);
  if (canonical !== null) {
    const canonicalName = canonical.canonicalName;
    const exact = canonicalName === null ? [] : candidates
      .filter((candidate) => candidate.name.toLowerCase() === canonicalName)
      .map(toSearchMatch)
      .sort(compareToolSearchMatches);
    if (exact.length > 0) return exact;

    // Namespace discovery accepts two kinds of evidence, and a coincidental name
    // match is neither: a sibling tool in the same namespace, or a tool that
    // *documents* the namespace (the catalog readers do). A local
    // `jira_list_projects` merely contains the word and is not the Jira integration.
    //
    // Sibling identity compares raw ids; text evidence must compare normalized,
    // because a namespace may itself contain `_` (`foo_bar__list_items`) and every
    // candidate's text has already had underscores rewritten to spaces.
    const namespaceTerm = normalizeSearchText(canonical.namespace);
    const namespacePattern = createNamespaceTokenPattern(namespaceTerm);
    const namespaceCandidates = candidates.filter((candidate) => {
      const identity = parseIntegrationToolIdentity(candidate.name.toLowerCase());
      if (identity !== null) return identity.integration === canonical.namespace;
      // A non-canonical tool carrying the namespace in its *name* is a
      // normalization coincidence, not the integration, whatever its description
      // happens to mention: `jira_list_projects` is a local tool, not Jira.
      if (namespacePattern.test(candidate.normalizedName)) return false;
      return namespacePattern.test(candidate.normalizedDescription) ||
        candidate.parameterDescriptions.some((description) => namespacePattern.test(description));
    });
    return rankWholeQueryMatches(namespaceTerm, namespaceCandidates);
  }

  // The query taken whole is the strongest signal for every non-canonical query.
  const wholeQueryMatches = rankWholeQueryMatches(query, candidates);
  if (wholeQueryMatches.length > 0) return wholeQueryMatches;

  const terms = [...new Set(query.split(/\s+/).filter(Boolean))];
  return terms.length >= 2 ? scoreToolExposureTerms(terms, candidates) : [];
}

/** Create fresh run-local tool exposure state. */
export function createToolExposureState(
  loadedToolNames: Iterable<string> = [],
): ToolExposureState {
  return { loadedToolNames: new Set(loadedToolNames) };
}

function retainNewestLoadedToolNames(state: ToolExposureState, limit: number | undefined): void {
  if (limit === undefined) return;
  while (state.loadedToolNames.size > limit) {
    const oldest = state.loadedToolNames.values().next().value;
    if (oldest === undefined) return;
    state.loadedToolNames.delete(oldest);
  }
}

function pruneLoadedToolNames(
  state: ToolExposureState,
  loadableToolNames: ReadonlySet<string>,
): void {
  for (const name of state.loadedToolNames) {
    if (!loadableToolNames.has(name)) state.loadedToolNames.delete(name);
  }
}

/** Create the framework fallback tool definition without exposing catalog schemas. */
export function createToolSearchDefinition(): ToolDefinition {
  return {
    name: TOOL_SEARCH_TOOL_NAME,
    description:
      "Search authorized tools by exact name or capability before declaring a requested tool unavailable. Matching authorized tools become available on the next model step.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description:
            `One exact tool name when known, or one short capability phrase. UTF-8 input must be at most ${TOOL_SEARCH_QUERY_MAX_BYTES} bytes. Do not combine alternatives.`,
        },
      },
    },
  };
}

/** Plan the schemas visible to the model for the current step. */
export function createToolExposurePlan(input: {
  authorized: readonly ToolDefinition[];
  mode: RuntimeToolLoadingMode;
  state: ToolExposureState;
  bootstrapToolNames?: ReadonlySet<string>;
  maxVisibleTools?: number;
}): ToolExposurePlan {
  const authorized: ToolDefinition[] = [];
  for (let index = 0; index < input.authorized.length; index++) {
    const tool = input.authorized[index];
    if (tool !== undefined) authorized[authorized.length] = tool;
  }
  if (input.mode === "eager") {
    return {
      authorized,
      visible: authorized,
      deferred: [],
      loadedToolNames: input.state.loadedToolNames,
    };
  }
  for (let index = 0; index < authorized.length; index++) {
    if (authorized[index]?.name === TOOL_SEARCH_TOOL_NAME) {
      throw new Error(`"${TOOL_SEARCH_TOOL_NAME}" is reserved by the Veryfront runtime`);
    }
  }

  const bootstrap = input.bootstrapToolNames ?? DEFAULT_BOOTSTRAP_TOOL_NAMES;
  let bootstrapCount = 0;
  const loadable: ToolDefinition[] = [];
  const loadableNames = new Set<string>();
  for (let index = 0; index < authorized.length; index++) {
    const tool = authorized[index]!;
    if (setHas(bootstrap, tool.name)) bootstrapCount += 1;
    else {
      loadable[loadable.length] = tool;
      ReflectApply(SetAdd, loadableNames, [tool.name]);
    }
  }
  const loadedCapacity = input.maxVisibleTools === undefined
    ? undefined
    : Math.max(0, input.maxVisibleTools - bootstrapCount);
  const maxLoadedTools = loadedCapacity === undefined
    ? undefined
    : Math.max(0, loadedCapacity - (loadable.length > loadedCapacity ? 1 : 0));
  pruneLoadedToolNames(input.state, loadableNames);
  retainNewestLoadedToolNames(input.state, maxLoadedTools);
  const visible: ToolDefinition[] = [];
  const visibleNames = new Set<string>();
  for (let index = 0; index < authorized.length; index++) {
    const tool = authorized[index]!;
    if (setHas(bootstrap, tool.name) || setHas(input.state.loadedToolNames, tool.name)) {
      visible[visible.length] = tool;
      ReflectApply(SetAdd, visibleNames, [tool.name]);
    }
  }
  const deferred: ToolDefinition[] = [];
  for (let index = 0; index < loadable.length; index++) {
    const tool = loadable[index]!;
    if (!setHas(visibleNames, tool.name)) deferred[deferred.length] = tool;
  }
  ReflectApply(ArraySort, deferred, [
    (left: ToolDefinition, right: ToolDefinition) => compareAscii(left.name, right.name),
  ]);
  if (deferred.length > 0) {
    visible[visible.length] = createToolSearchDefinition();
  }
  ReflectApply(ArraySort, visible, [
    (left: ToolDefinition, right: ToolDefinition) => compareAscii(left.name, right.name),
  ]);

  return {
    authorized,
    visible,
    deferred,
    loadedToolNames: input.state.loadedToolNames,
    ...(maxLoadedTools === undefined ? {} : { maxLoadedTools }),
  };
}

/** Search currently authorized executable schemas without returning any schema. */
export function searchToolExposure(input: {
  query: string;
  authorized: readonly ToolDefinition[];
  available?: readonly ToolDefinition[];
  state: ToolExposureState;
  maxLoadedTools?: number;
}): ToolSearchResult {
  const ranked = rankToolExposureMatches({
    query: input.query,
    available: input.available ?? [],
    authorized: input.authorized,
  });
  if (ranked[0]?.status === "available") {
    const matches = ranked
      .filter((match) => match.status === "available")
      .slice(0, TOOL_SEARCH_RESULT_LIMIT);
    return {
      matches,
      resultCount: matches.length,
      loadedCount: 0,
      miss: false,
    };
  }

  const matches = ranked
    .filter((match) => match.status === "loaded")
    .slice(
      0,
      input.maxLoadedTools === undefined
        ? TOOL_SEARCH_RESULT_LIMIT
        : Math.min(TOOL_SEARCH_RESULT_LIMIT, input.maxLoadedTools),
    );

  for (const match of matches) {
    input.state.loadedToolNames.delete(match.name);
    input.state.loadedToolNames.add(match.name);
  }
  retainNewestLoadedToolNames(input.state, input.maxLoadedTools);
  const loadedMatches = matches.filter((match) => input.state.loadedToolNames.has(match.name));

  return {
    matches: loadedMatches,
    resultCount: loadedMatches.length,
    loadedCount: loadedMatches.length,
    miss: loadedMatches.length === 0,
  };
}

/** Snapshot loaded names for private framework persistence. */
export function createToolExposureCheckpoint(
  authorized: readonly ToolDefinition[],
  state: ToolExposureState,
): ToolExposureCheckpoint {
  const authorizedNames = new Set(authorized.map((tool) => tool.name));
  return {
    version: 2,
    loadedToolNames: [...state.loadedToolNames]
      .filter((name) => authorizedNames.has(name)),
  };
}

/** Convert a private checkpoint into its durable root-run event. */
export function createToolExposureCheckpointEvent(
  checkpoint: ToolExposureCheckpoint,
): ToolExposureCheckpointEvent {
  return {
    type: AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT_EVENT_TYPE,
    ...checkpoint,
  };
}

/** Restore supported private state and re-apply current authorization. */
export function restoreToolExposureState(
  checkpoint:
    | {
      version: number;
      loadedToolNames?: unknown;
    }
    | null
    | undefined,
  authorized: readonly ToolDefinition[],
): ToolExposureState {
  if (
    !isSupportedToolExposureCheckpointVersion(checkpoint?.version) ||
    !ArrayIsArray(checkpoint.loadedToolNames) ||
    !checkpoint.loadedToolNames.every(isValidToolExposureCheckpointName)
  ) {
    return createToolExposureState();
  }

  const authorizedNames = new Set(authorized.map((tool) => tool.name));
  const loadedToolNames = checkpoint.loadedToolNames.filter((name) => authorizedNames.has(name));
  if (checkpoint.version === 1) loadedToolNames.sort(compareAscii);
  return createToolExposureState(loadedToolNames);
}
