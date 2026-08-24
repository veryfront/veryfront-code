import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  installGlobalTelemetryAPI,
  type Span,
  SpanKind,
  SpanStatusCode,
  type Tracer,
  type TracerProvider,
} from "../tracing/api-shim.ts";
import { initTracing, shutdownTracing } from "../tracing/index.ts";
import { instrument, instrumentBatch, instrumentSync } from "./wrappers.ts";

interface RecordedSpan {
  name: string;
  kind: unknown;
  attributes: Record<string, unknown>;
  exceptions: unknown[];
  status: { code: number; message?: string } | undefined;
  ended: boolean;
}

function createRecordingProvider(recorded: RecordedSpan[]): TracerProvider {
  const tracer: Tracer = {
    startSpan(name, options) {
      const entry: RecordedSpan = {
        name,
        kind: options?.kind,
        attributes: { ...(options?.attributes ?? {}) },
        exceptions: [],
        status: undefined,
        ended: false,
      };
      recorded.push(entry);
      const span: Span = {
        setAttribute(key, value) {
          entry.attributes[key] = value;
          return span;
        },
        setAttributes(attrs) {
          Object.assign(entry.attributes, attrs);
          return span;
        },
        setStatus(status) {
          entry.status = status;
          return span;
        },
        recordException(error) {
          entry.exceptions.push(error);
        },
        addEvent: () => span,
        end() {
          entry.ended = true;
        },
        spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 1 }),
        updateName: () => {},
      };
      return span;
    },
    startActiveSpan: ((_name: string, ...args: unknown[]) => {
      const callback = args.find((arg) => typeof arg === "function") as (span: Span) => unknown;
      return callback(tracer.startSpan(_name));
    }) as Tracer["startActiveSpan"],
  };
  return { getTracer: () => tracer };
}

/** Run `body` against a live tracer that records every span the wrappers emit. */
async function withRecordingTracer(
  body: (recorded: RecordedSpan[]) => void | Promise<void>,
): Promise<void> {
  const recorded: RecordedSpan[] = [];
  installGlobalTelemetryAPI({ tracerProvider: createRecordingProvider(recorded) });
  try {
    await initTracing({ enabled: true, serviceName: "wrappers-test" });
    await body(recorded);
  } finally {
    shutdownTracing();
    _resetShimForTests();
  }
}

describe("observability/auto-instrument/wrappers", () => {
  describe("instrument (async wrapper)", () => {
    it("does not block the wrapped operation when attribute collection fails", async () => {
      const wrapped = instrument(() => Promise.resolve("application result"), "test.attributes", {
        attributes: () => {
          throw new Error("telemetry attributes failed");
        },
      });

      assertEquals(await wrapped(), "application result");
    });

    it("should wrap an async function and preserve its result", async () => {
      const fn = (x: number): Promise<number> => Promise.resolve(x * 2);
      const wrapped = instrument(fn, "test.double");
      const result = await wrapped(5);
      assertEquals(result, 10);
    });

    it("should preserve function arguments", async () => {
      const fn = (a: string, b: string): Promise<string> => Promise.resolve(`${a}-${b}`);
      const wrapped = instrument(fn, "test.concat");
      const result = await wrapped("hello", "world");
      assertEquals(result, "hello-world");
    });

    it("should rethrow errors from the wrapped function", async () => {
      const fn = (): Promise<never> => {
        throw new Error("async failure");
      };
      const wrapped = instrument(fn, "test.fail");
      await assertRejects(() => wrapped(), Error, "async failure");
    });

    it("should accept instrument options with kind", async () => {
      await withRecordingTracer(async (recorded) => {
        const fn = (): Promise<string> => Promise.resolve("ok");
        const wrapped = instrument(fn, "test.server", { kind: "server" });
        const result = await wrapped();
        assertEquals(result, "ok");
        assertEquals(recorded.length, 1, "the wrapped call starts exactly one span");
        assertEquals(recorded[0]?.name, "test.server", "the span name reaches the tracer");
        assertEquals(
          recorded[0]?.kind,
          SpanKind.SERVER,
          "options.kind must reach startSpan as SpanKind.SERVER",
        );
      });
    });

    it("defaults the span kind to internal when no kind is supplied", async () => {
      await withRecordingTracer(async (recorded) => {
        const wrapped = instrument(() => Promise.resolve("ok"), "test.default-kind");
        assertEquals(await wrapped(), "ok");
        assertEquals(
          recorded[0]?.kind,
          SpanKind.INTERNAL,
          "a missing kind must reach startSpan as SpanKind.INTERNAL",
        );
      });
    });

    it("should accept instrument options with attributes factory", async () => {
      await withRecordingTracer(async (recorded) => {
        const fn = (userId: string): Promise<string> => Promise.resolve(userId);
        const wrapped = instrument(fn, "test.user", {
          attributes: (args) => ({ userId: args[0] as string }),
        });
        const result = await wrapped("u-123");
        assertEquals(result, "u-123");
        assertEquals(
          recorded[0]?.attributes.userId,
          "u-123",
          "the attributes factory output must reach the started span",
        );
        assertEquals(
          typeof recorded[0]?.attributes.duration_ms,
          "number",
          "instrument must record duration_ms on the span",
        );
        assertEquals(
          (recorded[0]?.attributes.duration_ms as number) >= 0,
          true,
          "duration_ms must be a non-negative measurement",
        );
      });
    });

    it("records the thrown error on the span before rethrowing", async () => {
      await withRecordingTracer(async (recorded) => {
        const boom = new Error("async failure");
        const wrapped = instrument((): Promise<never> => {
          throw boom;
        }, "test.fail-span");
        await assertRejects(() => wrapped(), Error, "async failure");
        assertStrictEquals(
          (recorded[0]?.exceptions[0] as Error | undefined)?.message,
          boom.message,
          "a failed span must record the thrown error",
        );
        assertEquals(
          recorded[0]?.status?.code,
          SpanStatusCode.ERROR,
          "a failed span must close with error status",
        );
      });
    });

    it("should handle functions that return resolved promises", async () => {
      const fn = (x: number): Promise<number> => Promise.resolve(x + 1);
      const wrapped = instrument(fn, "test.inc");
      assertEquals(await wrapped(9), 10);
    });

    it("should handle functions that return rejected promises", async () => {
      const fn = (): Promise<never> => {
        throw new Error("rejected");
      };
      const wrapped = instrument(fn, "test.reject");
      await assertRejects(() => wrapped(), Error, "rejected");
    });
  });

  describe("instrumentSync (sync wrapper)", () => {
    it("does not block the wrapped operation when attribute collection fails", () => {
      const wrapped = instrumentSync(() => "application result", "test.attributes", {
        attributes: () => {
          throw new Error("telemetry attributes failed");
        },
      });

      assertEquals(wrapped(), "application result");
    });

    it("should wrap a sync function and preserve its result", () => {
      const fn = (x: number): number => x * 3;
      const wrapped = instrumentSync(fn, "test.triple");
      assertEquals(wrapped(4), 12);
    });

    it("should preserve function arguments", () => {
      const fn = (a: number, b: number): number => a + b;
      const wrapped = instrumentSync(fn, "test.add");
      assertEquals(wrapped(3, 7), 10);
    });

    it("should rethrow errors from the wrapped function", () => {
      const fn = (): never => {
        throw new Error("sync failure");
      };
      const wrapped = instrumentSync(fn, "test.fail");
      assertThrows(() => wrapped(), Error, "sync failure");
    });

    it("should accept instrument options with kind", () => {
      const fn = (): string => "ok";
      const wrapped = instrumentSync(fn, "test.internal", { kind: "internal" });
      assertEquals(wrapped(), "ok");
    });

    it("records the thrown error on the span before rethrowing", async () => {
      await withRecordingTracer((recorded) => {
        const boom = new Error("sync failure");
        const wrapped = instrumentSync((): never => {
          throw boom;
        }, "test.fail-span");
        assertThrows(() => wrapped(), Error, "sync failure");
        assertStrictEquals(
          (recorded[0]?.exceptions[0] as Error | undefined)?.message,
          boom.message,
          "a failed span must record the thrown error",
        );
        assertEquals(
          recorded[0]?.status?.code,
          SpanStatusCode.ERROR,
          "a failed span must close with error status",
        );
      });
    });

    it("should accept instrument options with attributes factory", () => {
      const fn = (name: string): string => `Hello ${name}`;
      const wrapped = instrumentSync(fn, "test.greet", {
        attributes: (args) => ({ name: args[0] as string }),
      });
      assertEquals(wrapped("World"), "Hello World");
    });

    it("should handle functions returning various types", () => {
      assertEquals(instrumentSync(() => 42, "test.num")(), 42);
      assertEquals(instrumentSync(() => true, "test.bool")(), true);
      assertEquals(instrumentSync(() => null, "test.null")(), null);
      assertEquals(instrumentSync(() => undefined, "test.undef")(), undefined);
      const obj = { key: "value" };
      assertEquals(instrumentSync(() => obj, "test.obj")(), obj);
    });
  });

  describe("instrumentBatch", () => {
    it("rejects invalid batch sizes instead of silently skipping work", async () => {
      await assertRejects(
        () => instrumentBatch("test.invalid-size", [1], async () => {}, { batchSize: -1 }),
        RangeError,
        "batchSize",
      );
    });

    it("should process all items", async () => {
      const results: number[] = [];
      // deno-lint-ignore require-await
      await instrumentBatch("test.batch", [1, 2, 3], async (item) => {
        results.push(item * 2);
      });
      assertEquals(results, [2, 4, 6]);
    });

    it("should process empty array without error", async () => {
      let called = false;
      // deno-lint-ignore require-await
      await instrumentBatch("test.empty", [], async () => {
        called = true;
      });
      assertEquals(called, false);
    });

    it("should pass correct indices to processor", async () => {
      const indices: number[] = [];
      // deno-lint-ignore require-await
      await instrumentBatch("test.indices", ["a", "b", "c"], async (_item, index) => {
        indices.push(index);
      });
      assertEquals(indices, [0, 1, 2]);
    });

    it("should respect custom batch size", async () => {
      const items = Array.from({ length: 15 }, (_, i) => i);
      const processed: number[] = [];
      let inFlight = 0;
      let peak = 0;
      await instrumentBatch(
        "test.sized",
        items,
        async (item) => {
          inFlight++;
          peak = Math.max(peak, inFlight);
          processed.push(item);
          await Promise.resolve();
          inFlight--;
        },
        { batchSize: 5 },
      );
      assertEquals(processed.length, 15);
      assertEquals(processed, items);
      assertEquals(peak, 5, "batchSize 5 must cap concurrent processors at 5");
    });

    it("should default to batch size of 10", async () => {
      const items = Array.from({ length: 25 }, (_, i) => i);
      const processed: number[] = [];
      let inFlight = 0;
      let peak = 0;
      await instrumentBatch("test.default-size", items, async (item) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        processed.push(item);
        await Promise.resolve();
        inFlight--;
      });
      assertEquals(processed.length, 25);
      assertEquals(peak, 10, "the default batchSize must cap concurrent processors at 10");
    });

    it("should rethrow errors from processor", async () => {
      await assertRejects(
        () =>
          // deno-lint-ignore require-await
          instrumentBatch("test.error", [1, 2, 3], async (item) => {
            if (item === 2) throw new Error("batch item error");
          }),
        Error,
        "batch item error",
      );
    });

    it("should accept batch attributes", async () => {
      await withRecordingTracer(async (recorded) => {
        await instrumentBatch("test.attrs", [1], async () => {}, {
          attributes: { operation: "test", source: "unit" },
        });

        const batchSpan = recorded.find((span) => span.name === "test.attrs");
        assertEquals(
          batchSpan?.attributes,
          {
            "batch.total_items": 1,
            "batch.size": 10,
            "batch.total_batches": 1,
            operation: "test",
            source: "unit",
          },
          "caller batch attributes merge into the batch span",
        );
      });
    });

    it("should handle single-item batch", async () => {
      const results: number[] = [];
      // deno-lint-ignore require-await
      await instrumentBatch("test.single", [42], async (item) => {
        results.push(item);
      });
      assertEquals(results, [42]);
    });

    it("should handle batch size larger than items", async () => {
      const results: string[] = [];
      await instrumentBatch(
        "test.oversized",
        ["a", "b"],
        // deno-lint-ignore require-await
        async (item) => {
          results.push(item);
        },
        { batchSize: 100 },
      );
      assertEquals(results, ["a", "b"]);
    });
  });
});
