import type { Counter, Histogram, Meter } from "#veryfront/observability/tracing/api-shim.ts";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "#veryfront/config/defaults.ts";
import type { MetricsConfig } from "../metrics/types.ts";

/**
 * Content-free metrics for required hosted model-call context persistence.
 * Service identity remains an OpenTelemetry resource attribute and individual
 * runs remain correlated through existing traces. Run and context IDs are not
 * metric labels because this metrics layer has no bounded correlation value.
 */
export interface ModelCallContextInstruments {
  modelCallContextWriterOutcomeCounter: Counter | null;
  modelCallContextBarrierOutcomeCounter: Counter | null;
  modelCallContextLogicalByteLength: Histogram | null;
  modelCallContextPartCount: Histogram | null;
  modelCallContextAppendRequestCount: Histogram | null;
  modelCallContextRecorderBarrierDuration: Histogram | null;
}

export function createModelCallContextInstruments(
  meter: Meter,
  config: MetricsConfig,
): ModelCallContextInstruments {
  const prefix = `${config.prefix}.agent.model_call_context`;
  return {
    modelCallContextWriterOutcomeCounter: meter.createCounter(`${prefix}.writer.outcomes`, {
      description: "Required model-call context writer outcomes",
      unit: "outcomes",
    }),
    modelCallContextBarrierOutcomeCounter: meter.createCounter(
      `${prefix}.barrier.terminal.outcomes`,
      { description: "Required model-call context barrier terminal outcomes", unit: "outcomes" },
    ),
    modelCallContextLogicalByteLength: meter.createHistogram(
      `${prefix}.logical.byte_length`,
      { description: "Serialized logical model-call context UTF-8 byte length", unit: "By" },
    ),
    modelCallContextPartCount: meter.createHistogram(`${prefix}.part_count`, {
      description: "Physical durable part count per logical model-call context",
      unit: "parts",
    }),
    modelCallContextAppendRequestCount: meter.createHistogram(`${prefix}.append_request_count`, {
      description: "Actual durable append request count per logical model-call context",
      unit: "requests",
    }),
    modelCallContextRecorderBarrierDuration: meter.createHistogram(
      `${prefix}.recorder_barrier.duration`,
      {
        description: "Total required model-call context recorder and barrier duration",
        unit: "ms",
        advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
      },
    ),
  };
}
