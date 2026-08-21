import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __subscribeLogRecordEmitter, type LogEntry } from "#veryfront/utils/logger/index.ts";
import type { WorkflowContext } from "./types.ts";
import { serializeWorkflowContext, serializeWorkflowJson } from "./context-serialization.ts";

const jsonRawSupport = JSON as typeof JSON & {
  rawJSON(source: string): unknown;
};

function contextWith(nodeOutput: unknown): WorkflowContext {
  return { input: {}, step: nodeOutput };
}

function captureWorkflowWarnings(callback: () => void): LogEntry[] {
  const warnings: LogEntry[] = [];
  const unsubscribe = __subscribeLogRecordEmitter((entry) => {
    if (entry.level === "warn" && entry.component === "workflow-context") {
      warnings.push(entry);
    }
  });
  try {
    callback();
  } finally {
    unsubscribe();
  }
  return warnings;
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

    it("inspects a fatal value returned by toJSON", () => {
      const error = assertThrows(() => serializeWorkflowContext(contextWith({ toJSON: () => 1n })));

      assertEquals((error as Error).message.includes("context.step"), true);
      assertEquals((error as Error).message.includes("BigInt"), true);
    });

    it("inspects a circular value returned by toJSON", () => {
      const replacement: Record<string, unknown> = {};
      replacement.self = replacement;

      const error = assertThrows(() =>
        serializeWorkflowContext(contextWith({ toJSON: () => replacement }))
      );

      assertEquals((error as Error).message.includes("context.step.self"), true);
      assertEquals((error as Error).message.includes("circular"), true);
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

  it("detects a cycle through a class instance's enumerable fields", () => {
    class Link {
      next: unknown = this;
    }

    const error = assertThrows(() => serializeWorkflowContext(contextWith(new Link())));

    assertEquals((error as Error).message.includes("context.step.next"), true);
    assertEquals((error as Error).message.includes("circular"), true);
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

  describe("diagnostic content", () => {
    it("redacts a property key that is not a plain identifier", () => {
      const error = assertThrows(() =>
        serializeWorkflowContext(contextWith({ "user@example.com": { total: 1n } }))
      );

      assertEquals((error as Error).message.includes("user@example.com"), false);
      assertEquals((error as Error).message.includes("<redacted>.total"), true);
    });

    it("keeps ordinary field names", () => {
      const error = assertThrows(() => serializeWorkflowContext(contextWith({ orderTotal: 1n })));

      assertEquals((error as Error).message.includes("context.step.orderTotal"), true);
    });

    it("does not trust a value-controlled type label", () => {
      class TaggedValue {
        [Symbol.toStringTag] = "user@example.com";
      }

      const warnings = captureWorkflowWarnings(() => {
        serializeWorkflowContext(contextWith(new TaggedValue()));
      });
      const paths = String(warnings[0]?.context?.paths);

      assertEquals(paths.includes("user@example.com"), false);
      assertEquals(paths.includes("object"), true);
    });
  });

  it("reports an array hole, which JSON fills in as null", () => {
    const sparse: string[] = [];
    sparse[2] = "third";

    const serialized = serializeWorkflowContext(contextWith({ rows: sparse }));

    assertEquals(JSON.parse(serialized).step.rows, [null, null, "third"]);
  });

  it("reports a hole filled by an inherited array value", () => {
    const values: string[] = [];
    values.length = 1;
    Object.setPrototypeOf(values, { 0: "inherited" });

    let serialized = "";
    const warnings = captureWorkflowWarnings(() => {
      serialized = serializeWorkflowContext(contextWith(values));
    });
    const paths = String(warnings[0]?.context?.paths);

    assertEquals(JSON.parse(serialized).step, ["inherited"]);
    assertEquals(paths.includes("array hole"), true);
  });

  it("invokes toJSON only once while inspecting its replacement", () => {
    let calls = 0;
    const serialized = serializeWorkflowContext(contextWith({
      toJSON: () => {
        calls++;
        return { ok: true };
      },
    }));

    assertEquals(calls, 1);
    assertEquals(JSON.parse(serialized).step, { ok: true });
  });

  it("reads an enumerable getter only once", () => {
    let reads = 0;
    const output = Object.defineProperty({}, "total", {
      enumerable: true,
      get: () => {
        reads++;
        return 7;
      },
    });

    const serialized = serializeWorkflowContext(contextWith(output));

    assertEquals(reads, 1);
    assertEquals(JSON.parse(serialized).step, { total: 7 });
  });

  it("does not trust a spoofed boxed-primitive tag", () => {
    const serialized = serializeWorkflowContext(contextWith({
      value: 7,
      [Symbol.toStringTag]: "Number",
    }));

    assertEquals(JSON.parse(serialized).step, { value: 7 });
  });

  it("keeps prototype diagnostics best-effort for proxies", () => {
    const output = new Proxy({ value: 7 }, {
      get: (target, key, receiver) => {
        if (key === Symbol.toStringTag || key === "constructor") {
          throw new Error("diagnostic metadata is unavailable");
        }
        return Reflect.get(target, key, receiver);
      },
      getPrototypeOf: () => {
        throw new Error("prototype metadata is unavailable");
      },
    });

    const serialized = serializeWorkflowContext(contextWith(output));

    assertEquals(JSON.parse(serialized).step, { value: 7 });
  });

  it("captures an array's length before reading its elements", () => {
    const values = [1, 2];
    Object.defineProperty(values, 0, {
      get: () => {
        values.push(3);
        return 1;
      },
    });

    const serialized = serializeWorkflowContext(contextWith(values));

    assertEquals(JSON.parse(serialized).step, [1, 2]);
  });

  it("reads an array proxy's length only once", () => {
    let lengthReads = 0;
    const values = new Proxy([1, 2], {
      get: (target, key, receiver) => {
        if (key === "length") lengthReads++;
        return Reflect.get(target, key, receiver);
      },
    });

    serializeWorkflowContext(contextWith(values));

    assertEquals(lengthReads, 1);
  });

  it("applies JSON ToLength semantics to an array proxy", () => {
    const values = new Proxy([1, 2], {
      get: (target, key, receiver) => {
        if (key === "length") return 1.5;
        return Reflect.get(target, key, receiver);
      },
    });

    const serialized = serializeWorkflowContext(contextWith(values));

    assertEquals(JSON.parse(serialized).step, [1]);
  });

  it("rejects a BigInt array length like native JSON", () => {
    const values = new Proxy([1], {
      get: (target, key, receiver) => {
        if (key === "length") return 1n;
        return Reflect.get(target, key, receiver);
      },
    });

    assertThrows(() => serializeWorkflowContext(contextWith(values)), TypeError);
  });

  it("preserves nested and root raw JSON values", () => {
    const nested = serializeWorkflowContext(contextWith(jsonRawSupport.rawJSON("123")));
    const root = serializeWorkflowJson(jsonRawSupport.rawJSON("456"), "output");

    assertEquals(JSON.parse(nested).step, 123);
    assertEquals(root, "456");
  });

  it("does not mistake a repeated value for a cycle", () => {
    // The same object appearing twice as siblings is perfectly serializable;
    // only an ancestor reappearing in its own subtree is a cycle.
    const shared = { id: 1 };

    const serialized = serializeWorkflowContext(contextWith({ a: shared, b: shared }));

    assertEquals(JSON.parse(serialized).step, { a: { id: 1 }, b: { id: 1 } });
  });
});
