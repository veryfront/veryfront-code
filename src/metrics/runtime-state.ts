import {
  type AttributeValue,
  type Counter,
  type Histogram,
  type ObservableGauge,
} from "#veryfront/observability";
import { DirectMetricsExporter } from "./direct-exporter.ts";
import { logDirectExportFailure, logMetricFailure } from "./diagnostics.ts";

export interface LocalGaugeSample {
  value: number;
  attributes: Readonly<Record<string, AttributeValue>>;
}

export interface LocalGaugeState {
  callback: Parameters<ObservableGauge["addCallback"]>[0];
  instrument: ObservableGauge;
  samples: Map<string, LocalGaugeSample>;
}

class MetricsRuntimeState {
  readonly counters = new Map<string, Counter>();
  readonly directExporter = new DirectMetricsExporter(logDirectExportFailure);
  readonly gauges = new Map<string, LocalGaugeState>();
  readonly histograms = new Map<string, Histogram>();
  gaugeSeriesCount = 0;
  localProviderRevision = -1;

  refreshLocalProvider(revision: number): void {
    if (revision === this.localProviderRevision) return;
    this.clearLocalProvider();
    this.localProviderRevision = revision;
  }

  clearLocalProvider(): void {
    for (const gauge of this.gauges.values()) {
      try {
        gauge.instrument.removeCallback?.(gauge.callback);
      } catch (error) {
        logMetricFailure("observable gauge callback cleanup failed", error);
      }
    }
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
    this.gaugeSeriesCount = 0;
  }

  reset(): void {
    this.clearLocalProvider();
    this.localProviderRevision = -1;
    this.directExporter.reset();
  }
}

export const metricsRuntimeState = new MetricsRuntimeState();
