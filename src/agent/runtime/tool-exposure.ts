import type { ToolDefinition } from "#veryfront/tool";
import type { RuntimeToolLoadingMode } from "./runtime-tool-config.ts";
import { isOwnDataPropertyDescriptor } from "./data-property-descriptor.ts";

/** Framework-owned model-facing tool used to load authorized schemas. */
export const TOOL_SEARCH_TOOL_NAME = "tool_search";

const DEFAULT_BOOTSTRAP_TOOL_NAMES = new Set(["load_skill"]);
const TOOL_SEARCH_RESULT_LIMIT = 5;
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

type RankedToolSearchMatch = {
  rank: number;
  matchCount: number;
  match: ToolSearchMatch;
};

type SearchableTool = ToolSearchMatch & {
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
      parameterDescriptions: parameters
        ? snapshotSchemaDescriptions(parameters.value, budget) ?? []
        : [],
    };
  } catch {
    return null;
  }
}

function getIndexedMatchRank(
  query: string,
  tool: SearchableTool,
): number | null {
  const name = normalizeSearchText(tool.name);
  if (name === query) return 0;
  if (name.includes(query)) return 1;
  if (normalizeSearchText(tool.description).includes(query)) return 2;
  return tool.parameterDescriptions.some((description) => description.includes(query)) ? 3 : null;
}

function rankToolExposureMatches(input: {
  query: string;
  available: readonly ToolDefinition[];
  authorized: readonly ToolDefinition[];
}): RankedToolSearchMatch[] {
  if (!isUtf8LengthWithin(input.query, TOOL_SEARCH_QUERY_MAX_BYTES)) return [];
  const query = normalizeSearchText(input.query);
  if (!query) return [];
  const terms = [...new Set(query.split(/\s+/).filter(Boolean))];
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
  const ranked: RankedToolSearchMatch[] = [];

  for (const tool of candidates) {
    const rank = getIndexedMatchRank(query, tool);
    if (rank === null) continue;
    ranked.push({
      rank,
      matchCount: 1,
      match: { name: tool.name, description: tool.description, status: tool.status },
    });
  }

  if (ranked.length === 0 && terms.length >= 2) {
    for (const tool of candidates) {
      const ranks = terms.flatMap((term) => {
        const rank = getIndexedMatchRank(term, tool);
        return rank === null ? [] : [rank];
      });
      if (ranks.length === 0) continue;
      ranked.push({
        rank: Math.min(...ranks),
        matchCount: ranks.length,
        match: { name: tool.name, description: tool.description, status: tool.status },
      });
    }
  }

  return ranked.sort((left, right) =>
    left.rank - right.rank || right.matchCount - left.matchCount ||
    (left.match.status === right.match.status ? 0 : left.match.status === "available" ? -1 : 1) ||
    compareAscii(left.match.name, right.match.name)
  );
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
  const authorized = [...input.authorized];
  if (input.mode === "eager") {
    return {
      authorized,
      visible: authorized,
      deferred: [],
      loadedToolNames: input.state.loadedToolNames,
    };
  }
  if (authorized.some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME)) {
    throw new Error(`"${TOOL_SEARCH_TOOL_NAME}" is reserved by the Veryfront runtime`);
  }

  const bootstrap = input.bootstrapToolNames ?? DEFAULT_BOOTSTRAP_TOOL_NAMES;
  const bootstrapCount = authorized.filter((tool) => bootstrap.has(tool.name)).length;
  const loadable = authorized.filter((tool) => !bootstrap.has(tool.name));
  const loadableNames = new Set(loadable.map((tool) => tool.name));
  const loadedCapacity = input.maxVisibleTools === undefined
    ? undefined
    : Math.max(0, input.maxVisibleTools - bootstrapCount);
  const maxLoadedTools = loadedCapacity === undefined
    ? undefined
    : Math.max(0, loadedCapacity - (loadable.length > loadedCapacity ? 1 : 0));
  pruneLoadedToolNames(input.state, loadableNames);
  retainNewestLoadedToolNames(input.state, maxLoadedTools);
  const visible = authorized
    .filter((tool) => bootstrap.has(tool.name) || input.state.loadedToolNames.has(tool.name));
  const visibleNames = new Set(visible.map((tool) => tool.name));
  const deferred = loadable
    .filter((tool) => !visibleNames.has(tool.name))
    .sort((left, right) => compareAscii(left.name, right.name));
  if (deferred.length > 0) {
    visible.push(createToolSearchDefinition());
  }
  visible.sort((left, right) => compareAscii(left.name, right.name));

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
  if (ranked[0]?.match.status === "available") {
    const matches = ranked
      .filter(({ match }) => match.status === "available")
      .slice(0, TOOL_SEARCH_RESULT_LIMIT)
      .map(({ match }) => match);
    return {
      matches,
      resultCount: matches.length,
      loadedCount: 0,
      miss: false,
    };
  }

  const matches = ranked
    .filter(({ match }) => match.status === "loaded")
    .slice(
      0,
      input.maxLoadedTools === undefined
        ? TOOL_SEARCH_RESULT_LIMIT
        : Math.min(TOOL_SEARCH_RESULT_LIMIT, input.maxLoadedTools),
    )
    .map(({ match }) => match);

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
