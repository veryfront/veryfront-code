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

it("copies authorized tools without a mutable array iterator", () => {
  const allowed = [definition("allowed", "Allowed tool")];
  const denied = definition("denied", "Denied tool");
  const originalIterator = Array.prototype[Symbol.iterator];
  let plan!: ReturnType<typeof createToolExposurePlan>;
  try {
    Array.prototype[Symbol.iterator] = function* (): ArrayIterator<unknown> {
      yield* Reflect.apply(originalIterator, this, []);
      if (this === allowed) yield denied;
      return undefined;
    };
    plan = createToolExposurePlan({
      authorized: allowed,
      mode: "eager",
      state: createToolExposureState(),
    });
  } finally {
    Array.prototype[Symbol.iterator] = originalIterator;
  }

  assertEquals(plan.authorized.map((tool) => tool.name), ["allowed"]);
});

function withPollutedDescriptorPrototypeValue<T>(value: unknown, fn: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  Object.defineProperty(Object.prototype, "value", {
    configurable: true,
    value,
  });
  try {
    return fn();
  } finally {
    if (original) {
      Object.defineProperty(Object.prototype, "value", original);
    } else {
      delete (Object.prototype as Record<string, unknown>).value;
    }
  }
}

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
    ["load_skill", TOOL_SEARCH_TOOL_NAME],
  );
  assertEquals(
    deferred.deferred.map((tool) => tool.name),
    ["archive_release", "create_release", "form_input", "get_release"],
  );
});

it("deferred exposure keeps form_input searchable and omits search for load_skill alone", () => {
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
    ["load_skill", TOOL_SEARCH_TOOL_NAME],
  );
  assertEquals(deferred.deferred.map((tool) => tool.name), ["form_input"]);

  const loadSkillOnly = createToolExposurePlan({
    authorized: [definition("load_skill", "Load a configured skill")],
    mode: "deferred",
    state: createToolExposureState(),
  });
  assertEquals(loadSkillOnly.visible.map((tool) => tool.name), ["load_skill"]);
  assertEquals(loadSkillOnly.deferred, []);
});

it("deferred exposure keeps injected tool_search in visible ASCII order", () => {
  const deferred = createToolExposurePlan({
    authorized: [
      definition("z_bootstrap", "Always visible"),
      definition("a_deferred", "Searchable later"),
    ],
    bootstrapToolNames: new Set(["z_bootstrap"]),
    mode: "deferred",
    state: createToolExposureState(),
  });

  assertEquals(
    deferred.visible.map((tool) => tool.name),
    [TOOL_SEARCH_TOOL_NAME, "z_bootstrap"],
  );
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

it("tool search reports a capability-matched visible tool without loading deferred schemas", () => {
  const state = createToolExposureState();
  const result = searchToolExposure({
    query: "structured input",
    authorized: [definition("create_form", "Create a reusable form")],
    available: [definition("form_input", "Collect structured input")],
    state,
  });

  assertEquals(result, {
    matches: [{
      name: "form_input",
      description: "Collect structured input",
      status: "available",
    }],
    resultCount: 1,
    loadedCount: 0,
    miss: false,
  });
  assertEquals([...state.loadedToolNames], []);
});

it("tool search loads a deferred exact-name match ahead of a visible capability match", () => {
  const state = createToolExposureState();
  const result = searchToolExposure({
    query: "release",
    authorized: [definition("release", "Publish the release")],
    available: [definition("get_status", "Read release status")],
    state,
  });

  assertEquals(result.matches, [{
    name: "release",
    description: "Publish the release",
    status: "loaded",
  }]);
  assertEquals([...state.loadedToolNames], ["release"]);
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

it("tool search scores fallback terms by selectivity after a phrase miss", () => {
  const fileCatalog = [
    definition("create_file", "Create a project file"),
    definition("update_file", "Update a project file"),
    definition("sandbox_write_file", "Write only inside the sandbox filesystem"),
  ];

  // `file` matches every candidate and therefore says nothing about which one the
  // caller meant; `create` and `update` each match exactly one. `sandbox_write_file`
  // matches no term but `file`, so returning it would be filler, not a result.
  assertEquals(
    searchToolExposure({
      query: "create_file update_file project file",
      authorized: fileCatalog,
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["create_file", "update_file"],
  );
});

it("tool search misses when a common verb is the only match in a realistic catalog", () => {
  const realisticCatalog = [
    ...Array.from(
      { length: 30 },
      (_, index) =>
        definition(
          `list_catalog_${String(index).padStart(3, "0")}`,
          `List catalog item ${String(index).padStart(3, "0")}`,
        ),
    ),
    ...Array.from(
      { length: 100 },
      (_, index) =>
        definition(
          `catalog_tool_${String(index + 30).padStart(3, "0")}`,
          "Catalog tool",
        ),
    ),
  ];

  assertEquals(
    searchToolExposure({
      query: "list emails",
      authorized: realisticCatalog,
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

it("tool_search tells the model to search before declaring a requested tool unavailable", () => {
  const search = createToolSearchDefinition();
  const querySchema = (search.parameters as {
    properties?: { query?: { description?: string; maxLength?: number } };
  }).properties?.query;

  assert(search.description.includes("before declaring a requested tool unavailable"));
  assertEquals(
    querySchema?.description,
    "One exact tool name when known, or one short capability phrase. UTF-8 input must be at most 256 bytes. Do not combine alternatives.",
  );
  assertEquals(querySchema?.maxLength, undefined);
});

it("tool search enforces query limits in UTF-8 bytes", () => {
  const search = (query: string) =>
    searchToolExposure({
      query,
      authorized: [definition("matching_tool", query)],
      state: createToolExposureState(),
    }).matches.map((match) => match.name);

  assertEquals(search("a".repeat(256)), ["matching_tool"]);
  assertEquals(search("a".repeat(257)), []);
  assertEquals(search("💥".repeat(64)), ["matching_tool"]);
  assertEquals(search("💥".repeat(65)), []);
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

it("tool search treats deeply nested and cyclic parameter schemas as isolated non-matches", () => {
  const deepRoot: Record<string, unknown> = {};
  let cursor = deepRoot;
  for (let index = 0; index < 20_000; index += 1) {
    const child: Record<string, unknown> = {};
    cursor.next = child;
    cursor = child;
  }
  cursor.description = "deep-only capability";
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  cyclic.description = "cyclic-only capability";

  const result = searchToolExposure({
    query: "healthy capability",
    authorized: [
      { name: "deep", description: "Unrelated", parameters: deepRoot },
      { name: "cyclic", description: "Unrelated", parameters: cyclic },
      definition("healthy", "Healthy capability"),
    ],
    state: createToolExposureState(),
  });

  assertEquals(result.matches.map((match) => match.name), ["healthy"]);
});

it("tool search never invokes schema accessors and contains throwing proxy reflection", () => {
  let getterReads = 0;
  const accessorSchema = Object.defineProperty({}, "description", {
    enumerable: true,
    get() {
      getterReads += 1;
      return "accessor capability";
    },
  });
  let proxyReads = 0;
  const proxySchema = new Proxy({}, {
    ownKeys() {
      proxyReads += 1;
      throw new Error("hostile reflection");
    },
  });

  const result = searchToolExposure({
    query: "healthy capability",
    authorized: [
      { name: "accessor", description: "Unrelated", parameters: accessorSchema },
      { name: "proxy", description: "Unrelated", parameters: proxySchema },
      definition("healthy", "Healthy capability"),
    ],
    state: createToolExposureState(),
  });

  assertEquals(result.matches.map((match) => match.name), ["healthy"]);
  assertEquals(getterReads, 0);
  assertEquals(proxyReads, 1);
});

it("tool search rejects accessors and revoked proxies despite inherited descriptor values", () => {
  let toolNameReads = 0;
  let schemaDescriptionReads = 0;
  const accessorTool = {
    description: "Unrelated",
    parameters: {},
  } as ToolDefinition;
  Object.defineProperty(accessorTool, "name", {
    enumerable: true,
    get() {
      toolNameReads += 1;
      return "accessor_tool";
    },
  });
  const accessorSchema = Object.defineProperty({}, "description", {
    enumerable: true,
    get() {
      schemaDescriptionReads += 1;
      return "polluted capability";
    },
  });
  const revokedTool = Proxy.revocable(definition("revoked", "Polluted capability"), {});
  revokedTool.revoke();

  const result = withPollutedDescriptorPrototypeValue(
    "polluted capability",
    () =>
      searchToolExposure({
        query: "polluted capability",
        authorized: [
          accessorTool,
          { name: "schema_accessor", description: "Unrelated", parameters: accessorSchema },
          revokedTool.proxy as ToolDefinition,
        ],
        state: createToolExposureState(),
      }),
  );

  assertEquals(result.matches, []);
  assertEquals(result.miss, true);
  assertEquals(toolNameReads, 0);
  assertEquals(schemaDescriptionReads, 0);
});

it("tool search bounds catalog traversal and returned description bytes", () => {
  const within = Array.from(
    { length: 4_096 },
    (_, index) => definition(index === 4_095 ? "within_limit" : `irrelevant_${index}`, "Other"),
  );
  within.push(definition("beyondcatalog", "Beyond candidate ceiling"));
  assertEquals(
    searchToolExposure({
      query: "within_limit",
      authorized: within,
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["within_limit"],
  );
  assertEquals(
    searchToolExposure({
      query: "beyondcatalog",
      authorized: within,
      state: createToolExposureState(),
    }).miss,
    true,
  );

  const oversizedDescription = "💥".repeat(1_100);
  assertEquals(
    searchToolExposure({
      query: "healthy",
      authorized: [
        definition("oversized", oversizedDescription),
        definition("healthy", "Healthy bounded result"),
      ],
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["healthy"],
  );
});

it("tool search preserves later name matches after exhausting aggregate schema work", () => {
  const wideSchema = (): Record<string, unknown> => ({
    type: "object",
    properties: Object.fromEntries(
      Array.from({ length: 4_000 }, (_, index) => [`field_${index}`, { type: "string" }]),
    ),
  });
  const exhausting = Array.from(
    { length: 20 },
    (_, index) => ({
      name: `wide_${index}`,
      description: "Other",
      parameters: wideSchema(),
    }),
  );

  const result = searchToolExposure({
    query: "healthy_after_budget",
    authorized: [...exhausting, definition("healthy_after_budget", "Healthy")],
    state: createToolExposureState(),
  });

  assertEquals(result.matches.map((match) => match.name), ["healthy_after_budget"]);
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
    ["get_release", "load_skill", TOOL_SEARCH_TOOL_NAME],
  );
});

it("form_input activation survives a private checkpoint and current-authorization restore", () => {
  const authorized = [
    definition("form_input", "Ask the user for structured input"),
    definition("load_skill", "Load a configured skill"),
  ];
  const state = createToolExposureState();
  const initial = createToolExposurePlan({
    authorized,
    mode: "deferred",
    state,
  });
  assertEquals(initial.visible.map((tool) => tool.name), ["load_skill", TOOL_SEARCH_TOOL_NAME]);

  const search = searchToolExposure({
    query: "form_input",
    authorized: initial.deferred,
    state,
  });
  assertEquals(search.matches.map((match) => match.name), ["form_input"]);

  const restored = restoreToolExposureState(
    createToolExposureCheckpoint(authorized, state),
    authorized,
  );
  const resumed = createToolExposurePlan({
    authorized,
    mode: "deferred",
    state: restored,
  });
  assertEquals(resumed.visible.map((tool) => tool.name), ["form_input", "load_skill"]);
  assertEquals(resumed.deferred, []);
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
  assertEquals(plan.visible.some((tool) => tool.name === "form_input"), false);
  assertEquals(plan.visible.some((tool) => tool.name === "load_skill"), true);
  assertEquals(plan.visible.some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME), true);
  assertEquals(plan.maxLoadedTools, 126);
  assertEquals(state.loadedToolNames.size, 126);
  assertEquals(state.loadedToolNames.has("catalog_tool_000"), false);
  assertEquals(state.loadedToolNames.has("catalog_tool_129"), true);
});

it("deferred exposure uses the full provider budget once the exact-fit catalog is loaded", () => {
  const remoteCatalog = Array.from(
    { length: 126 },
    (_, index) => definition(`catalog_tool_${String(index).padStart(3, "0")}`, "Catalog tool"),
  );
  const authorized = [
    definition("form_input", "Ask the user for structured input"),
    definition("load_skill", "Load a configured skill"),
    ...remoteCatalog,
  ];
  const state = createToolExposureState([
    "form_input",
    ...remoteCatalog.map((tool) => tool.name),
  ]);

  const plan = createToolExposurePlan({
    authorized,
    mode: "deferred",
    state,
    maxVisibleTools: 128,
  });

  assertEquals(plan.visible.length, 128);
  assertEquals(plan.visible.some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME), false);
  assertEquals(plan.deferred, []);
  assertEquals(plan.maxLoadedTools, 127);
  assertEquals(state.loadedToolNames.size, 127);
});

it("exact-fit deferred exposure loads the final schema without exceeding the provider budget", () => {
  const remoteCatalog = Array.from(
    { length: 126 },
    (_, index) => definition(`catalog_tool_${String(index).padStart(3, "0")}`, "Catalog tool"),
  );
  const authorized = [
    definition("form_input", "Ask the user for structured input"),
    definition("load_skill", "Load a configured skill"),
    ...remoteCatalog,
  ];
  const state = createToolExposureState([
    "form_input",
    ...remoteCatalog.slice(0, 125).map((tool) => tool.name),
  ]);

  const searchStep = createToolExposurePlan({
    authorized,
    mode: "deferred",
    state,
    maxVisibleTools: 128,
  });
  assertEquals(searchStep.visible.length, 128);
  assertEquals(searchStep.deferred.map((tool) => tool.name), ["catalog_tool_125"]);
  assertEquals(searchStep.maxLoadedTools, 127);

  const search = searchToolExposure({
    query: "catalog_tool_125",
    authorized: searchStep.deferred,
    state,
    maxLoadedTools: searchStep.maxLoadedTools,
  });
  assertEquals(search.loadedCount, 1);
  assertEquals(state.loadedToolNames.size, 127);

  const loadedStep = createToolExposurePlan({
    authorized,
    mode: "deferred",
    state,
    maxVisibleTools: 128,
  });
  assertEquals(loadedStep.visible.length, 128);
  assertEquals(loadedStep.deferred, []);
  assertEquals(loadedStep.visible.some((tool) => tool.name === TOOL_SEARCH_TOOL_NAME), false);
});

it("deferred exposure prunes revoked and bootstrap names before budget eviction", () => {
  const retained = definition("retained_tool", "Retained deferred tool");
  const authorized = [
    definition("form_input", "Ask the user for structured input"),
    definition("load_skill", "Load a configured skill"),
    retained,
    definition("other_tool", "Other deferred tool"),
  ];
  const state = createToolExposureState([
    retained.name,
    "revoked_tool",
    "form_input",
    "load_skill",
  ]);

  const plan = createToolExposurePlan({
    authorized,
    mode: "deferred",
    state,
    maxVisibleTools: 4,
  });

  assertEquals([...state.loadedToolNames], [retained.name, "form_input"]);
  assertEquals(
    plan.visible.map((tool) => tool.name),
    ["form_input", "load_skill", retained.name, TOOL_SEARCH_TOOL_NAME],
  );
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

it("tool exposure checkpoints are private, ordered, and restore only currently authorized tools", () => {
  const authorized = catalog.slice(0, 3);
  const state = createToolExposureState(["get_release", "create_release", "get_release"]);
  const checkpoint = createToolExposureCheckpoint(authorized, state);
  assertEquals(checkpoint.version, 2);
  assertEquals(checkpoint.loadedToolNames, ["get_release", "create_release"]);

  assertEquals(
    [...restoreToolExposureState(checkpoint, authorized).loadedToolNames].sort(),
    ["create_release", "get_release"],
  );
  assertEquals(
    [...restoreToolExposureState(checkpoint, [authorized[0]!]).loadedToolNames],
    ["get_release"],
  );
  assertEquals(
    [...restoreToolExposureState({ ...checkpoint, version: 3 }, authorized).loadedToolNames],
    [],
  );
});

it("tool exposure checkpoint restoration upgrades legacy v1 order deterministically", () => {
  const authorized = [
    definition("a_legacy_oldest", "Legacy sorted first"),
    definition("z_legacy_newer", "Legacy sorted last"),
  ];

  assertEquals(
    [
      ...restoreToolExposureState({
        version: 1,
        loadedToolNames: ["z_legacy_newer", "a_legacy_oldest"],
      }, authorized).loadedToolNames,
    ],
    ["a_legacy_oldest", "z_legacy_newer"],
  );
});

it("tool exposure checkpoints preserve eviction recency across restoration", () => {
  const authorized = [
    definition("z_oldest", "Oldest loaded tool"),
    definition("a_newer", "Newer loaded tool"),
    definition("m_next", "Next loaded tool"),
  ];
  const checkpoint = createToolExposureCheckpoint(
    authorized,
    createToolExposureState(["z_oldest", "a_newer"]),
  );
  const restored = restoreToolExposureState(checkpoint, authorized);

  searchToolExposure({
    query: "m_next",
    authorized,
    state: restored,
    maxLoadedTools: 2,
  });

  assertEquals(checkpoint.loadedToolNames, ["z_oldest", "a_newer"]);
  assertEquals([...restored.loadedToolNames], ["a_newer", "m_next"]);
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
    version: 2,
    loadedToolNames: ["list_projects", "get_release"],
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
      version: 3,
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

const VERYFRONT_LIST_TOOL_NAMES = [
  "list_accessible_agents",
  "list_agent_runs",
  "list_agent_templates",
  "list_agent_tool_references",
  "list_agent_workers",
  "list_agents",
  "list_child_agent_runs",
  "list_child_agent_runs_by_parent_conversation",
  "list_eval_runs",
  "list_evals",
  "list_external_files",
  "list_files",
  "list_input_requests",
  "list_integrations",
  "list_models",
  "list_projects",
  "list_prompts",
  "list_releases",
  "list_resources",
  "list_sandbox_background_commands",
  "list_sandbox_sessions",
  "list_schedules",
  "list_skills",
  "list_tasks",
  "list_tools",
  "list_uploads",
  "list_workflows",
];

const CATALOG_NAMESPACE_DESCRIPTION =
  "Get detailed configuration, available tool IDs, and input schemas for an integration. " +
  "Use this for integration tool IDs in these namespaces: confluence, github, jira, salesforce.";

function integrationDiscoveryCatalog(): ToolDefinition[] {
  return [
    ...VERYFRONT_LIST_TOOL_NAMES.map((name) =>
      definition(name, `List ${name.slice("list_".length).replaceAll("_", " ")}`)
    ),
    definition("get_integration", CATALOG_NAMESPACE_DESCRIPTION, "integration namespace name"),
  ];
}

it("tool search ranks a rare description term above a common name term", () => {
  const matches = searchToolExposure({
    query: "list github issues",
    authorized: integrationDiscoveryCatalog(),
    state: createToolExposureState(),
  }).matches.map((match) => match.name);

  assertEquals(matches[0], "get_integration");
  assertEquals(matches.filter((name) => name.startsWith("list_agent")), []);
});

it("tool search resolves a canonical integration tool id to its namespace", () => {
  // Every one of these word-splits onto a platform tool that would otherwise win:
  // `list_projects`, `list_...`, and the `search_*` family all share the generic
  // half of the id. Resolving the namespace is what keeps the wrong tool out.
  for (
    const query of [
      "jira__list_projects",
      "jira__list_comments",
      "jira__list_sites",
      "jira__search_users",
      "github__list_repos",
    ]
  ) {
    assertEquals(
      searchToolExposure({
        query,
        authorized: integrationDiscoveryCatalog(),
        state: createToolExposureState(),
      }).matches.map((match) => match.name),
      ["get_integration"],
      `canonical id ${query} must resolve to its namespace`,
    );
  }
});

it("tool search prefers an authorized integration tool over its namespace catalog entry", () => {
  const result = searchToolExposure({
    query: "jira__list_projects",
    authorized: [
      ...integrationDiscoveryCatalog(),
      definition("jira__list_projects", "List Jira projects on a site"),
    ],
    state: createToolExposureState(),
  });

  assertEquals(result.matches[0]?.name, "jira__list_projects");
});

it("tool search does not let a same-named local tool satisfy a canonical id", () => {
  // `jira__list_projects` and the local id `jira_list_projects` normalize to the
  // same text, and the registry permits any local id without `__`. A phrase match
  // must not hand back the local tool for a canonical query.
  const result = searchToolExposure({
    query: "jira__list_projects",
    authorized: [
      ...integrationDiscoveryCatalog(),
      definition("jira_list_projects", "A project-local tool that is not the Jira integration"),
    ],
    state: createToolExposureState(),
  });

  assertEquals(result.matches.map((match) => match.name), ["get_integration"]);
});

it("tool search keeps a malformed namespace-shaped query off local tools", () => {
  // `jira__list__projects` is not a valid canonical id, but `__` is reserved for
  // the integration namespace and local ids may not contain it. Normalization
  // collapses it onto the local `jira_list_projects`, which must not win.
  const authorized = [
    ...integrationDiscoveryCatalog(),
    definition("jira_list_projects", "A project-local tool that is not the Jira integration"),
  ];

  for (const query of ["jira__list__projects", "JIRA__LIST_PROJECTS", "jira__list_projects "]) {
    assertEquals(
      searchToolExposure({ query, authorized, state: createToolExposureState() }).matches.map((
        match,
      ) => match.name),
      ["get_integration"],
      `namespace-shaped query ${JSON.stringify(query)} must not resolve to a local tool`,
    );
  }
});

it("tool search resolves a namespace that itself contains an underscore", () => {
  // The grammar permits `_` inside a namespace segment, but candidate text has
  // underscores rewritten to spaces, so an un-normalized namespace never matches.
  assertEquals(
    searchToolExposure({
      query: "foo_bar__list_items",
      authorized: [
        definition("get_integration", "Tool ids and schemas. Namespaces: foo_bar, jira."),
        definition("list_items", "List items in this project"),
      ],
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["get_integration"],
  );
});

it("tool search matches a canonical namespace as a whole token", () => {
  // `exa` is a real integration name. Substring evidence would admit anything
  // whose text merely contains `example`, which is most of a catalog.
  assertEquals(
    searchToolExposure({
      query: "exa__search",
      authorized: [
        definition("get_integration", "Tool ids and schemas. Namespaces: exa, jira."),
        definition("run_sample", "Runs the example workflow", "an example value"),
      ],
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["get_integration"],
  );
});

it("tool search accepts canonical ids with the authorization layer's segment grammar", () => {
  // The authoritative grammar allows consecutive and trailing separators; search
  // must not be stricter, or it disagrees with authorization about what an id is.
  assertEquals(
    searchToolExposure({
      query: "github__list-issues-",
      authorized: integrationDiscoveryCatalog(),
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["get_integration"],
  );
});

it("tool search matches a full-coverage candidate in a single-tool catalog", () => {
  // With one candidate every term matches everything, so no term can clear the
  // selectivity floor. Full term coverage is its own evidence: there is no
  // competing candidate for the floor to protect against.
  assertEquals(
    searchToolExposure({
      query: "create project",
      authorized: [definition("create_file", "Create a project file")],
      state: createToolExposureState(),
    }).matches.map((match) => match.name),
    ["create_file"],
  );
});

it("tool search reports a miss when no candidate matches a selective term", () => {
  assertEquals(
    searchToolExposure({
      query: "list spreadsheet macros",
      authorized: integrationDiscoveryCatalog(),
      state: createToolExposureState(),
    }),
    { matches: [], resultCount: 0, loadedCount: 0, miss: true },
  );
});

it("tool search still resolves a bare platform tool id to its exact name match", () => {
  assertEquals(
    searchToolExposure({
      query: "list_projects",
      authorized: integrationDiscoveryCatalog(),
      state: createToolExposureState(),
    }).matches[0]?.name,
    "list_projects",
  );
});
