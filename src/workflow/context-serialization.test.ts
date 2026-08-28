import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors";
import {
  assertEquals,
  assertInstanceOf,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetLoggerConfigForTests,
  __subscribeLogRecordEmitter,
  type LogEntry,
  LogLevel,
  setLogLevel,
} from "#veryfront/utils/logger/logger.ts";
import type { WorkflowContext } from "./types.ts";
import {
  MAX_TRAVERSAL_DEPTH,
  prepareWorkflowJson,
  serializeWorkflowContext,
  serializeWorkflowJson,
} from "./context-serialization.ts";

// Deep enough that the walk stops and hands the value to `JSON.stringify`, and
// no deeper. `JSON.stringify` is itself stack bound, and how deep it reaches
// varies by engine and by the stack a test runner leaves it, so a fixed large
// depth tests the host rather than this module. Deriving it from the constant
// also keeps these tests from going quiet if the limit is ever raised.
const PAST_THE_WALK = MAX_TRAVERSAL_DEPTH + 25;

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
      assertEquals((error as Error).message.includes("context.step.<redacted>"), true);
      assertEquals((error as Error).message.includes("BigInt"), true);
    });

    it("names the path to a cycle rather than overflowing", () => {
      const cyclic: Record<string, unknown> = { name: "loop" };
      cyclic.self = cyclic;

      const error = assertThrows(() => serializeWorkflowContext(contextWith(cyclic)));

      assertEquals((error as Error).message.includes("context.step.<redacted>"), true);
      assertEquals((error as Error).message.includes("circular"), true);
    });

    it("reports a value nested deep inside the output", () => {
      const error = assertThrows(() =>
        serializeWorkflowContext(contextWith({ rows: [{ id: 9n }] }))
      );

      assertEquals(
        (error as Error).message.includes("context.step.<redacted>[0].<redacted>"),
        true,
      );
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

      assertEquals((error as Error).message.includes("context.step.<redacted>"), true);
      assertEquals((error as Error).message.includes("circular"), true);
    });

    it("stops before a later getter can replace a recorded fatal error", () => {
      let laterReads = 0;
      const step = Object.defineProperty({ first: 1n }, "second", {
        enumerable: true,
        get() {
          laterReads++;
          throw new Error("later getter must not replace the persistence error");
        },
      });

      const error = assertThrows(
        () => serializeWorkflowContext(contextWith(step)),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "BigInt");
      assertEquals(laterReads, 0);
    });
  });

  describe("values JSON encodes lossily", () => {
    // These stay allowed: rejecting them would break workflows relying on the
    // current coercion. They are serialized, and reported, not thrown on.
    it("keeps serializing a Date, which comes back as a string", () => {
      let serialized = "";
      const warnings = captureWorkflowWarnings(() => {
        serialized = serializeWorkflowContext(contextWith({ when: new Date(0) }));
      });
      const paths = String(warnings[0]?.context?.paths);

      assertEquals(JSON.parse(serialized).step.when, "1970-01-01T00:00:00.000Z");
      assertEquals(
        paths.includes("context.step.<redacted> (Date)"),
        true,
        "a Date silently persisted as a string must be named in the lossy warning",
      );
    });

    it("keeps serializing a Map, which comes back empty", () => {
      let serialized = "";
      const warnings = captureWorkflowWarnings(() => {
        serialized = serializeWorkflowContext(contextWith({ tags: new Map([["a", 1]]) }));
      });
      const paths = String(warnings[0]?.context?.paths);

      assertEquals(JSON.parse(serialized).step.tags, {});
      assertEquals(
        paths.includes("context.step.<redacted> (object)"),
        true,
        "a Map silently persisted as an empty object must be named in the lossy warning",
      );
    });

    it("keeps serializing an undefined field, whose key disappears", () => {
      const serialized = serializeWorkflowContext(contextWith({ missing: undefined, kept: 1 }));

      assertEquals(JSON.parse(serialized).step, { kept: 1 });
    });

    it("keeps serializing a non-finite number, which comes back null", () => {
      const serialized = serializeWorkflowContext(contextWith({ ratio: Number.NaN }));

      assertEquals(JSON.parse(serialized).step.ratio, null);
    });

    it("throws on lossy values when strictContext is enabled", () => {
      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({
              when: new Date(0),
              tags: new Map([["a", 1]]),
              missing: undefined,
              ratio: Number.NaN,
            }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "Date");
      assertStringIncludes(error.message, "object");
      assertStringIncludes(error.message, "undefined");
      assertStringIncludes(error.message, "number (NaN)");
    });

    it("throws when strictContext would persist negative zero or symbol-keyed fields lossy", () => {
      const symbolKey = Symbol("not-persisted");
      const symbolKeyedOutput: Record<PropertyKey, unknown> = {};
      symbolKeyedOutput[symbolKey] = "lost";

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({
              credit: -0,
              symbolKeyedOutput,
            }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "number (-0)");
      assertStringIncludes(error.message, "symbol-keyed property");
    });

    it("throws when strictContext would drop a non-enumerable symbol property", () => {
      const value = {};
      Object.defineProperty(value, Symbol("not-persisted"), {
        value: "lost",
      });

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ value }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "symbol-keyed property");
    });

    it("throws when strictContext would restore a non-extensible value as extensible", () => {
      for (
        const value of [
          Object.preventExtensions({}),
          Object.seal({}),
          Object.freeze({}),
          Object.preventExtensions([]),
        ]
      ) {
        const error = assertThrows(
          () =>
            serializeWorkflowContext(
              contextWith({ value }),
              "run-strict-context",
              { strictContext: true },
            ),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertStringIncludes(error.message, "strictContext");
        assertStringIncludes(error.message, "context.step.<redacted>");
        assertStringIncludes(error.message, "object extensibility");
      }
    });

    it("throws when strictContext would drop enumerable named array properties", () => {
      const rows: unknown[] = [{ id: 1 }];
      Object.defineProperty(rows, "meta", {
        value: "required",
        enumerable: true,
      });

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ rows }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>.<redacted>");
      assertStringIncludes(error.message, "array property");
    });

    it("throws when strictContext would drop hidden named array properties", () => {
      const rows = [1, 2];
      Object.defineProperty(rows, "metadata", {
        value: "required",
      });

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ rows }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>.<redacted>");
      assertStringIncludes(error.message, "non-enumerable property");
    });

    it("throws when strictContext would persist a raw JSON wrapper as its parsed value", () => {
      if (typeof jsonRawSupport.rawJSON !== "function") return;

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ value: jsonRawSupport.rawJSON("123") }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "raw JSON value");
    });

    it("throws for a Proxy in strictContext before invoking proxy traps", () => {
      let trapCalls = 0;
      const proxy = new Proxy({}, {
        get() {
          trapCalls++;
          throw new Error("proxy get trap must not run");
        },
        getOwnPropertyDescriptor() {
          trapCalls++;
          throw new Error("proxy descriptor trap must not run");
        },
        getPrototypeOf() {
          trapCalls++;
          throw new Error("proxy prototype trap must not run");
        },
        ownKeys() {
          trapCalls++;
          throw new Error("proxy ownKeys trap must not run");
        },
      });

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ proxy }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "object");
      assertEquals(trapCalls, 0);
    });

    it("throws when strictContext would duplicate a shared object reference", () => {
      const shared = { value: 1 };

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ left: shared, right: shared }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "shared reference");
    });

    it("throws when strictContext would persist an array subclass as a plain array", () => {
      class Rows extends Array<number> {
        total(): number {
          return this.length;
        }
      }

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ rows: new Rows(1, 2) }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "array prototype");
    });

    it("throws when strictContext would persist an accessor as a data property", () => {
      let getterReads = 0;
      const step: { readonly count?: number } = {};
      Object.defineProperty(step, "count", {
        enumerable: true,
        get() {
          getterReads++;
          return 1;
        },
      });

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith(step),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "accessor property");
      assertEquals(getterReads, 1);
    });

    it("throws when strictContext would relax data property attributes", () => {
      const readonlyObject = {};
      Object.defineProperty(readonlyObject, "required", {
        value: 1,
        enumerable: true,
        configurable: true,
      });
      const fixedObject = {};
      Object.defineProperty(fixedObject, "required", {
        value: 1,
        enumerable: true,
        writable: true,
      });
      const readonlyIndex = [1];
      Object.defineProperty(readonlyIndex, "0", {
        value: 1,
        enumerable: true,
        configurable: true,
        writable: false,
      });
      const fixedIndex = [1];
      Object.defineProperty(fixedIndex, "0", {
        value: 1,
        enumerable: true,
        configurable: false,
        writable: true,
      });
      const hiddenIndex = [1];
      Object.defineProperty(hiddenIndex, "0", {
        value: 1,
        enumerable: false,
        configurable: true,
        writable: true,
      });

      for (
        const value of [readonlyObject, fixedObject, readonlyIndex, fixedIndex, hiddenIndex]
      ) {
        const error = assertThrows(
          () =>
            serializeWorkflowContext(
              contextWith({ value }),
              "run-strict-context",
              { strictContext: true },
            ),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertStringIncludes(error.message, "property attributes");
      }
    });

    it("throws when strictContext would restore a writable array length", () => {
      const rows = [1, 2];
      Object.defineProperty(rows, "length", { writable: false });

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ rows }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "array length property");
    });

    it("throws when a built-in hides behind Object.prototype in strictContext", () => {
      const disguisedDate = new Date(0);
      Object.setPrototypeOf(disguisedDate, Object.prototype);

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ disguisedDate }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "object");
    });

    it("throws when host-recognized builtins hide behind Object.prototype", () => {
      for (
        const value of [
          new WeakMap(),
          new WeakSet(),
          new WeakRef({}),
          new FinalizationRegistry(() => {}),
          new URL("https://example.com"),
          Promise.resolve(),
          Object(Symbol("hidden")),
          Object(1n),
        ]
      ) {
        Object.setPrototypeOf(value, Object.prototype);

        const error = assertThrows(
          () =>
            serializeWorkflowContext(
              contextWith({ value }),
              "run-strict-context",
              { strictContext: true },
            ),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertStringIncludes(error.message, "strictContext");
      }
    });

    it("throws when host-recognized builtins hide behind Object.prototype with own data", () => {
      for (
        const value of [
          new WeakRef({}),
          new FinalizationRegistry(() => {}),
          new URL("https://example.com"),
        ]
      ) {
        Object.setPrototypeOf(value, Object.prototype);
        Object.defineProperty(value, "metadata", {
          configurable: true,
          enumerable: true,
          value: "ordinary data",
          writable: true,
        });

        const error = assertThrows(
          () =>
            serializeWorkflowContext(
              contextWith({ value }),
              "run-strict-context",
              { strictContext: true },
            ),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertStringIncludes(error.message, "strictContext");
      }
    });

    it("does not probe intrinsic slot getters for ordinary strict objects", async () => {
      const originalGetTime = Date.prototype.getTime;
      let probeCalls = 0;
      Date.prototype.getTime = function (this: Date): number {
        probeCalls++;
        return Reflect.apply(originalGetTime, this, []);
      };

      try {
        const isolated = await import(
          "./context-serialization.ts?non-throwing-native-brand-checks"
        );
        isolated.serializeWorkflowContext(
          contextWith({ value: { nested: true } }),
          "run-strict-context",
          { strictContext: true },
        );
      } finally {
        Date.prototype.getTime = originalGetTime;
      }

      assertEquals(probeCalls, 0);
    });

    it("throws when strictContext would drop a non-enumerable property", () => {
      const step = {};
      Object.defineProperty(step, "required", {
        value: 1,
      });

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith(step),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>");
      assertStringIncludes(error.message, "non-enumerable property");
    });

    it("throws when strictContext would persist a null-prototype object as plain", () => {
      const step = Object.create(null) as Record<string, unknown>;
      step.value = 1;

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith(step),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step");
      assertStringIncludes(error.message, "context.step (object)");
    });

    it("throws when strictContext would persist an array accessor as a data element", () => {
      let getterReads = 0;
      const rows: number[] = [];
      Object.defineProperty(rows, "0", {
        configurable: true,
        enumerable: true,
        get() {
          getterReads++;
          Object.defineProperty(rows, "0", {
            enumerable: true,
            value: 1,
          });
          return 1;
        },
      });

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith({ rows }),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step.<redacted>[0]");
      assertStringIncludes(error.message, "accessor property");
      assertEquals(getterReads, 1);
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

    assertEquals((error as Error).message.includes("context.step.<redacted>"), true);
    assertEquals((error as Error).message.includes("BigInt"), true);
  });

  it("detects a cycle through a class instance's enumerable fields", () => {
    class Link {
      next: unknown = this;
    }

    const error = assertThrows(() => serializeWorkflowContext(contextWith(new Link())));

    assertEquals((error as Error).message.includes("context.step.<redacted>"), true);
    assertEquals((error as Error).message.includes("circular"), true);
  });

  it("names the field a value was found in, not only its path", () => {
    // The same step output reaches `context`, `nodeStates`, `output`, and
    // checkpoints. Whichever is encoded first decides the error, so each one
    // has to say which field it came from.
    const error = assertThrows(() =>
      serializeWorkflowJson({ step: { output: { total: 1n } } }, "nodeStates")
    );

    assertEquals(
      (error as Error).message.includes("nodeStates.step.<redacted>.<redacted>"),
      true,
    );
  });

  describe("diagnostic content", () => {
    it("redacts a property key that is not a plain identifier", () => {
      const error = assertThrows(() =>
        serializeWorkflowContext(contextWith({ "user@example.com": { total: 1n } }))
      );

      assertEquals((error as Error).message.includes("user@example.com"), false);
      assertEquals(
        (error as Error).message.includes("context.step.<redacted>.<redacted>"),
        true,
      );
    });

    it("redacts identifier-shaped runtime keys", () => {
      const error = assertThrows(() => serializeWorkflowContext(contextWith({ acct_ABC123: 1n })));

      assertEquals((error as Error).message.includes("acct_ABC123"), false);
      assertEquals((error as Error).message.includes("context.step.<redacted>"), true);
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

  it("converts a boxed primitive the way JSON converts it, through the object", () => {
    // JSON puts a Number box through ToNumber, which asks the object, so a
    // replaced prototype leaves it with no `valueOf` to reach and JSON writes
    // null. Reading the slot instead would persist a 7 JSON never wrote.
    const boxed = Object.setPrototypeOf(new Number(7), Object.prototype);

    const serialized = serializeWorkflowContext(contextWith({ total: boxed }));

    assertEquals(JSON.parse(serialized).step, JSON.parse(JSON.stringify({ total: boxed })));
    assertEquals(JSON.parse(serialized).step.total, null);
  });

  it("refuses a boxed Number whose valueOf returns a BigInt, as JSON does", () => {
    // `Number()` accepts a BigInt that JSON's `ToNumber` refuses, so converting
    // with it would quietly coerce this to 2 and persist a number JSON would
    // have thrown on. The conversion has to be the operation JSON performs, not
    // one that merely looks like it.
    const boxed = Object.assign(new Number(1), { valueOf: () => 2n });

    assertThrows(() => serializeWorkflowContext(contextWith({ total: boxed })), TypeError);
  });

  it("does not probe primitive slots on an ordinary object", () => {
    // Each probe throws on a miss and a context is mostly objects that miss
    // every one, so probing all of them spent several thrown exceptions per
    // object on the path every persisted run takes.
    const originalValueOf = Number.prototype.valueOf;
    let probes = 0;
    Number.prototype.valueOf = function (this: number) {
      probes++;
      return originalValueOf.call(this);
    };

    try {
      serializeWorkflowContext(contextWith({ rows: [{ id: 1 }, { id: 2 }] }));
    } finally {
      Number.prototype.valueOf = originalValueOf;
    }

    assertEquals(probes, 0);
  });

  it("does not trust a spoofed boxed-primitive tag", () => {
    const serialized = serializeWorkflowContext(contextWith({
      value: 7,
      [Symbol.toStringTag]: "Number",
    }));

    assertEquals(JSON.parse(serialized).step, { value: 7 });
  });

  it("keeps prototype diagnostics best-effort for proxies", () => {
    let prototypeTrapCalls = 0;
    const output = new Proxy({ value: 7 }, {
      get: (target, key, receiver) => {
        if (key === Symbol.toStringTag || key === "constructor") {
          throw new Error("diagnostic metadata is unavailable");
        }
        return Reflect.get(target, key, receiver);
      },
      getPrototypeOf: () => {
        prototypeTrapCalls++;
        throw new Error("prototype metadata is unavailable");
      },
    });

    const serialized = serializeWorkflowContext(contextWith(output));

    assertEquals(JSON.parse(serialized).step, { value: 7 });
    assertEquals(prototypeTrapCalls, 0);
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

  it("does not enumerate dense array keys during default persistence diagnostics", () => {
    let ownKeysCalls = 0;
    const values = new Proxy([1, 2, 3], {
      ownKeys(target) {
        ownKeysCalls++;
        return Reflect.ownKeys(target);
      },
    });

    const serialized = serializeWorkflowContext(contextWith({ values }));

    assertEquals(JSON.parse(serialized).step.values, [1, 2, 3]);
    assertEquals(ownKeysCalls, 0);
  });

  it("does not run named-array diagnostics during default persistence", () => {
    const values = [1, 2, 3];
    Object.defineProperty(values, "meta", {
      value: "diagnostic-only",
      enumerable: true,
    });

    let serialized = "";
    const warnings = captureWorkflowWarnings(() => {
      serialized = serializeWorkflowContext(contextWith({ values }));
    });

    assertEquals(JSON.parse(serialized).step.values, [1, 2, 3]);
    assertEquals(warnings, []);
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

  it("rejects root values that do not produce a JSON document", () => {
    for (const value of [undefined, () => 1, Symbol("root")]) {
      const error = assertThrows(
        () => serializeWorkflowJson(value, "output"),
        VeryfrontError,
      );
      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "output");
      assertStringIncludes(error.message, "cannot be persisted");
    }
  });

  describe("values larger than a diagnostic can describe", () => {
    it("hands a value deeper than the walk follows back to JSON.stringify", () => {
      // The walk recurses far more heavily than `JSON.stringify`, so past a few
      // thousand levels it died with `Maximum call stack size exceeded` raised
      // from inside the backend, on a value that persisted fine before this
      // check existed. That is the error class the check exists to replace.
      //
      // The `Date` at the bottom is what proves the walk actually stopped: it
      // is a lossy value, so a walk that reached it would report it. Asserting
      // the stack overflow itself would test the host, since how deep the walk
      // and `JSON.stringify` each reach depends on the engine and the stack a
      // test runner leaves them.
      let deep: unknown = {
        when: new Date(0),
        exactNumber: jsonRawSupport.rawJSON("1e+2"),
      };
      for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

      let serialized = "";
      const warnings = captureWorkflowWarnings(() => {
        serialized = serializeWorkflowContext(contextWith(deep));
      });

      assertEquals(warnings, []);
      assertEquals(serialized, JSON.stringify({ input: {}, step: deep }));
    });

    it("parses a deep JSON tail without a recursive reviver when no raw token exists", () => {
      const depth = 4000;
      let value: unknown = 0;
      for (let index = 0; index < depth; index++) value = { nested: value };
      const expected = `${'{"nested":'.repeat(depth)}0${"}".repeat(depth)}`;
      const prepared = prepareWorkflowJson(value, "output");

      assertEquals(prepared.serialized, expected);
      let restored = prepared.normalized;
      for (let index = 0; index < depth; index++) {
        restored = (restored as { nested: unknown }).nested;
      }
      assertEquals(restored, 0);
    });

    it("encodes a deep accessor tail without native recursion", () => {
      const depth = PAST_THE_WALK + 8_000;
      let getterCalls = 0;
      const leaf = {} as { value: string };
      Object.defineProperty(leaf, "value", {
        configurable: true,
        enumerable: true,
        get() {
          getterCalls++;
          return "stored";
        },
      });
      let value: unknown = leaf;
      for (let index = 0; index < depth; index++) value = { nested: value };

      const prepared = prepareWorkflowJson(value, "output");
      let restored = prepared.normalized;
      for (let index = 0; index < depth; index++) {
        restored = (restored as { nested: unknown }).nested;
      }

      assertEquals(restored, { value: "stored" });
      assertEquals(getterCalls, 1);
      assertEquals(prepared.serialized.endsWith('{"value":"stored"}' + "}".repeat(depth)), true);
    });

    it("keeps control strings and JSON edge primitives in an encoded tail", () => {
      const marker = "\u0000workflow-tail";
      const leaf = Object.create(null) as Record<string, unknown>;
      leaf.marker = marker;
      leaf.values = [undefined, Symbol("omitted"), -0, Number.NaN, true];
      Object.defineProperty(leaf, "__proto__", {
        configurable: true,
        enumerable: true,
        value: null,
        writable: true,
      });
      let deep: unknown = leaf;
      for (let index = 0; index < PAST_THE_WALK; index++) deep = { nested: deep };
      const value = {
        [marker]: "outer key",
        deep,
        exactNumber: jsonRawSupport.rawJSON("1e+2"),
      };

      const expected = JSON.stringify(value);
      const prepared = prepareWorkflowJson(value, "output");

      assertEquals(prepared.serialized, expected);
      assertEquals(JSON.stringify(prepared.normalized), expected);
    });

    it("throws in strictContext before persisting uninspected deep values", () => {
      let deep: unknown = { when: new Date(0) };
      for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith(deep),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "context.step");
      assertStringIncludes(error.message, "uninspected value");
    });

    it("throws the strictContext diagnostic before JSON sees a fatal value below the cutoff", () => {
      let deep: unknown = { total: 1n };
      for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

      const error = assertThrows(
        () =>
          serializeWorkflowContext(
            contextWith(deep),
            "run-strict-context",
            { strictContext: true },
          ),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "strictContext");
      assertStringIncludes(error.message, "uninspected value");
    });

    it("translates fatal JSON errors below the cutoff to redacted persistence errors", () => {
      const sensitiveKey = "user@example.com";
      const cyclic: Record<string, unknown> = {};
      cyclic[sensitiveKey] = cyclic;

      for (const tail of [{ [sensitiveKey]: 1n }, { boxed: Object(1n) }, cyclic]) {
        let deep: unknown = tail;
        for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

        const error = assertThrows(
          () => serializeWorkflowContext(contextWith(deep)),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertStringIncludes(error.message, "cannot be persisted");
        assertStringIncludes(error.message, "context.step");
        assertEquals(error.message.includes(sensitiveKey), false);
      }
    });

    it("preserves user TypeErrors thrown below the cutoff", () => {
      const toJsonError = new TypeError("user toJSON failure");
      const getterError = new TypeError("user getter failure");
      const getterTail = Object.defineProperty({}, "value", {
        enumerable: true,
        get() {
          throw getterError;
        },
      });

      for (
        const [tail, expected] of [
          [{
            toJSON: () => {
              throw toJsonError;
            },
          }, toJsonError],
          [getterTail, getterError],
        ] as const
      ) {
        let deep: unknown = tail;
        for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

        const error = assertThrows(() => serializeWorkflowContext(contextWith(deep)));

        assertStrictEquals(error, expected);
      }
    });

    it("keeps shared references below the cutoff distinct from cycles", () => {
      const shared = { value: 1 };
      let deep: unknown = { left: shared, right: shared };
      for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

      const context = contextWith(deep);

      assertEquals(serializeWorkflowContext(context), JSON.stringify(context));
    });

    it("still names a fatal value found above the depth it stops at", () => {
      // What the walk found on the way down still holds. What sits below the
      // depth it follows does not get named, which is why the deep BigInt is
      // absent from the message while the shallow one is not.
      let deep: unknown = 2n;
      for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

      const error = assertThrows(() =>
        serializeWorkflowContext(contextWith({ shallow: 1n, deep }))
      );

      assertEquals((error as Error).message.includes("context.step.<redacted>"), true);
      assertEquals((error as Error).message.includes(".n.n"), false);
    });

    it("reads a hook above the depth cutoff exactly once", () => {
      // Handing the whole root back to `JSON.stringify` would re-run every
      // getter and `toJSON` the walk had already run on the way down, and a
      // hook that answers differently the second time would then persist a
      // value this check never saw. Only the subtree at the cutoff is handed
      // to JSON, so nothing above it is read twice.
      let reads = 0;
      let deep: unknown = { leaf: 1 };
      for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };
      // The getter is keyed before the deep value on purpose. Keyed after it,
      // the walk would stop before ever reaching the getter and read it once
      // even when restarting from the root, so the test would prove nothing.
      const output: Record<string, unknown> = {};
      Object.defineProperty(output, "counted", {
        enumerable: true,
        get: () => {
          reads++;
          return reads;
        },
      });
      output.deep = deep;

      const serialized = serializeWorkflowContext(contextWith(output));

      assertEquals(reads, 1);
      assertEquals(JSON.parse(serialized).step.counted, 1);
    });

    it("runs hooks below the cutoff before reading later siblings", () => {
      const makeContext = (): WorkflowContext => {
        const later = { observed: 0 };
        let deep: unknown = {
          toJSON() {
            later.observed = 1;
            return { leaf: true };
          },
        };
        for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };
        return contextWith({ deep, later });
      };

      const serialized = serializeWorkflowContext(makeContext());
      const native = JSON.stringify(makeContext());

      assertEquals(serialized, native);
      assertEquals(JSON.parse(serialized).step.later.observed, 1);
    });

    it("uses inherited function toJSON hooks through the complete prototype chain below the cutoff", () => {
      const functionPrototype = Object.getPrototypeOf(function hookCarrier() {});
      const inheritedToJson = {
        toJSON() {
          return { fromHook: true };
        },
      };
      const intermediatePrototype = Object.create(inheritedToJson);
      function hookCarrier() {}
      Object.setPrototypeOf(hookCarrier, intermediatePrototype);
      let deep: unknown = { hookCarrier };
      for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

      try {
        const serialized = serializeWorkflowContext(contextWith(deep));
        let parsed = JSON.parse(serialized).step;
        for (let index = 0; index < PAST_THE_WALK; index++) parsed = parsed.n;

        assertEquals(parsed, { hookCarrier: { fromHook: true } });
      } finally {
        Object.setPrototypeOf(hookCarrier, functionPrototype);
      }
    });

    it("reports BigInt returned by an inherited function toJSON below the cutoff", () => {
      const functionPrototype = Object.getPrototypeOf(function hookCarrier() {});
      const inheritedToJson = {
        toJSON() {
          return 1n;
        },
      };
      const intermediatePrototype = Object.create(inheritedToJson);
      function hookCarrier() {}
      Object.setPrototypeOf(hookCarrier, intermediatePrototype);
      let deep: unknown = { hookCarrier };
      for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

      try {
        const error = assertThrows(
          () => serializeWorkflowContext(contextWith(deep)),
          VeryfrontError,
        );

        assertInstanceOf(error, VeryfrontError);
        assertStringIncludes(error.message, "cannot be persisted");
        assertStringIncludes(error.message, "BigInt");
      } finally {
        Object.setPrototypeOf(hookCarrier, functionPrototype);
      }
    });

    it("keeps deep completed aliases on the iterative encoder", () => {
      const shared = { value: 1 };
      let deep: unknown = { left: shared, right: shared };
      for (let index = 0; index < PAST_THE_WALK + 8000; index++) deep = { n: deep };

      const prepared = prepareWorkflowJson(deep, "output");

      assertEquals(prepared.serialized?.includes('"left":{"value":1},"right":{"value":1}'), true);
    });

    it("does not reapply toJSON on a cutoff replacement value", () => {
      let leafToJsonCalls = 0;
      let replacementToJsonCalls = 0;
      let replacementGetterCalls = 0;
      const replacement = {
        value: 1,
        toJSON() {
          replacementToJsonCalls++;
          return { value: 2 };
        },
      };
      Object.defineProperty(replacement, "dynamic", {
        enumerable: true,
        get() {
          replacementGetterCalls++;
          return 3;
        },
      });
      let deep: unknown = {
        toJSON() {
          leafToJsonCalls++;
          return replacement;
        },
      };
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH - 1; index++) {
        deep = { n: deep };
      }

      const serialized = serializeWorkflowContext(contextWith(deep));
      let parsed = JSON.parse(serialized).step;
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH - 1; index++) {
        parsed = parsed.n;
      }

      assertEquals(leafToJsonCalls, 1);
      assertEquals(replacementToJsonCalls, 0);
      assertEquals(replacementGetterCalls, 1);
      assertEquals(parsed, { value: 1, dynamic: 3 });
    });

    it("snapshots an inert deep tail before a later sibling mutates it", () => {
      const makeContext = (): WorkflowContext => {
        const leaf = { value: 1 };
        let deep: unknown = leaf;
        for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

        const output: Record<string, unknown> = { deep };
        Object.defineProperty(output, "later", {
          enumerable: true,
          get: () => {
            leaf.value = 2;
            return true;
          },
        });
        return contextWith(output);
      };

      assertEquals(
        serializeWorkflowContext(makeContext()),
        JSON.stringify(makeContext()),
      );
    });

    it("isolates a deep snapshot from later prototype hooks", () => {
      const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
      const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      const restore = (target: object, descriptor: PropertyDescriptor | undefined) => {
        if (descriptor === undefined) Reflect.deleteProperty(target, "toJSON");
        else Object.defineProperty(target, "toJSON", descriptor);
      };
      const makeContext = (): WorkflowContext => {
        let deep: unknown = { items: [{ value: 1 }] };
        for (let index = 0; index < PAST_THE_WALK; index++) deep = { n: deep };

        const output: Record<string, unknown> = { deep };
        Object.defineProperty(output, "later", {
          enumerable: true,
          get: () => {
            for (const prototype of [Object.prototype, Array.prototype]) {
              Object.defineProperty(prototype, "toJSON", {
                configurable: true,
                value: () => "polluted",
              });
            }
            return true;
          },
        });
        return contextWith(output);
      };

      try {
        const serialized = serializeWorkflowContext(makeContext());
        restore(Object.prototype, objectToJson);
        restore(Array.prototype, arrayToJson);
        assertEquals(serialized, JSON.stringify(makeContext()));
      } finally {
        restore(Object.prototype, objectToJson);
        restore(Array.prototype, arrayToJson);
      }
    });

    it("names a cycle that returns to an active ancestor at the cutoff", () => {
      const output: Record<string, unknown> = {};
      let deep: unknown = output;
      for (let index = 0; index < MAX_TRAVERSAL_DEPTH; index++) deep = { n: deep };
      output.deep = deep;

      const error = assertThrows(
        () => serializeWorkflowContext(contextWith(output)),
        VeryfrontError,
      );

      assertInstanceOf(error, VeryfrontError);
      assertStringIncludes(error.message, "circular reference");
    });

    it("counts every hole in a sparse array without keeping one entry each", () => {
      // Only MAX_REPORTED_PATHS paths ever reach a message, so keeping an entry
      // per hole would spend memory proportional to the payload on the
      // persistence path and show none of it.
      const sparse: unknown[] = [];
      sparse.length = 500_000;

      const before = process.memoryUsage().heapUsed;
      const warnings = captureWorkflowWarnings(() => {
        serializeWorkflowContext(contextWith({ rows: sparse }));
      });
      const retained = process.memoryUsage().heapUsed - before;
      const paths = String(warnings[0]?.context?.paths);

      assertEquals(paths.includes("context.step.<redacted>[0] (array hole)"), true);
      assertEquals(paths.includes("and 499995 more"), true);
      assertEquals(retained < 50_000_000, true);
    });
  });

  describe("agreement with JSON.stringify", () => {
    // This module walks the value itself instead of delegating, so it can drift
    // from `JSON.stringify`, and a drift does not blur a diagnostic: it writes
    // into durable storage something JSON never wrote. The generator below is
    // seeded, so a failing seed rebuilds the value that broke.
    const SAMPLE_STRINGS: readonly [string, ...string[]] = [
      "",
      "a",
      "he\u0301",
      "\ud83d\ude00",
      "\ud800",
      '"\\\n\t',
      "__proto__",
    ];
    const SAMPLE_NUMBERS: readonly [number, ...number[]] = [
      0,
      -0,
      1,
      -1,
      1e21,
      1e-7,
      5e-324,
      Number.MAX_SAFE_INTEGER,
      0.1,
    ];
    const SAMPLE_KEYS: readonly [string, ...string[]] = [
      "a",
      "b",
      "toJSON",
      "__proto__",
      "constructor",
      "0",
      "length",
      "u@x.com",
    ];

    function seededRandom(seed: number): () => number {
      let state = seed;
      return () => {
        state = (state + 0x6D2B79F5) | 0;
        let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
        mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
        return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
      };
    }

    function pick<T>(random: () => number, values: readonly [T, ...T[]]): T {
      return values[Math.floor(random() * values.length)] ?? values[0];
    }

    function generateLeaf(random: () => number): unknown {
      const choice = random();
      if (choice < 0.2) return pick(random, SAMPLE_STRINGS);
      if (choice < 0.45) return pick(random, SAMPLE_NUMBERS);
      if (choice < 0.55) return random() < 0.5;
      if (choice < 0.65) return null;
      if (choice < 0.72) return undefined;
      if (choice < 0.77) return new Date(Math.floor(random() * 1e12));
      if (choice < 0.81) return () => 1;
      if (choice < 0.84) return Symbol("generated");
      if (choice < 0.87) return new Map([["k", 1]]);
      if (choice < 0.9) return new Set([1, 2]);
      if (choice < 0.93) return new Number(random() * 10);
      if (choice < 0.96) return new String("boxed");
      if (choice < 0.98) return new Boolean(true);
      return /generated/g;
    }

    function generateArray(random: () => number, depth: number): unknown[] {
      const values: unknown[] = [];
      const length = Math.floor(random() * 4);
      for (let index = 0; index < length; index++) {
        // A hole, which JSON materializes as null.
        if (random() < 0.2) values.length += 1;
        else values.push(generateValue(random, depth - 1));
      }
      return values;
    }

    function generateObject(random: () => number, depth: number): object {
      const shape = random();
      const value: Record<string, unknown> = shape < 0.12 ? Object.create(null) : {};
      const keys = Math.floor(random() * 4);
      for (let index = 0; index < keys; index++) {
        const key = pick(random, SAMPLE_KEYS);
        const child = generateValue(random, depth - 1);
        // A callable `toJSON` is generated deliberately below, not by accident.
        if (key === "toJSON" && typeof child === "function") continue;
        if (random() < 0.12) {
          Object.defineProperty(value, key, {
            value: child,
            enumerable: random() < 0.5,
            writable: true,
            configurable: true,
          });
        } else {
          value[key] = child;
        }
      }
      if (shape >= 0.12 && shape < 0.2) {
        class Generated {}
        Object.setPrototypeOf(value, Generated.prototype);
      }
      if (shape >= 0.2 && shape < 0.26) {
        // Enumerable on purpose. JavaScriptCore skips a non-enumerable own
        // `toJSON` that V8 calls, so generating one would compare two engines
        // against each other rather than this module against its own host.
        Object.defineProperty(value, "toJSON", {
          value: () => ({ replaced: true }),
          enumerable: true,
        });
      }
      if (shape >= 0.26 && shape < 0.3) {
        Object.defineProperty(value, "lazy", { enumerable: true, get: () => 42 });
      }
      return value;
    }

    function generateValue(random: () => number, depth: number): unknown {
      const choice = random();
      if (depth <= 0 || choice < 0.22) return generateLeaf(random);
      return choice < 0.6 ? generateArray(random, depth) : generateObject(random, depth);
    }

    it("encodes generated values exactly as JSON.stringify encodes them", () => {
      // Every lossy value found warns, and the generator makes thousands, so
      // the level is lowered for the loop rather than flooding the run output.
      setLogLevel(LogLevel.ERROR);
      const divergences: string[] = [];
      try {
        for (let seed = 0; seed < 3000; seed++) {
          let expected: string | undefined;
          try {
            expected = JSON.stringify(generateValue(seededRandom(seed), 4));
          } catch {
            // JSON refuses this value outright, which the fatal cases cover.
            continue;
          }
          let actual: string;
          try {
            actual = serializeWorkflowJson(generateValue(seededRandom(seed), 4), "root");
          } catch (error) {
            if (expected !== undefined) {
              divergences.push(`seed ${seed} threw ${(error as Error).message}`);
            }
            continue;
          }
          if (expected === undefined) {
            divergences.push(`seed ${seed}: returned ${actual} without a JSON document`);
            continue;
          }
          if (actual !== expected) {
            divergences.push(`seed ${seed}: got ${actual}, wanted ${expected}`);
          }
        }
      } finally {
        __resetLoggerConfigForTests();
      }

      assertEquals(divergences.slice(0, 5), []);
    });
  });

  it("does not mistake a repeated value for a cycle", () => {
    // The same object appearing twice as siblings is perfectly serializable;
    // only an ancestor reappearing in its own subtree is a cycle.
    const shared = { id: 1 };

    const serialized = serializeWorkflowContext(contextWith({ a: shared, b: shared }));

    assertEquals(JSON.parse(serialized).step, { a: { id: 1 }, b: { id: 1 } });
  });
});
