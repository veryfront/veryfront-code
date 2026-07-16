import { defineSchema } from "#veryfront/schemas/index.ts";
import type { InferSchema } from "#veryfront/extensions/schema/index.ts";
import type { Tool } from "#veryfront/tool/types.ts";
import { zodToJsonSchema } from "#veryfront/tool/schema/zod-json-schema.ts";
import type { RuntimeToolCatalogEntry, RuntimeToolDiscoveryContext } from "./tool-discovery-context.ts";

export type { RuntimeToolCatalogEntry };

/** State of a tool within the current run. */
export type ToolSearchResultState = "active" | "available" | "requires_grant";

/** Single result returned by search_tools. */
export type ToolSearchResult = {
  name: string;
  description: string;
  source: string;
  state: ToolSearchResultState;
};

/** Output from search_tools. */
export type SearchToolsOutput = {
  results: ToolSearchResult[];
};

/** Options accepted by the search_tools tool. */
export type SearchToolsToolOptions = {
  context: RuntimeToolDiscoveryContext;
  /**
   * Returns the full authorized catalog for this run.
   * Hard-unauthorized tools must be excluded by the caller before passing.
   * Grant-recoverable tools are included with `requiresGrant: true`.
   */
  getAuthorizedCatalog: () => readonly RuntimeToolCatalogEntry[];
};

const getSearchToolsInputSchema = defineSchema((v) =>
  v.object({
    query: v.string().optional().describe(
      "Keyword search over tool name and description. Omit to list all available tools.",
    ),
    names: v.array(v.string()).optional().describe(
      "Exact-name lookup. If provided, query is ignored.",
    ),
    limit: v.number().int().positive().optional().describe(
      "Maximum number of results to return.",
    ),
  })
);

export type SearchToolsInput = InferSchema<ReturnType<typeof getSearchToolsInputSchema>>;

function resolveState(
  entry: RuntimeToolCatalogEntry,
  activatedSet: ReadonlySet<string>,
): ToolSearchResultState {
  if (activatedSet.has(entry.name)) return "active";
  if (entry.requiresGrant) return "requires_grant";
  return "available";
}

function matchesQuery(entry: RuntimeToolCatalogEntry, query: string): boolean {
  const q = query.toLowerCase();
  return (
    entry.name.toLowerCase().includes(q) ||
    entry.description.toLowerCase().includes(q)
  );
}

/** Create the search_tools host tool. */
export function createSearchToolsTool(
  options: SearchToolsToolOptions,
): Tool<SearchToolsInput, SearchToolsOutput> {
  function execute(input: SearchToolsInput): SearchToolsOutput {
    const catalog = options.getAuthorizedCatalog();
    const activatedSet: ReadonlySet<string> =
      options.context.activatedRemoteToolNames ?? new Set();

    let entries: readonly RuntimeToolCatalogEntry[];

    if (input.names && input.names.length > 0) {
      // Exact-name lookup: only return catalog entries that match requested names
      const nameSet = new Set(input.names);
      entries = catalog.filter((e) => nameSet.has(e.name));
    } else if (input.query) {
      entries = catalog.filter((e) => matchesQuery(e, input.query!));
    } else {
      entries = catalog;
    }

    if (input.limit !== undefined && input.limit > 0) {
      entries = entries.slice(0, input.limit);
    }

    const results: ToolSearchResult[] = entries.map((e) => ({
      name: e.name,
      description: e.description,
      source: e.source,
      state: resolveState(e, activatedSet),
    }));

    return { results };
  }

  return {
    id: "search_tools",
    type: "function",
    description:
      "Search the authorized MCP tool catalog for this run. " +
      "Returns name, description, source, and state (active|available|requires_grant) " +
      "for each matching tool. Input schemas are not returned. " +
      "Hard-unauthorized tools are invisible. " +
      "Use names for exact lookup; use query for keyword search over name and description. " +
      "After finding the tools you need, call load_tools to activate them.",
    inputSchema: getSearchToolsInputSchema(),
    get inputSchemaJson() {
      return zodToJsonSchema(getSearchToolsInputSchema());
    },
    execute: (input: SearchToolsInput) => Promise.resolve(execute(input)),
  };
}
