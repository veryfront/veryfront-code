import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  type MetricsAPI,
  type ObservableResult,
  setGlobalMetricsAPI,
} from "#veryfront/observability/tracing/api-shim.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { metrics } from "./index.ts";

describe("metrics public SDK", () => {
  afterEach(() => {
    _resetShimForTests();
    metrics.__resetForTests();
  });

  it("records counters and histograms with request-scoped project labels", async () => {
    const counterCalls: unknown[] = [];
    const histogramCalls: unknown[] = [];

    setGlobalMetricsAPI({
      getMeter() {
        return {
          createCounter(name: string) {
            return {
              add(value: number, attributes?: Record<string, unknown>) {
                counterCalls.push({ name, value, attributes });
              },
            };
          },
          createHistogram(name: string) {
            return {
              record(value: number, attributes?: Record<string, unknown>) {
                histogramCalls.push({ name, value, attributes });
              },
            };
          },
          createUpDownCounter() {
            return { add() {} };
          },
          createObservableGauge() {
            return { addCallback() {} };
          },
        };
      },
    } as MetricsAPI);

    await runWithRequestContext(
      {
        projectSlug: "demo-project",
        projectId: "project-123",
        token: "token",
        environmentName: "Staging",
      },
      async () => {
        metrics.counter("vf_eval_result_total", 1, {
          project_id: "other-project",
          provider: "openai",
        });
        metrics.histogram("vf_eval_latency_ms", 42, { model: "gpt-5" });
      },
    );

    assertEquals(counterCalls, [
      {
        name: "vf_eval_result_total",
        value: 1,
        attributes: {
          project_id: "project-123",
          project_slug: "demo-project",
          environment: "Staging",
          branch: "main",
          provider: "openai",
        },
      },
    ]);
    assertEquals(histogramCalls, [
      {
        name: "vf_eval_latency_ms",
        value: 42,
        attributes: {
          project_id: "project-123",
          project_slug: "demo-project",
          environment: "Staging",
          branch: "main",
          model: "gpt-5",
        },
      },
    ]);
  });

  it("records preview metrics with the request-scoped branch label", async () => {
    const counterCalls: unknown[] = [];

    setGlobalMetricsAPI({
      getMeter() {
        return {
          createCounter(name: string) {
            return {
              add(value: number, attributes?: Record<string, unknown>) {
                counterCalls.push({ name, value, attributes });
              },
            };
          },
          createHistogram() {
            return { record() {} };
          },
          createUpDownCounter() {
            return { add() {} };
          },
          createObservableGauge() {
            return { addCallback() {} };
          },
        };
      },
    } as MetricsAPI);

    await runWithRequestContext(
      {
        projectSlug: "demo-project",
        projectId: "project-123",
        token: "token",
        environmentName: "Preview",
        branch: "feature-metrics",
      },
      async () => {
        metrics.counter("vf_eval_result_total", 1, {
          branch: "user-supplied-branch",
          outcome: "pass",
        });
      },
    );

    assertEquals(counterCalls, [
      {
        name: "vf_eval_result_total",
        value: 1,
        attributes: {
          project_id: "project-123",
          project_slug: "demo-project",
          environment: "Preview",
          branch: "feature-metrics",
          outcome: "pass",
        },
      },
    ]);
  });

  it("defaults preview metrics to the preview environment label", async () => {
    const counterCalls: unknown[] = [];

    setGlobalMetricsAPI({
      getMeter() {
        return {
          createCounter(name: string) {
            return {
              add(value: number, attributes?: Record<string, unknown>) {
                counterCalls.push({ name, value, attributes });
              },
            };
          },
          createHistogram() {
            return { record() {} };
          },
          createUpDownCounter() {
            return { add() {} };
          },
          createObservableGauge() {
            return { addCallback() {} };
          },
        };
      },
    } as MetricsAPI);

    await runWithRequestContext(
      {
        projectSlug: "demo-project",
        projectId: "project-123",
        token: "token",
        productionMode: false,
        branch: "main",
      },
      async () => {
        metrics.counter("vf_eval_result_total", 1, {
          metric: "answer.contains",
          outcome: "pass",
        });
      },
    );

    assertEquals(counterCalls, [
      {
        name: "vf_eval_result_total",
        value: 1,
        attributes: {
          project_id: "project-123",
          project_slug: "demo-project",
          environment: "preview",
          branch: "main",
          metric: "answer.contains",
          outcome: "pass",
        },
      },
    ]);
  });

  it("records gauges through an observable callback", () => {
    let callback: ((result: ObservableResult) => void) | undefined;
    const observed: unknown[] = [];

    setGlobalMetricsAPI({
      getMeter() {
        return {
          createCounter() {
            return { add() {} };
          },
          createHistogram() {
            return { record() {} };
          },
          createUpDownCounter() {
            return { add() {} };
          },
          createObservableGauge() {
            return {
              addCallback(nextCallback: (result: ObservableResult) => void) {
                callback = nextCallback;
              },
            };
          },
        };
      },
    } as MetricsAPI);

    metrics.gauge("vf_queue_depth", 7, { kind: "eval" });
    callback?.({
      observe(value, attributes) {
        observed.push({ value, attributes });
      },
    });

    assertEquals(observed, [{ value: 7, attributes: { kind: "eval" } }]);
  });

  it("is a no-op when no metrics API is installed", () => {
    metrics.counter("vf_missing_provider_total");
    metrics.histogram("vf_missing_provider_ms", 1);
    metrics.gauge("vf_missing_provider_gauge", 1);
  });
});
