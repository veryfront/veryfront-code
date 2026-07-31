import type { ToolDefinition } from "#veryfront/tool";
import type { RuntimeToolLoadingMode } from "./runtime-tool-config.ts";

/** Framework-owned model-facing tool used to load authorized schemas. */
export const TOOL_SEARCH_TOOL_NAME = "tool_search";

const DEFAULT_BOOTSTRAP_TOOL_NAMES = new Set(["form_input", "load_skill"]);
const TOOL_SEARCH_RESULT_LIMIT = 5;

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
};

/** Private versioned state persisted by the framework between resumed steps. */
export type ToolExposureCheckpoint = {
  version: 1;
  authorizedCatalogFingerprint: string;
  loadedToolNames: string[];
};

export const AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT_EVENT_TYPE =
  "AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT" as const;

/** Private durable event carrying trusted tool exposure state. */
export type ToolExposureCheckpointEvent = ToolExposureCheckpoint & {
  type: typeof AGENT_RUN_TOOL_EXPOSURE_CHECKPOINT_EVENT_TYPE;
};

/** Schema-free model-visible search result. */
export type ToolSearchMatch = { name: string; description: string; status: "loaded" };

/** Search output plus bounded observability counters. */
export type ToolSearchResult = {
  matches: ToolSearchMatch[];
  resultCount: number;
  loadedCount: number;
  miss: boolean;
};

function normalizeSearchText(value: string): string {
  return value.replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 32))
    .replaceAll("_", " ").trim().replace(/\s+/g, " ");
}

function compareAscii(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Return whether a persisted name matches the existing non-empty tool id contract. */
export function isValidToolExposureCheckpointName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function collectSchemaDescriptions(value: unknown, output: string[]): void {
  if (Array.isArray(value)) {
    for (const entry of value) collectSchemaDescriptions(entry, output);
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key === "description" && typeof entry === "string") {
      output.push(entry);
    } else {
      collectSchemaDescriptions(entry, output);
    }
  }
}

function getMatchRank(input: {
  query: string;
  name: string;
  description: string;
  parameters?: unknown;
}): number | null {
  const query = normalizeSearchText(input.query);
  if (!query) return null;

  const name = normalizeSearchText(input.name);
  if (name === query) return 0;
  if (name.includes(query)) return 1;
  if (normalizeSearchText(input.description).includes(query)) return 2;

  const parameterDescriptions: string[] = [];
  collectSchemaDescriptions(input.parameters, parameterDescriptions);
  return parameterDescriptions.some((description) =>
      normalizeSearchText(description).includes(query)
    )
    ? 3
    : null;
}

function getTermFallbackScore(input: {
  query: string;
  name: string;
  description: string;
  parameters?: unknown;
}): { rank: number; matchCount: number } | null {
  const terms = [
    ...new Set(input.query.trim().split(/\s+/).map(normalizeSearchText).filter(Boolean)),
  ];
  if (terms.length < 2) return null;

  const ranks = terms.flatMap((term) => {
    const rank = getMatchRank({ ...input, query: term });
    return rank === null ? [] : [rank];
  });
  return ranks.length > 0 ? { rank: Math.min(...ranks), matchCount: ranks.length } : null;
}

function stableCatalogValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableCatalogValue).join(",")}]`;
  }
  if (!value || typeof value !== "object") {
    return JSON.stringify(value);
  }
  return `{${
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareAscii(left, right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableCatalogValue(entry)}`)
      .join(",")
  }}`;
}

/** Compute a deterministic non-secret identity for an authorized schema catalog. */
export function fingerprintAuthorizedToolCatalog(authorized: readonly ToolDefinition[]): string {
  const value = stableCatalogValue(
    [...authorized].sort((left, right) => compareAscii(left.name, right.name)),
  );
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/** Create fresh run-local tool exposure state. */
export function createToolExposureState(
  loadedToolNames: Iterable<string> = [],
): ToolExposureState {
  return { loadedToolNames: new Set(loadedToolNames) };
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
            "One exact tool name when known, or one short capability phrase. Do not combine alternatives.",
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
  const visible = authorized
    .filter((tool) => bootstrap.has(tool.name) || input.state.loadedToolNames.has(tool.name))
    .sort((left, right) => compareAscii(left.name, right.name));
  const visibleNames = new Set(visible.map((tool) => tool.name));
  const deferred = authorized
    .filter((tool) => !visibleNames.has(tool.name))
    .sort((left, right) => compareAscii(left.name, right.name));
  if (deferred.length > 0) {
    visible.push(createToolSearchDefinition());
  }

  return {
    authorized,
    visible,
    deferred,
    loadedToolNames: input.state.loadedToolNames,
  };
}

/** Search currently authorized executable schemas without returning any schema. */
export function searchToolExposure(input: {
  query: string;
  authorized: readonly ToolDefinition[];
  state: ToolExposureState;
}): ToolSearchResult {
  const ranked: Array<{ rank: number; matchCount: number; match: ToolSearchMatch }> = [];

  for (const tool of input.authorized) {
    const rank = getMatchRank({
      query: input.query,
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    });
    if (rank === null) continue;
    ranked.push({
      rank,
      matchCount: 1,
      match: { name: tool.name, description: tool.description, status: "loaded" },
    });
  }

  if (ranked.length === 0) {
    for (const tool of input.authorized) {
      const score = getTermFallbackScore({
        query: input.query,
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      });
      if (!score) continue;
      ranked.push({
        ...score,
        match: { name: tool.name, description: tool.description, status: "loaded" },
      });
    }
  }

  const matches = ranked
    .sort((left, right) =>
      left.rank - right.rank || right.matchCount - left.matchCount ||
      compareAscii(left.match.name, right.match.name)
    )
    .slice(0, TOOL_SEARCH_RESULT_LIMIT)
    .map(({ match }) => match);

  for (const match of matches) input.state.loadedToolNames.add(match.name);

  return {
    matches,
    resultCount: matches.length,
    loadedCount: matches.length,
    miss: matches.length === 0,
  };
}

/** Snapshot loaded names for private framework persistence. */
export function createToolExposureCheckpoint(
  authorized: readonly ToolDefinition[],
  state: ToolExposureState,
): ToolExposureCheckpoint {
  const authorizedNames = new Set(authorized.map((tool) => tool.name));
  return {
    version: 1,
    authorizedCatalogFingerprint: fingerprintAuthorizedToolCatalog(authorized),
    loadedToolNames: [...state.loadedToolNames]
      .filter((name) => authorizedNames.has(name))
      .sort(),
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
      authorizedCatalogFingerprint?: unknown;
      loadedToolNames?: unknown;
    }
    | null
    | undefined,
  authorized: readonly ToolDefinition[],
): ToolExposureState {
  if (
    checkpoint?.version !== 1 ||
    typeof checkpoint.authorizedCatalogFingerprint !== "string" ||
    !Array.isArray(checkpoint.loadedToolNames) ||
    !checkpoint.loadedToolNames.every(isValidToolExposureCheckpointName)
  ) {
    return createToolExposureState();
  }

  const authorizedNames = new Set(authorized.map((tool) => tool.name));
  return createToolExposureState(
    checkpoint.loadedToolNames.filter((name) => authorizedNames.has(name)),
  );
}
