import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Meter } from "#veryfront/observability/tracing/api-shim.ts";
import type { MetricsConfig } from "../metrics/types.ts";
import { createStreamLifecycleInstruments } from "./stream-lifecycle-instruments.ts";

describe("stream lifecycle instruments", () => {
  it("creates the exact bounded instrument names under the prefix", () => {
    const counters: string[] = [];
    const histograms: string[] = [];
    const meter = {
      createCounter(name: string) {
        counters.push(name);
        return { add() {} };
      },
      createHistogram(name: string) {
        histograms.push(name);
        return { record() {} };
      },
      createUpDownCounter() {
        return { add() {} };
      },
      createObservableGauge() {
        return { addCallback() {} };
      },
    } as unknown as Meter;

    createStreamLifecycleInstruments(meter, {
      prefix: "veryfront",
    } as MetricsConfig);

    assertEquals(counters, [
      "veryfront.stream.lifecycle.outcomes",
      "veryfront.stream.lifecycle.deadlines",
      "veryfront.stream.lifecycle.telemetry",
      "veryfront.stream.lifecycle.repairs",
      "veryfront.stream.lifecycle.shadow_divergences",
    ]);
    assertEquals(histograms, [
      "veryfront.stream.lifecycle.attempt.duration",
      "veryfront.stream.lifecycle.first_progress.duration",
      "veryfront.stream.lifecycle.semantic_idle.duration",
      "veryfront.stream.lifecycle.tool_input.duration",
      "veryfront.stream.lifecycle.tool_execution.duration",
    ]);
  });
});
