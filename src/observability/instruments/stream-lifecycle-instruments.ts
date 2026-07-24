import type { Counter, Histogram, Meter } from "#veryfront/observability/tracing/api-shim.ts";
import { DURATION_HISTOGRAM_BOUNDARIES_MS } from "#veryfront/config/defaults.ts";
import type { MetricsConfig } from "../metrics/types.ts";

/** Bounded stream lifecycle counters and duration histograms. */
export interface StreamLifecycleInstruments {
  streamLifecycleOutcomeCounter: Counter | null;
  streamLifecycleDeadlineCounter: Counter | null;
  streamLifecycleTelemetryCounter: Counter | null;
  streamLifecycleRepairCounter: Counter | null;
  streamLifecycleShadowDivergenceCounter: Counter | null;
  streamLifecycleAttemptDuration: Histogram | null;
  streamLifecycleFirstProgressDuration: Histogram | null;
  streamLifecycleSemanticIdleDuration: Histogram | null;
  streamLifecycleToolInputDuration: Histogram | null;
  streamLifecycleToolExecutionDuration: Histogram | null;
}

export function createStreamLifecycleInstruments(
  meter: Meter,
  config: MetricsConfig,
): StreamLifecycleInstruments {
  const prefix = config.prefix;
  const duration = (name: string, description: string): Histogram =>
    meter.createHistogram(`${prefix}.stream.lifecycle.${name}`, {
      description,
      unit: "ms",
      advice: { explicitBucketBoundaries: [...DURATION_HISTOGRAM_BOUNDARIES_MS] },
    });

  return {
    streamLifecycleOutcomeCounter: meter.createCounter(
      `${prefix}.stream.lifecycle.outcomes`,
      {
        description: "Stream lifecycle terminal outcomes",
        unit: "outcomes",
      },
    ),
    streamLifecycleDeadlineCounter: meter.createCounter(
      `${prefix}.stream.lifecycle.deadlines`,
      {
        description: "Stream lifecycle deadlines that fired",
        unit: "deadlines",
      },
    ),
    streamLifecycleTelemetryCounter: meter.createCounter(
      `${prefix}.stream.lifecycle.telemetry`,
      {
        description: "Stream lifecycle telemetry frames",
        unit: "frames",
      },
    ),
    streamLifecycleRepairCounter: meter.createCounter(
      `${prefix}.stream.lifecycle.repairs`,
      {
        description: "Stream lifecycle protocol repairs",
        unit: "repairs",
      },
    ),
    streamLifecycleShadowDivergenceCounter: meter.createCounter(
      `${prefix}.stream.lifecycle.shadow_divergences`,
      {
        description: "Stream lifecycle shadow divergences by category",
        unit: "divergences",
      },
    ),
    streamLifecycleAttemptDuration: duration(
      "attempt.duration",
      "Provider stream attempt duration",
    ),
    streamLifecycleFirstProgressDuration: duration(
      "first_progress.duration",
      "Time to first semantic progress",
    ),
    streamLifecycleSemanticIdleDuration: duration(
      "semantic_idle.duration",
      "Semantic idle duration between progress",
    ),
    streamLifecycleToolInputDuration: duration(
      "tool_input.duration",
      "Tool input assembly duration",
    ),
    streamLifecycleToolExecutionDuration: duration(
      "tool_execution.duration",
      "Provider-visible tool execution duration",
    ),
  };
}
