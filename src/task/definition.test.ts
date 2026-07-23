import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeTaskDefinition, snapshotTaskJsonObject } from "./definition.ts";

describe("src/task/definition", () => {
  it("detaches and freezes supported definition metadata", () => {
    const inputSchema = {
      type: "object",
      values: [null, true, 42, { label: "original" }],
    };
    const definition = {
      name: "Example task",
      description: "Runs an example.\nReturns a result.",
      inputSchema,
      outputSchema: { type: "object" },
      schedulable: false,
      run() {
        return this.name;
      },
    };

    const normalized = normalizeTaskDefinition(definition);
    (inputSchema.values[3] as { label: string }).label = "changed";
    definition.name = "Changed after normalization";

    assertEquals(normalized.name, "Example task");
    assertEquals(normalized.schedulable, false);
    assertEquals(normalized.inputSchema?.values, [null, true, 42, { label: "original" }]);
    assertEquals(Object.isFrozen(normalized), true);
    assertEquals(Object.isFrozen(normalized.inputSchema), true);
    assertEquals(Object.isFrozen(normalized.inputSchema?.values), true);
    assertEquals(normalized.run({ env: {}, config: {} }), "Example task");
  });

  it("rejects non-JSON structures without invoking accessors", () => {
    let reads = 0;
    const accessorBacked = {};
    Object.defineProperty(accessorBacked, "value", {
      enumerable: true,
      get() {
        reads += 1;
        return "secret";
      },
    });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const decorated = ["value"];
    Object.defineProperty(decorated, "extra", {
      enumerable: true,
      get() {
        reads += 1;
        return "secret";
      },
    });
    const sparse = new Array(1);

    for (
      const value of [
        { value: Number.NaN },
        { value: undefined },
        { value: () => null },
        { value: new Date() },
        accessorBacked,
        cyclic,
        { value: decorated },
        { value: sparse },
      ]
    ) {
      assertThrows(
        () => snapshotTaskJsonObject(value, "Test value"),
        VeryfrontError,
      );
    }
    assertEquals(reads, 0);
  });

  it("enforces schema depth, node, and text budgets", () => {
    let nested: Record<string, unknown> = {};
    for (let depth = 0; depth < 66; depth++) nested = { nested };

    for (
      const value of [
        nested,
        { values: new Array(10_000).fill(null) },
        { value: "x".repeat(1_048_577) },
      ]
    ) {
      assertThrows(
        () => snapshotTaskJsonObject(value, "Test value"),
        VeryfrontError,
      );
    }
  });

  it("rejects accessor-backed and excessively deep definition prototypes", () => {
    let reads = 0;
    const accessorBacked = {};
    Object.defineProperty(accessorBacked, "run", {
      get() {
        reads += 1;
        return () => null;
      },
    });
    assertThrows(() => normalizeTaskDefinition(accessorBacked), VeryfrontError);

    let prototype: object | null = null;
    for (let depth = 0; depth < 18; depth++) prototype = Object.create(prototype);
    const definition = Object.create(prototype);
    assertThrows(() => normalizeTaskDefinition(definition), VeryfrontError);
    assertEquals(reads, 0);
  });

  it("creates a mutable private config snapshot when requested", () => {
    const source = { nested: { value: "source" } };
    const snapshot = snapshotTaskJsonObject(source, "Task config", false);
    (snapshot.nested as { value: string }).value = "task";

    assertEquals(snapshot, { nested: { value: "task" } });
    assertEquals(source, { nested: { value: "source" } });
    assertEquals(Object.isFrozen(snapshot), false);
  });
});
