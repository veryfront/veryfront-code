import { assert, assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetEnvironmentConfig,
  _setEnvironmentConfigForTesting,
} from "#veryfront/config/environment-config.ts";
import type {
  Meter,
  ObservableGauge,
  ObservableResult,
} from "#veryfront/observability/tracing/api-shim.ts";
import { getMemoryUsage } from "../metrics/config.ts";
import type { MetricsConfig } from "../metrics/types.ts";
import {
  createMemoryInstruments,
  createMemoryObservableBindings,
  parseV8HeapLimitBytes,
} from "./memory-instruments.ts";

const CONFIG: MetricsConfig = { enabled: true, exporter: "console", prefix: "test" };

/** Heap limit pinned through the configured V8 flags so the percentage has a known denominator. */
const CONFIGURED_HEAP_LIMIT_MIB = 16;
const CONFIGURED_HEAP_LIMIT_BYTES = CONFIGURED_HEAP_LIMIT_MIB * 1024 * 1024;

function createRecordingMeter(
  created: Array<{ name: string; unit: string | undefined }>,
): Meter {
  const writableInstrument = { add() {}, record() {} };
  return {
    createCounter: () => writableInstrument,
    createUpDownCounter: () => writableInstrument,
    createHistogram: () => writableInstrument,
    createObservableGauge: (name, options): ObservableGauge => {
      created.push({ name, unit: options?.unit });
      return { addCallback() {}, removeCallback() {} };
    },
  };
}

function observeBinding(callback: (result: ObservableResult) => void): Promise<number | undefined> {
  let observed: number | undefined;
  const result: ObservableResult = {
    observe(value) {
      observed = value;
    },
  };
  const outcome = callback(result) as unknown;
  return outcome instanceof Promise ? outcome.then(() => observed) : Promise.resolve(observed);
}

describe("observability/instruments/memory-instruments", () => {
  it("parses explicit V8 heap limits without deployment-specific defaults", () => {
    assertEquals(
      parseV8HeapLimitBytes("--max-old-space-size=4096"),
      4096 * 1024 * 1024,
    );
    assertEquals(parseV8HeapLimitBytes("--max_old_space_size 2048"), 2048 * 1024 * 1024);
    assertEquals(parseV8HeapLimitBytes(""), undefined);
    assertEquals(parseV8HeapLimitBytes("--max-old-space-size=0"), undefined);
    assertEquals(parseV8HeapLimitBytes("--max-old-space-size=invalid"), undefined);
  });

  it("creates the memory gauge names and units the dashboards read", () => {
    const created: Array<{ name: string; unit: string | undefined }> = [];

    createMemoryInstruments(createRecordingMeter(created), CONFIG);

    assertEquals(
      created,
      [
        { name: "test.memory.usage", unit: "bytes" },
        { name: "test.memory.heap", unit: "bytes" },
        { name: "test.memory.heap_total", unit: "bytes" },
        { name: "test.memory.heap_percent", unit: "percent" },
      ],
      "memory gauge names and units are the dashboard contract",
    );
  });

  it("observes rss, heap, and heap utilization through their matching gauges", async () => {
    const instruments = createMemoryInstruments(createRecordingMeter([]), CONFIG);
    const bindings = createMemoryObservableBindings(instruments);

    assertEquals(bindings.length, 4, "every memory gauge is bound to a callback");
    assertStrictEquals(
      bindings[0]?.instrument,
      instruments.memoryUsageGauge,
      "the first binding observes through the memory usage gauge",
    );
    assertStrictEquals(
      bindings[1]?.instrument,
      instruments.heapUsageGauge,
      "the second binding observes through the heap usage gauge",
    );
    assertStrictEquals(
      bindings[2]?.instrument,
      instruments.heapTotalGauge,
      "the third binding observes through the heap total gauge",
    );
    assertStrictEquals(
      bindings[3]?.instrument,
      instruments.heapPercentGauge,
      "the fourth binding observes through the heap percent gauge",
    );

    _setEnvironmentConfigForTesting({
      denoV8Flags: `--max-old-space-size=${CONFIGURED_HEAP_LIMIT_MIB}`,
    });
    let rss: number | undefined;
    let heapUsed: number | undefined;
    let heapTotal: number | undefined;
    let heapPercent: number | undefined;
    try {
      rss = await observeBinding(bindings[0]!.callback);
      heapUsed = await observeBinding(bindings[1]!.callback);
      heapTotal = await observeBinding(bindings[2]!.callback);
      heapPercent = await observeBinding(bindings[3]!.callback);
    } finally {
      _resetEnvironmentConfig();
    }

    assert(heapUsed !== undefined && heapUsed > 0, "the heap gauge observes used heap bytes");
    assert(
      heapTotal !== undefined && heapTotal >= heapUsed,
      "the heap_total gauge observes allocated heap, never less than the used heap",
    );
    assert(
      rss !== undefined && rss > heapTotal,
      "the usage gauge observes resident memory, which exceeds the allocated V8 heap",
    );

    const usage = getMemoryUsage();
    assert(usage !== null, "the host runtime reports memory usage");
    const expectedPercent = (usage.heapUsed / CONFIGURED_HEAP_LIMIT_BYTES) * 100;
    assert(heapPercent !== undefined, "the heap_percent gauge observes a value");
    assert(
      Math.abs(heapPercent - expectedPercent) <= expectedPercent * 0.02,
      `heap_percent must be heapUsed/limit*100, expected about ${expectedPercent}, observed ${heapPercent}`,
    );
    assertEquals(
      heapPercent,
      Math.round(heapPercent * 100) / 100,
      "heap_percent must be rounded to two decimals",
    );
  });
});
