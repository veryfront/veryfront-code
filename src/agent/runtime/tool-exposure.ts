import {
  encodePrivateText,
  privateTextCharCodeAt,
  PrivateTextEncoder,
  privateTextIncludes,
  privateTextIndexOf,
  privateTextSlice,
  privateTextToLowerCase,
  privateTextTrim,
} from "#veryfront/security/private-text.ts";
import {
  everyPrivateArray,
  filterPrivateArray,
  mapPrivateArray,
  pushPrivateArray,
  slicePrivateArray,
  somePrivateArray,
} from "#veryfront/security/private-array.ts";
import { createPrivateSet } from "#veryfront/security/private-set.ts";
import { replacePrivateRegExp, testPrivateRegExp } from "#veryfront/security/private-regexp.ts";
import { privateByteLength } from "#veryfront/security/private-bytes.ts";
import type { ToolDefinition } from "#veryfront/tool";
import { parseIntegrationToolIdentity } from "#veryfront/integrations/source-policy.ts";
import type { RuntimeToolLoadingMode } from "./runtime-tool-config.ts";
import { isRuntimeProviderSchemaHiddenTool } from "./local-tool.ts";
import { isOwnDataPropertyDescriptor } from "./data-property-descriptor.ts";

const ArraySort = Array.prototype.sort;
const hasOwn = Object.hasOwn;
const fromCharCode = String.fromCharCode;
const RegExpConstructor = RegExp;
function sortSearchItems<T>(items: T[], compare: (a: T, b: T) => number): T[] {
  ReflectApply(ArraySort, items, [compare]);
  return items;
}
const SetAdd = Set.prototype.add;
const SetHas = Set.prototype.has;

function setHas<T>(set: ReadonlySet<T>, value: T): boolean {
  return ReflectApply(SetHas, set, [value]);
}

function isProviderSchemaVisibleToolDefinition(tool: ToolDefinition): boolean {
  return !isRuntimeProviderSchemaHiddenTool(tool);
}

/** Framework-owned model-facing tool used to load authorized schemas. */
export const TOOL_SEARCH_TOOL_NAME = "tool_search";

const DEFAULT_BOOTSTRAP_TOOL_NAMES = createPrivateSet(["veryfront__load_skill"]);
const LEGACY_BOOTSTRAP_TOOL_NAMES = createPrivateSet(["load_skill"]);
const TOOL_SEARCH_RESULT_LIMIT = 5;
/** The platform's own namespace, which models also use as an alias for local platform tools. */
const PLATFORM_TOOL_NAMESPACE = "veryfront";
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
const UTF8_ENCODER = new PrivateTextEncoder();
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
  "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINTED" as const;

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
  let lower = "";
  for (let index = 0; index < value.length; index++) {
    const code = privateTextCharCodeAt(value, index);
    lower += code >= 65 && code <= 90 ? fromCharCode(code + 32) : value[index];
  }
  return replacePrivateRegExp(/\s+/g, privateTextTrim(replacePrivateRegExp(/_/g, lower, " ")), " ");
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
  const trimmed = privateTextToLowerCase(privateTextTrim(query));
  const separator = privateTextIndexOf(trimmed, "__");
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
  const namespace = privateTextSlice(trimmed, 0, separator);
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
  const escaped = replacePrivateRegExp(/[.*+?^${}()|[\]\\-]/g, namespaceTerm, "\\$&");
  return new RegExpConstructor(`(?<![a-z0-9])${escaped}(?![a-z0-9])`);
}

function toSearchMatch(tool: SearchableTool): ToolSearchMatch {
  return { name: tool.name, description: tool.description, status: tool.status };
}

function compareToolSearchMatches(left: ToolSearchMatch, right: ToolSearchMatch): number {
  // Equally relevant visible tools must not hide deferred capabilities. Stronger
  // matches still win before this tie-break, including an exact visible name.
  return (left.status === right.status ? 0 : left.status === "loaded" ? -1 : 1) ||
    compareAscii(left.name, right.name);
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isUtf8LengthWithin(value: string, maxBytes: number): boolean {
  return value.length <= maxBytes &&
    privateByteLength(encodePrivateText(value, UTF8_ENCODER)) <= maxBytes;
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
    const length = privateByteLength(encodePrivateText(value, UTF8_ENCODER));
    bytes += length;
    aggregate.bytes += length;
    return bytes <= TOOL_SEARCH_SCHEMA_MAX_BYTES &&
      aggregate.bytes <= TOOL_SEARCH_TOTAL_SCHEMA_BYTES;
  };

  try {
    while (stack.length > 0) {
      const current = stack[stack.length - 1];
      stack.length--;
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

      for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
        if (!hasOwn(keys, keyIndex)) continue;
        const key = keys[keyIndex]!;
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
          pushPrivateArray(descriptions, normalizeSearchText(descriptor.value));
        }
        pushPrivateArray(stack, { value: descriptor.value, depth: current.depth + 1 });
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
  includeParameterDescriptions = true,
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
      parameterDescriptions: includeParameterDescriptions && parameters
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
  if (privateTextIncludes(tool.normalizedName, query)) return "name";
  if (privateTextIncludes(tool.normalizedDescription, query)) return "description";
  return somePrivateArray(
      tool.parameterDescriptions,
      (description) => privateTextIncludes(description, query),
    )
    ? "parameterDescription"
    : null;
}

function collectSearchCandidates(input: {
  available: readonly ToolDefinition[];
  authorized: readonly ToolDefinition[];
  includeParameterDescriptions?: boolean;
}): SearchableTool[] {
  const budget: SchemaSearchBudget = { nodes: 0, bytes: 0 };
  const candidates: SearchableTool[] = [];
  let examinedCandidates = 0;
  const append = (tools: readonly ToolDefinition[], status: ToolSearchMatch["status"]): void => {
    for (let toolIndex = 0; toolIndex < tools.length; toolIndex++) {
      if (!hasOwn(tools, toolIndex)) continue;
      const tool = tools[toolIndex]!;
      if (!isProviderSchemaVisibleToolDefinition(tool)) continue;
      if (examinedCandidates >= TOOL_SEARCH_CANDIDATE_LIMIT) return;
      examinedCandidates += 1;
      const snapshot = snapshotSearchableTool(
        tool,
        status,
        budget,
        input.includeParameterDescriptions,
      );
      if (snapshot) pushPrivateArray(candidates, snapshot);
    }
  };
  append(input.available, "available");
  append(input.authorized, "loaded");
  return candidates;
}

/** Bounded executable metadata, without inspecting or loading tool schemas. */
export type ToolInventoryPage = {
  matches: Array<{ name: string; description: string; status: "available" | "deferred" }>;
  resultCount: number;
  loadedCount: 0;
  miss: boolean;
  nextCursor: string | null;
};

export function listToolExposure(input: {
  authorized: readonly ToolDefinition[];
  available?: readonly ToolDefinition[];
  cursor?: string;
  limit?: number;
}): ToolInventoryPage {
  const limit = input.limit ?? 10;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("Tool inventory limit must be an integer from 1 to 20");
  }
  const offset = input.cursor === undefined ? 0 : Number(input.cursor);
  if (
    input.cursor !== undefined &&
    (!testPrivateRegExp(/^(0|[1-9][0-9]{0,9})$/, input.cursor) || !Number.isSafeInteger(offset))
  ) {
    throw new Error("Invalid tool inventory cursor");
  }
  const candidates = collectSearchCandidates({
    authorized: input.authorized,
    available: input.available ?? [],
    includeParameterDescriptions: false,
  });
  const seen = createPrivateSet<string>([]);
  const entries: ToolInventoryPage["matches"] = [];
  for (let index = 0; index < candidates.length; index++) {
    const entry = candidates[index]!;
    if (setHas(seen, entry.name)) continue;
    ReflectApply(SetAdd, seen, [entry.name]);
    pushPrivateArray(entries, {
      name: entry.name,
      description: entry.description.length > 240
        ? `${privateTextSlice(entry.description, 0, previewEnd(entry.description, 240))}...`
        : entry.description,
      status: entry.status === "available" ? "available" : "deferred",
    });
  }
  sortSearchItems(entries, (left, right) => compareAscii(left.name, right.name));
  if (offset > entries.length) throw new Error("Tool inventory changed; restart without a cursor");
  const matches = slicePrivateArray(entries, offset, offset + limit);
  return {
    matches,
    resultCount: matches.length,
    loadedCount: 0,
    miss: matches.length === 0,
    nextCursor: offset + matches.length < entries.length ? String(offset + matches.length) : null,
  };
}

/** Rank candidates against the query taken as one phrase, strongest field first. */
function rankWholeQueryMatches(
  query: string,
  candidates: readonly SearchableTool[],
): ToolSearchMatch[] {
  const ranked: { precedence: number; match: ToolSearchMatch }[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    if (!hasOwn(candidates, candidateIndex)) continue;
    const candidate = candidates[candidateIndex]!;
    const field = getMatchedField(query, candidate);
    if (field === null) continue;
    pushPrivateArray(ranked, {
      precedence: TOOL_SEARCH_FIELD_PRECEDENCE[field],
      match: toSearchMatch(candidate),
    });
  }
  return mapPrivateArray(
    sortSearchItems(
      ranked,
      (left, right) =>
        left.precedence - right.precedence || compareToolSearchMatches(left.match, right.match),
    ),
    ({ match }) => match,
  );
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

  const weightedTerms = mapPrivateArray(terms, (term) => {
    let documentFrequency = 0;
    for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
      if (!hasOwn(candidates, candidateIndex)) continue;
      const candidate = candidates[candidateIndex]!;
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
  let documentFrequencyTotal = 0;
  for (let index = 0; index < weightedTerms.length; index++) {
    documentFrequencyTotal += weightedTerms[index]!.documentFrequency;
  }
  const averageDocumentFrequency = documentFrequencyTotal / weightedTerms.length;

  const scored: { score: number; match: ToolSearchMatch }[] = [];
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    if (!hasOwn(candidates, candidateIndex)) continue;
    const candidate = candidates[candidateIndex]!;
    let score = 0;
    let matchedTermCount = 0;
    let matchedSelectiveTerm = false;
    let matchedCapabilityField = false;
    for (let index = 0; index < weightedTerms.length; index++) {
      const { term, documentFrequency, inverseDocumentFrequency } = weightedTerms[index]!;
      const field = getMatchedField(term, candidate);
      if (field === null) continue;
      matchedTermCount += 1;
      if (field !== "parameterDescription") matchedCapabilityField = true;
      score += inverseDocumentFrequency * TOOL_SEARCH_FIELD_WEIGHTS[field];
      if (documentFrequency <= averageDocumentFrequency) matchedSelectiveTerm = true;
    }
    // Selectivity suppresses filler, which only means anything when there is
    // something better to prefer. A candidate matching *every* term is not filler
    // however common those terms are: in a one-tool catalog every term matches
    // everything, so the floor alone would report a certain match as a miss.
    // A rare generic parameter field does not establish a multiword capability.
    // Name and description evidence can still route to catalog navigation,
    // such as an integration reader mentioning the requested provider.
    const minimumMatchedTerms = terms.length >= 3 ? Math.ceil(terms.length / 2) : 1;
    if (!matchedCapabilityField && matchedTermCount < minimumMatchedTerms) continue;
    if (!matchedSelectiveTerm && matchedTermCount < terms.length) continue;
    pushPrivateArray(scored, { score, match: toSearchMatch(candidate) });
  }

  return mapPrivateArray(
    sortSearchItems(
      scored,
      (left, right) =>
        right.score - left.score || compareToolSearchMatches(left.match, right.match),
    ),
    ({ match }) => match,
  );
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
  // canonical name satisfies a canonical query; catalog readers can provide guidance.
  const canonical = parseCanonicalIntegrationQuery(input.query);
  if (canonical !== null) {
    const canonicalName = canonical.canonicalName;
    const exact = canonicalName === null ? [] : sortSearchItems(
      mapPrivateArray(
        filterPrivateArray(
          candidates,
          (candidate) => privateTextToLowerCase(candidate.name) === canonicalName,
        ),
        toSearchMatch,
      ),
      compareToolSearchMatches,
    );
    if (exact.length > 0) return exact;

    // A missing exact action can discover catalog guidance, never another action.
    // Loading a sibling would report success for a capability the caller lacks.
    // Text evidence compares normalized namespaces, including names with underscores.
    const namespaceTerm = normalizeSearchText(canonical.namespace);
    const namespacePattern = createNamespaceTokenPattern(namespaceTerm);
    const namespaceCandidates = filterPrivateArray(candidates, (candidate) => {
      const identity = parseIntegrationToolIdentity(privateTextToLowerCase(candidate.name));
      const isPlatformCatalogReader = identity?.integration === PLATFORM_TOOL_NAMESPACE &&
        (identity.toolId === "get_integration" || identity.toolId === "list_integrations");
      const isLocalCatalogReader = candidate.name === "get_integration" ||
        candidate.name === "list_integrations";
      if (!isPlatformCatalogReader && !isLocalCatalogReader) return false;
      // A non-canonical tool carrying the namespace in its *name* is a
      // normalization coincidence, not the integration, whatever its description
      // happens to mention: `jira_list_projects` is a local tool, not Jira.
      if (testPrivateRegExp(namespacePattern, candidate.normalizedName)) return false;
      return testPrivateRegExp(namespacePattern, candidate.normalizedDescription) ||
        somePrivateArray(
          candidate.parameterDescriptions,
          (description) => testPrivateRegExp(namespacePattern, description),
        );
    });
    const namespaceMatches = rankWholeQueryMatches(namespaceTerm, namespaceCandidates);
    if (
      namespaceMatches.length > 0 ||
      somePrivateArray(
        candidates,
        (candidate) =>
          parseIntegrationToolIdentity(privateTextToLowerCase(candidate.name))?.integration ===
            canonical.namespace,
      ) || canonicalName === null ||
      canonical.namespace !== PLATFORM_TOOL_NAMESPACE
    ) {
      return namespaceMatches;
    }

    // With no integration evidence at all, models often prefix a platform tool with
    // the platform namespace (`veryfront__list_files`). Only that reserved namespace
    // aliases local tools: `github__list_files` must never load a project's own
    // `list_files`. Match the exact local id only; a normalized phrase match would
    // reintroduce `veryfront_list_files`.
    const localId = privateTextSlice(canonicalName, canonical.namespace.length + 2);
    return sortSearchItems(
      mapPrivateArray(
        filterPrivateArray(
          candidates,
          (candidate) => privateTextToLowerCase(candidate.name) === localId,
        ),
        toSearchMatch,
      ),
      compareToolSearchMatches,
    );
  }

  // A literal local id identifies one capability, not every tool whose schema
  // mentions it. Keep phrase searches broad while exact calls load only that schema.
  const literalName = privateTextToLowerCase(privateTextTrim(input.query));
  const exactLocalMatches = sortSearchItems(
    mapPrivateArray(
      filterPrivateArray(
        candidates,
        (candidate) => privateTextToLowerCase(candidate.name) === literalName,
      ),
      toSearchMatch,
    ),
    compareToolSearchMatches,
  );
  if (exactLocalMatches.length > 0) return exactLocalMatches;

  // The query taken whole is the strongest signal for every non-canonical query.
  const wholeQueryMatches = rankWholeQueryMatches(query, candidates);
  if (wholeQueryMatches.length > 0) return wholeQueryMatches;

  const uniqueTerms = createPrivateSet<string>();
  let start = 0;
  for (let index = 0; index <= query.length; index++) {
    if (index !== query.length && query[index] !== " ") continue;
    if (index > start) uniqueTerms.add(privateTextSlice(query, start, index));
    start = index + 1;
  }
  const terms = [...uniqueTerms];
  return terms.length >= 2 ? scoreToolExposureTerms(terms, candidates) : [];
}

/** Keep a preview cut from splitting a UTF-16 surrogate pair. */
function previewEnd(text: string, limit: number): number {
  const last = privateTextCharCodeAt(text, limit - 1);
  return last >= 0xd800 && last <= 0xdbff ? limit - 1 : limit;
}

/** Create fresh run-local tool exposure state. */
export function createToolExposureState(
  loadedToolNames: Iterable<string> = [],
): ToolExposureState {
  return { loadedToolNames: createPrivateSet(loadedToolNames) };
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
      "Discover this run's executable tools, not project tool definitions. Use inventory to browse bounded metadata pages without loading schemas. Use query with an exact returned name to load that tool's input schema for the next step, or a short capability phrase to search before declaring a requested tool unavailable. Choose query or inventory, not both.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: {
          type: "string",
          description:
            `One exact tool name when known, or one short capability phrase. UTF-8 input must be at most ${TOOL_SEARCH_QUERY_MAX_BYTES} bytes. Do not combine alternatives.`,
        },
        inventory: {
          type: "object",
          additionalProperties: false,
          properties: {
            cursor: {
              type: "string",
              description: "Use nextCursor from the preceding page. Omit for the first page.",
            },
            limit: {
              type: "integer",
              minimum: 1,
              maximum: 20,
              description: "Metadata entries per page, default 10.",
            },
          },
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
      visible: filterPrivateArray(authorized, isProviderSchemaVisibleToolDefinition),
      deferred: [],
      loadedToolNames: input.state.loadedToolNames,
    };
  }
  for (let index = 0; index < authorized.length; index++) {
    if (authorized[index]?.name === TOOL_SEARCH_TOOL_NAME) {
      throw new Error(`"${TOOL_SEARCH_TOOL_NAME}" is reserved by the Veryfront runtime`);
    }
  }

  const hasCanonicalSkillLoader = somePrivateArray(
    authorized,
    (tool) => tool.name === "veryfront__load_skill" && isProviderSchemaVisibleToolDefinition(tool),
  );
  // Match hosted inventory instructions and preserve the framework loader when
  // a project owns the local name. Defer the local alias when both are authorized.
  const bootstrap = input.bootstrapToolNames ??
    (hasCanonicalSkillLoader ? DEFAULT_BOOTSTRAP_TOOL_NAMES : LEGACY_BOOTSTRAP_TOOL_NAMES);
  let bootstrapCount = 0;
  const loadable: ToolDefinition[] = [];
  const loadableNames = createPrivateSet<string>();
  for (let index = 0; index < authorized.length; index++) {
    const tool = authorized[index]!;
    if (!isProviderSchemaVisibleToolDefinition(tool)) continue;
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
  const visibleNames = createPrivateSet<string>();
  for (let index = 0; index < authorized.length; index++) {
    const tool = authorized[index]!;
    if (!isProviderSchemaVisibleToolDefinition(tool)) continue;
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
    const matches = slicePrivateArray(
      filterPrivateArray(ranked, (match) => match.status === "available"),
      0,
      TOOL_SEARCH_RESULT_LIMIT,
    );
    return {
      matches,
      resultCount: matches.length,
      loadedCount: 0,
      miss: false,
    };
  }

  const matches = slicePrivateArray(
    filterPrivateArray(ranked, (match) => match.status === "loaded"),
    0,
    input.maxLoadedTools === undefined
      ? TOOL_SEARCH_RESULT_LIMIT
      : Math.min(TOOL_SEARCH_RESULT_LIMIT, input.maxLoadedTools),
  );

  for (let matchIndex = 0; matchIndex < matches.length; matchIndex++) {
    if (!hasOwn(matches, matchIndex)) continue;
    const match = matches[matchIndex]!;
    input.state.loadedToolNames.delete(match.name);
    input.state.loadedToolNames.add(match.name);
  }
  retainNewestLoadedToolNames(input.state, input.maxLoadedTools);
  const loadedMatches = filterPrivateArray(
    matches,
    (match) => input.state.loadedToolNames.has(match.name),
  );

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
  const authorizedNames = createPrivateSet(
    mapPrivateArray(
      filterPrivateArray(authorized, isProviderSchemaVisibleToolDefinition),
      (tool) => tool.name,
    ),
  );
  return {
    version: 2,
    loadedToolNames: filterPrivateArray(
      [...state.loadedToolNames],
      (name) => authorizedNames.has(name),
    ),
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
    !everyPrivateArray(checkpoint.loadedToolNames, isValidToolExposureCheckpointName)
  ) {
    return createToolExposureState();
  }

  const authorizedNames = createPrivateSet(
    mapPrivateArray(
      filterPrivateArray(authorized, isProviderSchemaVisibleToolDefinition),
      (tool) => tool.name,
    ),
  );
  const loadedToolNames = filterPrivateArray(
    checkpoint.loadedToolNames,
    (name) => authorizedNames.has(name),
  );
  if (checkpoint.version === 1) sortSearchItems(loadedToolNames, compareAscii);
  return createToolExposureState(loadedToolNames);
}
