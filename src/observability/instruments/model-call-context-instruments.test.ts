import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Meter } from "#veryfront/observability/tracing/api-shim.ts";
import type { MetricsConfig } from "../metrics/types.ts";
import { createModelCallContextInstruments } from "./model-call-context-instruments.ts";

describe("model-call context instruments", () => {
  it("creates only bounded content-free counters and numeric histograms", () => {
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
    } as unknown as Meter;

    createModelCallContextInstruments(meter, { prefix: "veryfront" } as MetricsConfig);

    assertEquals(counters, [
      "veryfront.agent.model_call_context.writer.outcomes",
      "veryfront.agent.model_call_context.barrier.terminal.outcomes",
    ]);
    assertEquals(histograms, [
      "veryfront.agent.model_call_context.logical.byte_length",
      "veryfront.agent.model_call_context.part_count",
      "veryfront.agent.model_call_context.append_request_count",
      "veryfront.agent.model_call_context.recorder_barrier.duration",
    ]);
    const names = [...counters, ...histograms].join(" ");
    for (
      const forbidden of [
        "prompt",
        "tools",
        "serialized_segment",
        "sha256",
        "context_id",
        "run_id",
        "conversation_id",
      ]
    ) {
      assertEquals(names.includes(forbidden), false);
    }
  });
});
