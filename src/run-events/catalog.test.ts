import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getRunEventDefinition,
  RUN_EVENT_CATALOG,
  RUN_EVENT_GROUPS,
  RUN_EVENT_TYPES,
  toRunEventWireName,
} from "./index.ts";

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
});
