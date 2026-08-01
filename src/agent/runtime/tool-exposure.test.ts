import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import type { ToolDefinition } from "#veryfront/tool";
import {
  createToolExposureCheckpoint,
  createToolExposurePlan,
  createToolExposureState,
  createToolSearchDefinition,
  restoreToolExposureState,
  searchToolExposure,
  TOOL_SEARCH_TOOL_NAME,
} from "./tool-exposure.ts";

function definition(
  name: string,
  description: string,
  parameterDescription = `${name} unique parameter`,
): ToolDefinition {
  return {
    name,
    description,
    parameters: {
      type: "object",
      properties: {
        value: { type: "string", description: parameterDescription },
      },
    },
  };
}

const catalog = [
  definition("get_release", "Read the current deployment release", "current release identifier"),
  definition("create_release", "Publish a deployment release", "release label to publish"),
  definition("archive_release", "Archive an old deployment", "release label to archive"),
  definition("form_input", "Ask the user for structured input"),
  definition("load_skill", "Load a configured skill"),
];

it("tool exposure plans eager and deferred visibility deterministically", () => {
  const eager = createToolExposurePlan({
    authorized: catalog,
    mode: "eager",
    state: createToolExposureState(),
  });
  assertEquals(eager.visible.map((tool) => tool.name), catalog.map((tool) => tool.name));
  assertEquals(eager.deferred, []);

  const deferred = createToolExposurePlan({
    authorized: catalog,
    mode: "deferred",
    state: createToolExposureState(),
  });
  assertEquals(
    deferred.visible.map((tool) => tool.name),
    ["form_input", "load_skill", TOOL_SEARCH_TOOL_NAME],
  );
  assertEquals(
    deferred.deferred.map((tool) => tool.name),
    ["archive_release", "create_release", "get_release"],
  );
});

it("deferred exposure omits tool_search when only bootstrap tools are authorized", () => {
  const deferred = createToolExposurePlan({
    authorized: [
      definition("form_input", "Ask the user for structured input"),
      definition("load_skill", "Load a configured skill"),
    ],
    mode: "deferred",
    state: createToolExposureState(),
  });

  assertEquals(
    deferred.visible.map((tool) => tool.name),
    ["form_input", "load_skill"],
  );
  assertEquals(deferred.deferred, []);
});

it("tool search ranks exact name, description, and parameter matches", () => {
  const state = createToolExposureState();
  const exact = searchToolExposure({ query: "get_release", authorized: catalog, state });
  assertEquals(exact.matches[0]?.name, "get_release");

  const description = searchToolExposure({
    query: "deployment",
    authorized: catalog,
    state: createToolExposureState(),
  });
  assertEquals(
    description.matches.map((match) => match.name),
    ["archive_release", "create_release", "get_release"],
  );

  const parameter = searchToolExposure({
    query: "identifier",
    authorized: catalog,
    state: createToolExposureState(),
  });
  assertEquals(parameter.matches[0]?.name, "get_release");
});

it("tool search orders all four match ranks before name tie-breaking", () => {
  const rankedCatalog = [
    definition("a_parameter", "Other capability", "Release value"),
    definition("z_description", "Release information"),
    definition("release_notes", "Other capability"),
    definition("release", "Other capability"),
  ];

  assertEquals(
    searchToolExposure({
      query: "release",
      authorized: rankedCatalog,
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["release", "release_notes", "z_description", "a_parameter"],
  );
});

it("tool search normalizes ASCII case and underscores as spaces", () => {
  assertEquals(
    searchToolExposure({
      query: "GET RELEASE",
      authorized: [definition("get_release", "Read a deployment")],
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["get_release"],
  );
});

it("tool search falls back to deterministic whitespace terms after a phrase miss", () => {
  const fileCatalog = [
    definition("create_file", "Create a project file"),
    definition("update_file", "Update a project file"),
    definition("sandbox_write_file", "Write only inside the sandbox filesystem"),
  ];

  assertEquals(
    searchToolExposure({
      query: "create_file update_file project file",
      authorized: fileCatalog,
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["create_file", "update_file", "sandbox_write_file"],
  );
});

it("tool_search tells the model to search before declaring a requested tool unavailable", () => {
  const search = createToolSearchDefinition();

  assert(search.description.includes("before declaring a requested tool unavailable"));
  assertEquals(
    (search.parameters as { properties?: { query?: { description?: string } } }).properties?.query
      ?.description,
    "One exact tool name when known, or one short capability phrase. Do not combine alternatives.",
  );
});

it("tool search breaks equal-rank ties by raw ASCII name order", () => {
  const tiedCatalog = [
    definition("alpha", "Shared capability"),
    definition("Zeta", "Shared capability"),
    definition("Beta", "Shared capability"),
  ];

  assertEquals(
    searchToolExposure({
      query: "shared",
      authorized: tiedCatalog,
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["Beta", "Zeta", "alpha"],
  );
});

it("tool search returns a complete miss result for a blank normalized query", () => {
  assertEquals(
    searchToolExposure({
      query: " \t ",
      authorized: catalog,
      state: createToolExposureState(),
    }),
    {
      matches: [],
      resultCount: 0,
      loadedCount: 0,
      miss: true,
    },
  );
});

it("tool search caps stable schema-free results at five", () => {
  const authorized = Array.from(
    { length: 8 },
    (_, index) => definition(`tool_${index}`, "Shared searchable description"),
  );
  const result = searchToolExposure({
    query: "searchable",
    authorized,
    state: createToolExposureState(),
  });

  assertEquals(result.matches.length, 5);
  assertEquals(
    result.matches.map((match) => match.name),
    ["tool_0", "tool_1", "tool_2", "tool_3", "tool_4"],
  );
  const serialized = JSON.stringify(result.matches);
  assert(!serialized.includes("parameters"));
  assert(!serialized.includes("inputSchema"));
  assert(!serialized.includes("outputSchema"));
});

it("authorized search matches load for the next step", () => {
  const state = createToolExposureState();
  const result = searchToolExposure({ query: "get_release", authorized: catalog, state });
  assertEquals(result.matches, [{
    name: "get_release",
    description: "Read the current deployment release",
    status: "loaded",
  }]);

  const next = createToolExposurePlan({ authorized: catalog, mode: "deferred", state });
  assertEquals(
    next.visible.map((tool) => tool.name),
    ["form_input", "get_release", "load_skill", TOOL_SEARCH_TOOL_NAME],
  );
});

it("deferred exposure reserves bootstrap and search inside the provider tool budget", () => {
  const remoteCatalog = Array.from(
    { length: 130 },
    (_, index) => definition(`catalog_tool_${String(index).padStart(3, "0")}`, "Catalog tool"),
  );
  const authorized = [
    definition("form_input", "Ask the user for structured input"),
    definition("load_skill", "Load a configured skill"),
    ...remoteCatalog,
  ];
  const state = restoreToolExposureState({
    version: 1,
    loadedToolNames: remoteCatalog.map((tool) => tool.name),
  }, authorized);
  const plan = createToolExposurePlan({
    authorized,
    mode: "deferred",
    state,
    maxVisibleTools: 128,
  });

  assertEquals(plan.visible.length, 128);
  assertEquals(plan.visible.some((tool) => tool.name === "form_input"), true);
  assertEquals(plan.visible.some((tool) => tool.name === "load_skill"), true);
  assertEquals(plan.visible.some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME), true);
  assertEquals(plan.maxLoadedTools, 125);
  assertEquals(state.loadedToolNames.size, 125);
  assertEquals(state.loadedToolNames.has("catalog_tool_000"), false);
  assertEquals(state.loadedToolNames.has("catalog_tool_129"), true);
});

it("tool search evicts the oldest loaded schema before activating a new match at capacity", () => {
  const remoteCatalog = Array.from(
    { length: 130 },
    (_, index) => definition(`catalog_tool_${String(index).padStart(3, "0")}`, "Catalog tool"),
  );
  const state = createToolExposureState();
  for (const tool of remoteCatalog.slice(0, 125)) {
    searchToolExposure({
      query: tool.name,
      authorized: remoteCatalog,
      state,
      maxLoadedTools: 125,
    });
  }
  const result = searchToolExposure({
    query: "catalog_tool_129",
    authorized: remoteCatalog,
    state,
    maxLoadedTools: 125,
  });

  assertEquals(result.matches.map((match) => match.name), ["catalog_tool_129"]);
  assertEquals(state.loadedToolNames.size, 125);
  assertEquals(state.loadedToolNames.has("catalog_tool_000"), false);
  assertEquals(state.loadedToolNames.has("catalog_tool_129"), true);
});

it("tool search never returns tools outside the currently authorized executable catalog", () => {
  assertEquals(
    searchToolExposure({
      query: "list agents",
      authorized: catalog,
      state: createToolExposureState(),
    }).matches,
    [],
  );
});

it("tool exposure checkpoints are private, sorted, and restore only currently authorized tools", () => {
  const authorized = catalog.slice(0, 3);
  const state = createToolExposureState(["get_release", "create_release", "get_release"]);
  const checkpoint = createToolExposureCheckpoint(authorized, state);
  assertEquals(checkpoint.version, 1);
  assertEquals(checkpoint.loadedToolNames, ["create_release", "get_release"]);

  assertEquals(
    [...restoreToolExposureState(checkpoint, authorized).loadedToolNames].sort(),
    ["create_release", "get_release"],
  );
  assertEquals(
    [...restoreToolExposureState(checkpoint, [authorized[0]!]).loadedToolNames],
    ["get_release"],
  );
  assertEquals(
    [...restoreToolExposureState({ ...checkpoint, version: 2 }, authorized).loadedToolNames],
    [],
  );
});

it("tool exposure checkpoints canonicalize authorized loaded names", () => {
  const authorized = [
    definition("get_release", "get_release tool"),
    definition("list_projects", "list_projects tool"),
  ];
  const state = createToolExposureState([
    "list_projects",
    "get_release",
    "list_projects",
    "not_authorized",
  ]);

  assertEquals(createToolExposureCheckpoint(authorized, state), {
    version: 1,
    loadedToolNames: ["get_release", "list_projects"],
  });
});

it("tool exposure checkpoints round-trip every non-empty tool id accepted by the factory", () => {
  const authorized = [definition("release marker", "Read the release marker")];
  const checkpoint = createToolExposureCheckpoint(
    authorized,
    createToolExposureState(["release marker"]),
  );

  assertEquals(checkpoint.loadedToolNames, ["release marker"]);
  assertEquals(
    [...restoreToolExposureState(checkpoint, authorized).loadedToolNames],
    ["release marker"],
  );
});

it("tool exposure checkpoint restoration fails closed and reauthorizes names", () => {
  const authorized = [
    definition("still_authorized", "Still authorized"),
    definition("other_authorized", "Other authorized"),
  ];
  const restore = (checkpoint: {
    version: number;
    loadedToolNames?: unknown;
  }) => [...restoreToolExposureState(checkpoint, authorized).loadedToolNames];

  assertEquals(
    restore({
      version: 2,
      loadedToolNames: ["still_authorized"],
    }),
    [],
  );
  assertEquals(
    restore({
      version: 1,
      loadedToolNames: ["still_authorized", ""],
    }),
    [],
  );
  assertEquals(
    restore({
      version: 1,
      loadedToolNames: ["still_authorized", 42],
    }),
    [],
  );
  assertEquals(
    restore({
      version: 1,
      loadedToolNames: ["revoked", "unknown"],
    }),
    [],
  );

  assertEquals(
    restore({
      version: 1,
      loadedToolNames: ["still_authorized", "revoked"],
    }),
    ["still_authorized"],
  );
});

it("new and child runs start with fresh tool exposure state", () => {
  const parent = createToolExposureState(["get_release"]);
  const child = createToolExposureState();

  assertEquals([...parent.loadedToolNames], ["get_release"]);
  assertEquals([...child.loadedToolNames], []);
});

it("tool_search is reserved only when deferred framework search is injected", () => {
  const customSearch = definition("tool_search", "Custom eager search");
  const eager = createToolExposurePlan({
    authorized: [customSearch],
    mode: "eager",
    state: createToolExposureState(),
  });
  assertEquals(eager.visible, [customSearch]);

  let message = "";
  try {
    createToolExposurePlan({
      authorized: [customSearch],
      mode: "deferred",
      state: createToolExposureState(),
    });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert(message.includes("reserved"));
});
