import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { WorkflowContext } from "./types.ts";
import { serializeWorkflowContext, serializeWorkflowJson } from "./context-serialization.ts";

function contextWith(nodeOutput: unknown): WorkflowContext {
  return { input: {}, step: nodeOutput };
}

describe("serializeWorkflowContext", () => {
  it("serializes a JSON-representable context unchanged", () => {
    const context = contextWith({ name: "Max", tags: ["a"], count: 2, ok: true, none: null });

    assertEquals(JSON.parse(serializeWorkflowContext(context)), {
      input: {},
      step: { name: "Max", tags: ["a"], count: 2, ok: true, none: null },
    });
  });

  describe("values JSON cannot encode at all", () => {
    it("names the path to a BigInt instead of failing inside the backend", () => {
      // Previously surfaced as "Do not know how to serialize a BigInt" thrown
      // from the backend, with nothing pointing back at the step that wrote it.
      const error = assertThrows(() => serializeWorkflowContext(contextWith({ total: 1n })));

      assertEquals(error instanceof Error, true);
      assertEquals((error as Error).message.includes("context.step.total"), true);
      assertEquals((error as Error).message.includes("BigInt"), true);
    });

    it("names the path to a cycle rather than overflowing", () => {
      const cyclic: Record<string, unknown> = { name: "loop" };
      cyclic.self = cyclic;

      const error = assertThrows(() => serializeWorkflowContext(contextWith(cyclic)));

      assertEquals((error as Error).message.includes("context.step.self"), true);
      assertEquals((error as Error).message.includes("circular"), true);
    });

    it("reports a value nested deep inside the output", () => {
      const error = assertThrows(() =>
        serializeWorkflowContext(contextWith({ rows: [{ id: 9n }] }))
      );

      assertEquals((error as Error).message.includes("context.step.rows[0].id"), true);
    });
  });

  describe("values JSON encodes lossily", () => {
    // These stay allowed: rejecting them would break workflows relying on the
    // current coercion. They are serialized, and reported, not thrown on.
    it("keeps serializing a Date, which comes back as a string", () => {
      const serialized = serializeWorkflowContext(contextWith({ when: new Date(0) }));

      assertEquals(JSON.parse(serialized).step.when, "1970-01-01T00:00:00.000Z");
    });

    it("keeps serializing a Map, which comes back empty", () => {
      const serialized = serializeWorkflowContext(contextWith({ tags: new Map([["a", 1]]) }));

      assertEquals(JSON.parse(serialized).step.tags, {});
    });

    it("keeps serializing an undefined field, whose key disappears", () => {
      const serialized = serializeWorkflowContext(contextWith({ missing: undefined, kept: 1 }));

      assertEquals(JSON.parse(serialized).step, { kept: 1 });
    });

    it("keeps serializing a non-finite number, which comes back null", () => {
      const serialized = serializeWorkflowContext(contextWith({ ratio: Number.NaN }));

      assertEquals(JSON.parse(serialized).step.ratio, null);
    });
  });

  it("keeps traversing a class instance's enumerable fields", () => {
    // The instance itself is only lossy -- it serializes as its own fields --
    // but JSON still encodes those fields, so a BigInt inside one is exactly
    // as fatal as it would be in a plain object. Recording the instance and
    // stopping would hand back the native error after promising a path.
    class Receipt {
      total = 5n;
    }

    const error = assertThrows(() => serializeWorkflowContext(contextWith(new Receipt())));

    assertEquals((error as Error).message.includes("context.step.total"), true);
    assertEquals((error as Error).message.includes("BigInt"), true);
  });

  it("names the field a value was found in, not only its path", () => {
    // The same step output reaches `context`, `nodeStates`, `output`, and
    // checkpoints. Whichever is encoded first decides the error, so each one
    // has to say which field it came from.
    const error = assertThrows(() =>
      serializeWorkflowJson({ step: { output: { total: 1n } } }, "nodeStates")
    );

    assertEquals((error as Error).message.includes("nodeStates.step.output.total"), true);
  });

  it("does not mistake a repeated value for a cycle", () => {
    // The same object appearing twice as siblings is perfectly serializable;
    // only an ancestor reappearing in its own subtree is a cycle.
    const shared = { id: 1 };

    const serialized = serializeWorkflowContext(contextWith({ a: shared, b: shared }));

    assertEquals(JSON.parse(serialized).step, { a: { id: 1 }, b: { id: 1 } });
  });
});
