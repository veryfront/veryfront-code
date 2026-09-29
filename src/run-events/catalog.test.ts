import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getRunEventCategory,
  getRunEventDefinition,
  getRunEventKind,
  isRunEventType,
  resolveRunEventType,
  RUN_EVENT_CATALOG,
  RUN_EVENT_CATEGORIES,
  RUN_EVENT_CATEGORY_HEADINGS,
  RUN_EVENT_GROUPS,
  RUN_EVENT_KINDS,
  RUN_EVENT_TYPE_ALIASES,
  RUN_EVENT_TYPES,
  type RunEventCategory,
  toRunEventWireName,
} from "./index.ts";

/**
 * The API's scope for each non-AG-UI type (`GET /runs/event-types`), pinned so
 * the filter category cannot drift from the layer that produces the event.
 * The AG-UI core types are every catalogued type not listed here except
 * `UNKNOWN`.
 */
const API_EXTENSION_TYPES = [
  "TOOL_CALL_STATUS_CHANGED",
  "INPUT_REQUEST_CREATED",
  "INPUT_REQUEST_UPDATED",
  "CHILD_RUN_STATUS_CHANGED",
  "MODEL_CALL_COMPLETED",
  "RUN_PARKED",
  "RUN_LOG_CAPTURED",
  "STREAM_HEARTBEAT_EMITTED",
  "URL_CITED",
  "DOCUMENT_CITED",
  "FILE_ATTACHED",
  "FILES_CHANGED",
  "RUNTIME_EVENT_RECORDED",
];

function expectedCategory(type: string): RunEventCategory {
  if (type === "UNKNOWN" || type.startsWith("AGENT_RUN_")) return "system";
  return API_EXTENSION_TYPES.includes(type) ? "extensions" : "ag-ui";
}

describe("run event catalog", () => {
  it("exposes complete, unique metadata through the public entrypoint", () => {
    assertEquals(RUN_EVENT_CATALOG.length, 57);
    assertEquals(new Set(RUN_EVENT_CATALOG.map((event) => event.type)).size, 57);
    assertEquals(
      RUN_EVENT_CATALOG.map((event) => event.type).sort(),
      [...RUN_EVENT_TYPES].sort(),
    );
    const groups = new Set(RUN_EVENT_GROUPS.map((group) => group.id));
    assertEquals(groups.size, 12);
    for (const event of RUN_EVENT_CATALOG) {
      assert(groups.has(event.group));
      assert(event.name.trim().length > 0);
      assertEquals(getRunEventDefinition(event.type), event);
      assert(Object.isFrozen(event));
    }
    assert(Object.isFrozen(RUN_EVENT_CATALOG));
    assert(Object.isFrozen(RUN_EVENT_GROUPS));
    for (const group of RUN_EVENT_GROUPS) {
      assert(Object.isFrozen(group));
      assert(RUN_EVENT_CATALOG.some((event) => event.group === group.id));
    }
  });

  it("uses the agreed group order and keeps output near reasoning", () => {
    assertEquals(RUN_EVENT_GROUPS.map((group) => group.name), [
      "Run",
      "Step",
      "Model call",
      "Reasoning",
      "Text",
      "Tool call",
      "Input request",
      "Artefacts",
      "State and activity",
      "Management",
      "Billing",
      "Diagnostics",
    ]);
    const positions = RUN_EVENT_CATALOG.map((event) =>
      RUN_EVENT_GROUPS.findIndex((group) => group.id === event.group)
    );
    assertEquals(positions, [...positions].sort((a, b) => a - b));
  });

  it("separates display names from existing wire names", () => {
    assertEquals(getRunEventDefinition("MODEL_CALL_COMPLETED"), {
      type: "MODEL_CALL_COMPLETED",
      name: "Model usage recorded",
      group: "model-call",
      category: "extensions",
      kind: "llm",
    });
    assertEquals(toRunEventWireName("MODEL_CALL_COMPLETED"), "ModelCallCompleted");
    assertEquals(getRunEventDefinition("AGENT_RUN_RUNTIME_OWNER_BOUND")?.group, "management");
    assertEquals(getRunEventDefinition("TOOL_CALL_START")?.name, "Tool call started");
    assertEquals(toRunEventWireName("TOOL_CALL_START"), "ToolCallStart");
  });

  it("leaves unknown future types to the caller without mislabeling them", () => {
    for (const type of ["FUTURE_EVENT", "toString", "__proto__", "constructor", ""]) {
      assertEquals(getRunEventDefinition(type), null);
    }
    assertEquals(getRunEventDefinition("UNKNOWN")?.name, "Unknown event");
  });

  it("gives every type a name, group, category and kind", () => {
    const groups = new Set<string>(RUN_EVENT_GROUPS.map((group) => group.id));
    const categories = new Set<string>(RUN_EVENT_CATEGORIES.map((category) => category.id));
    const kinds = new Set<string>(RUN_EVENT_KINDS.map((kind) => kind.id));
    for (const type of RUN_EVENT_TYPES) {
      const event = getRunEventDefinition(type);
      assert(event, `${type} has no definition`);
      assert(event.name.trim().length > 0, `${type} has no name`);
      assert(groups.has(event.group), `${type} has no group`);
      assert(categories.has(event.category), `${type} has no category`);
      assert(kinds.has(event.kind), `${type} has no kind`);
      assertEquals(getRunEventCategory(type), event.category);
      assertEquals(getRunEventKind(type), event.kind);
    }
  });

  it("files each type under the category of the layer that produces it", () => {
    for (const event of RUN_EVENT_CATALOG) {
      assertEquals(event.category, expectedCategory(event.type), event.type);
    }
    assertEquals(RUN_EVENT_CATALOG.filter((event) => event.category === "ag-ui").length, 24);
    assertEquals(RUN_EVENT_CATALOG.filter((event) => event.category === "extensions").length, 13);
    assertEquals(RUN_EVENT_CATALOG.filter((event) => event.category === "system").length, 20);
  });

  it("files model usage with extensions and the model kind, not as a system row", () => {
    assertEquals(getRunEventCategory("MODEL_CALL_COMPLETED"), "extensions");
    assertEquals(getRunEventKind("MODEL_CALL_COMPLETED"), "llm");
    assertEquals(getRunEventCategory("AGENT_RUN_MODEL_CALL_CONTEXT_RECORDED"), "system");
  });

  it("keeps the filter's category order, labels and headings", () => {
    assertEquals(RUN_EVENT_CATEGORIES.map(({ id, name }) => [id, name]), [
      ["ag-ui", "AG-UI"],
      ["extensions", "Extensions"],
      ["system", "System"],
    ]);
    assertEquals(RUN_EVENT_CATEGORY_HEADINGS.map(({ name, categories }) => [name, categories]), [
      ["Interactions", ["ag-ui", "extensions"]],
      ["System", ["system"]],
    ]);
    assertEquals(
      RUN_EVENT_CATEGORY_HEADINGS.flatMap((heading) => heading.categories),
      RUN_EVENT_CATEGORIES.map((category) => category.id),
    );
    assertEquals(RUN_EVENT_KINDS.map(({ id, name }) => [id, name]), [
      ["llm", "Model"],
      ["tool", "Tool"],
      ["child", "Child run"],
      ["lifecycle", "Lifecycle"],
      ["input", "Input"],
      ["output", "Output"],
      ["state", "State"],
      ["runtime", "Runtime"],
    ]);
    for (const list of [RUN_EVENT_CATEGORIES, RUN_EVENT_CATEGORY_HEADINGS, RUN_EVENT_KINDS]) {
      assert(Object.isFrozen(list));
      for (const entry of list) assert(Object.isFrozen(entry));
    }
  });

  it("reads a legacy spelling as its current type", () => {
    assertEquals(Object.keys(RUN_EVENT_TYPE_ALIASES).length, 12);
    assert(Object.isFrozen(RUN_EVENT_TYPE_ALIASES));
    for (const [alias, type] of Object.entries(RUN_EVENT_TYPE_ALIASES)) {
      assertEquals(isRunEventType(alias), false, `${alias} is also a current type`);
      assert(isRunEventType(type), `${alias} points at uncatalogued ${type}`);
      assertEquals(resolveRunEventType(alias), type);
      assertEquals(getRunEventDefinition(alias), getRunEventDefinition(type));
      assertEquals(getRunEventCategory(alias), "system");
    }
    assertEquals(getRunEventKind("AGENT_RUN_INVOKE_AGENT_BILLING_MODE_CHECKPOINT"), "child");
    assertEquals(
      getRunEventDefinition("AGENT_RUN_MODEL_CALL_CONTEXT")?.name,
      "Model call recorded",
    );
  });

  it("falls back to system and runtime for a type this build does not know", () => {
    for (const type of ["FUTURE_EVENT", "AGENT_RUN_FUTURE", "toString", "__proto__", ""]) {
      assertEquals(resolveRunEventType(type), null);
      assertEquals(getRunEventCategory(type), "system");
      assertEquals(getRunEventKind(type), "runtime");
    }
    for (const type of RUN_EVENT_TYPES) assertEquals(resolveRunEventType(type), type);
  });
});
