import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  type MetricsAPI,
  type ObservableResult,
  setGlobalMetricsAPI,
} from "#veryfront/observability/tracing/api-shim.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { DirectMetricsExporter, type DirectMetricsTarget } from "./direct-exporter.ts";
import { metrics } from "./index.ts";
import { resetMetricsForTests } from "./testing.ts";

describe("metrics public SDK", () => {
  afterEach(() => {
    _resetShimForTests();
    resetMetricsForTests();
  });

  it("does not expose process-wide test controls to project code", () => {
    assertEquals("__resetForTests" in metrics, false);
    assertEquals("__flushForTests" in metrics, false);
    assertEquals(Object.isFrozen(metrics), true);
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

  it("rebuilds local instruments and detaches gauges when the provider changes", () => {
    const counterCalls: string[] = [];
    let removedGaugeCallbacks = 0;

    const createApi = (provider: string): MetricsAPI => ({
      getMeter() {
        return {
          createCounter() {
            return {
              add() {
                counterCalls.push(provider);
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
            return {
              addCallback() {},
              removeCallback() {
                removedGaugeCallbacks++;
              },
            };
          },
        };
      },
    });

    setGlobalMetricsAPI(createApi("first"));
    metrics.counter("vf_provider_generation_total");
    metrics.gauge("vf_provider_generation_depth", 1);

    setGlobalMetricsAPI(createApi("second"));
    metrics.counter("vf_provider_generation_total");

    assertEquals(counterCalls, ["first", "second"]);
    assertEquals(removedGaugeCallbacks, 1);
  });

  it("exports project metrics directly to OTLP when configured", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    Deno.env.set("OTEL_METRICS_ENABLED", "true");
    Deno.env.set("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/otlp");
    Deno.env.set("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Basic secret");
    Deno.env.set("OTEL_SERVICE_NAME", "veryfront-server");

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    try {
      metrics.counter("vf_eval_result_total", 1, {
        project_id: "project-123",
        environment: "preview",
        branch: "main",
        metric: "answer.contains",
        outcome: "pass",
      });
      await metrics.flush();
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OTEL_METRICS_ENABLED");
      Deno.env.delete("OTEL_EXPORTER_OTLP_ENDPOINT");
      Deno.env.delete("OTEL_EXPORTER_OTLP_HEADERS");
      Deno.env.delete("OTEL_SERVICE_NAME");
    }

    assertEquals(requests.length, 1);
    assertEquals(requests[0]?.url, "https://collector.example/otlp/v1/metrics");
    assertEquals(
      (requests[0]?.init?.headers as Record<string, string>).Authorization,
      "Basic secret",
    );

    const body = JSON.parse(String(requests[0]?.init?.body));
    const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];
    assertEquals(metric.name, "vf_eval_result_total");
    assertEquals(metric.sum.isMonotonic, true);
    assertEquals(metric.sum.dataPoints[0].asDouble, 1);
    assertEquals(
      metric.sum.dataPoints[0].attributes.find((attr: { key: string }) => attr.key === "project_id")
        .value.stringValue,
      "project-123",
    );
  });

  it("routes hosted project metrics through the internal API proxy", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    Deno.env.set("OTEL_METRICS_ENABLED", "true");
    Deno.env.set("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/otlp");
    Deno.env.set("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Basic external-secret");
    Deno.env.set("VERYFRONT_API_BASE_URL", "http://veryfront-api:80");
    Deno.env.set("VERYFRONT_API_INTERNAL_USER", "internal-user");
    Deno.env.set("VERYFRONT_API_INTERNAL_PASS", "internal-pass");

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    try {
      metrics.counter("vf_eval_result_total", 1, { project_id: "project-123" });
      await metrics.flush();
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OTEL_METRICS_ENABLED");
      Deno.env.delete("OTEL_EXPORTER_OTLP_ENDPOINT");
      Deno.env.delete("OTEL_EXPORTER_OTLP_HEADERS");
      Deno.env.delete("VERYFRONT_API_BASE_URL");
      Deno.env.delete("VERYFRONT_API_INTERNAL_USER");
      Deno.env.delete("VERYFRONT_API_INTERNAL_PASS");
    }

    assertEquals(requests.length, 1);
    assertEquals(
      requests[0]?.url,
      "http://veryfront-api/internal/metrics/otlp/v1/metrics",
    );
    assertEquals(
      (requests[0]?.init?.headers as Record<string, string>).Authorization,
      "Basic aW50ZXJuYWwtdXNlcjppbnRlcm5hbC1wYXNz",
    );
  });

  it("uses project OTLP metrics config in dedicated runtimes", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-1",
      VERYFRONT_API_BASE_URL: "http://veryfront-api:80",
      VERYFRONT_API_INTERNAL_USER: "internal-user",
      VERYFRONT_API_INTERNAL_PASS: "internal-pass",
    }, async () => {
      globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch;

      try {
        await runWithProjectEnv({
          OTEL_METRICS_ENABLED: "true",
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://otlp.datadoghq.eu/v1/metrics",
          OTEL_EXPORTER_OTLP_METRICS_HEADERS: "dd-api-key=project-key",
          OTEL_SERVICE_NAME: "veryfront-ops-agent",
        }, async () => {
          metrics.counter("vf_eval_result_total", 1, { project_id: "project-123" });
          await metrics.flush();
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requests.length, 1);
    assertEquals(requests[0]?.url, "https://otlp.datadoghq.eu/v1/metrics");
    assertEquals(
      (requests[0]?.init?.headers as Record<string, string>)["dd-api-key"],
      "project-key",
    );

    const body = JSON.parse(String(requests[0]?.init?.body));
    assertEquals(
      body.resourceMetrics[0].resource.attributes.find(
        (attr: { key: string }) => attr.key === "service.name",
      ).value.stringValue,
      "veryfront-ops-agent",
    );
  });

  it("routes dedicated runtime host OTLP metrics through the internal API proxy without project env", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-1",
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/otlp",
      OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Basic external-secret",
      VERYFRONT_API_BASE_URL: "http://veryfront-api:80",
      VERYFRONT_API_INTERNAL_USER: "internal-user",
      VERYFRONT_API_INTERNAL_PASS: "internal-pass",
    }, async () => {
      globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return Promise.resolve(new Response("{}", { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_runtime_metric_total", 1, { source: "host" });
        await metrics.flush();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requests.length, 1);
    assertEquals(
      requests[0]?.url,
      "http://veryfront-api/internal/metrics/otlp/v1/metrics",
    );
    assertEquals(
      (requests[0]?.init?.headers as Record<string, string>).Authorization,
      "Basic aW50ZXJuYWwtdXNlcjppbnRlcm5hbC1wYXNz",
    );
  });

  it("exports direct histograms with cumulative temporality", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    Deno.env.set("OTEL_METRICS_ENABLED", "true");
    Deno.env.set("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://collector.example/v1/metrics");

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    try {
      metrics.histogram("vf_eval_duration_ms", 42, { project_id: "project-123" });
      metrics.histogram("vf_eval_duration_ms", 120, { project_id: "project-123" });
      await metrics.flush();
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OTEL_METRICS_ENABLED");
      Deno.env.delete("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT");
    }

    assertEquals(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.init?.body));
    const emittedMetrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
    const metric = emittedMetrics.at(-1);
    assertEquals(metric.name, "vf_eval_duration_ms");
    assertEquals(metric.histogram.aggregationTemporality, 2);
    assertEquals(metric.histogram.dataPoints[0].count, "2");
    assertEquals(metric.histogram.dataPoints[0].sum, 162);
    assertEquals(
      metric.histogram.dataPoints[0].bucketCounts.every(
        (count: unknown) => typeof count === "string",
      ),
      true,
    );
    assertEquals(
      metric.histogram.dataPoints[0].bucketCounts.reduce(
        (sum: number, count: string) => sum + Number(count),
        0,
      ),
      2,
    );
  });

  it("honors delta temporality without resending prior counter values", async () => {
    const originalFetch = globalThis.fetch;
    const exports: Array<{ temporality: number; value: number }> = [];

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: "delta",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const sum = body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum;
        exports.push({
          temporality: sum.aggregationTemporality,
          value: sum.dataPoints[0].asDouble,
        });
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_delta_total", 1);
        await metrics.flush();
        metrics.counter("vf_delta_total", 2);
        await metrics.flush();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(exports, [
      { temporality: 1, value: 1 },
      { temporality: 1, value: 2 },
    ]);
  });

  it("preserves delta updates recorded while an export is in flight", async () => {
    const originalFetch = globalThis.fetch;
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const exportedValues: number[] = [];
    let requestCount = 0;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE: "delta",
    }, async () => {
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        requestCount++;
        const body = JSON.parse(String(init?.body));
        exportedValues.push(
          body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum
            .dataPoints[0].asDouble,
        );
        if (requestCount === 1) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        return new Response(null, { status: 200 });
      }) as typeof fetch;

      try {
        metrics.counter("vf_delta_in_flight_total", 1);
        const firstFlush = metrics.flush();
        await firstStarted.promise;

        metrics.counter("vf_delta_in_flight_total", 2);
        const secondFlush = metrics.flush();
        releaseFirst.resolve();
        await Promise.all([firstFlush, secondFlush]);
      } finally {
        globalThis.fetch = originalFetch;
        releaseFirst.resolve();
      }
    });

    assertEquals(exportedValues, [1, 2]);
  });

  it("exports gauges directly even when no SDK meter is installed", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    Deno.env.set("OTEL_METRICS_ENABLED", "true");
    Deno.env.set("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT", "https://collector.example/v1/metrics");

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    try {
      metrics.gauge("vf_queue_depth", 3, { project_id: "project-123" });
      await metrics.flush();
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OTEL_METRICS_ENABLED");
      Deno.env.delete("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT");
    }

    assertEquals(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.init?.body));
    const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];
    assertEquals(metric.name, "vf_queue_depth");
    assertEquals(metric.gauge.dataPoints[0].asDouble, 3);
  });

  it("keeps queued direct metrics bound to their original destination and resource", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-1",
      OTEL_METRICS_ENABLED: "false",
    }, async () => {
      globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
        requests.push({ url: String(url), init });
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        await runWithProjectEnv({
          OTEL_METRICS_ENABLED: "true",
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://first.example/v1/metrics",
          OTEL_EXPORTER_OTLP_METRICS_HEADERS: "x-project-key=first",
          OTEL_SERVICE_NAME: "first-service",
          VERYFRONT_VERSION: "first-version",
        }, async () => {
          metrics.counter("vf_first_total", 1, { project_id: "first" });
        });
        await runWithProjectEnv({
          OTEL_METRICS_ENABLED: "true",
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://second.example/v1/metrics",
          OTEL_EXPORTER_OTLP_METRICS_HEADERS: "x-project-key=second",
          OTEL_SERVICE_NAME: "second-service",
          VERYFRONT_VERSION: "second-version",
        }, async () => {
          metrics.counter("vf_second_total", 1, { project_id: "second" });
        });

        await metrics.flush();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requests.map((request) => request.url).sort(), [
      "https://first.example/v1/metrics",
      "https://second.example/v1/metrics",
    ]);
    const exportsByUrl = Object.fromEntries(
      requests.map((request) => {
        const body = JSON.parse(String(request.init?.body));
        return [request.url, {
          header: (request.init?.headers as Record<string, string>)["x-project-key"],
          metric: body.resourceMetrics[0].scopeMetrics[0].metrics[0].name,
          resource: Object.fromEntries(
            body.resourceMetrics[0].resource.attributes.map(
              (attribute: { key: string; value: { stringValue: string } }) => [
                attribute.key,
                attribute.value.stringValue,
              ],
            ),
          ),
        }];
      }),
    );
    assertEquals(exportsByUrl, {
      "https://first.example/v1/metrics": {
        header: "first",
        metric: "vf_first_total",
        resource: {
          "service.name": "first-service",
          "service.version": "first-version",
        },
      },
      "https://second.example/v1/metrics": {
        header: "second",
        metric: "vf_second_total",
        resource: {
          "service.name": "second-service",
          "service.version": "second-version",
        },
      },
    });
  });

  it("retains failed direct exports for a later retry", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: unknown[] = [];

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return Promise.resolve(
          new Response(null, { status: bodies.length === 1 ? 503 : 200 }),
        );
      }) as typeof fetch;

      try {
        metrics.counter("vf_retry_total", 1, { outcome: "retry" });
        await metrics.flush();
        await metrics.flush();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(bodies.length, 2);
    assertEquals(
      bodies.map((body) =>
        (body as {
          resourceMetrics: Array<{
            scopeMetrics: Array<{
              metrics: Array<{ sum: { dataPoints: Array<{ asDouble: number }> } }>;
            }>;
          }>;
        })
          .resourceMetrics[0]?.scopeMetrics[0]?.metrics[0]?.sum.dataPoints[0]
          ?.asDouble
      ),
      [1, 1],
    );
  });

  it("stops automatic direct retries after five attempts", async () => {
    using time = new FakeTime();
    const originalFetch = globalThis.fetch;
    let requestCount = 0;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = (() => {
        requestCount++;
        return Promise.resolve(new Response(null, { status: 503 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_bounded_retry_total", 1);
        await metrics.flush();
        await time.tickAsync(1_000);
        await time.tickAsync(2_000);
        await time.tickAsync(4_000);
        await time.tickAsync(8_000);
        await time.tickAsync(30_000);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requestCount, 5);
  });

  it("evicts an exhausted destination when admitting a replacement", async () => {
    const originalFetch = globalThis.fetch;
    const requestCounts = new Map<string, number>();
    const replacementUrl = "https://replacement.example/v1/metrics";
    const exporter = new DirectMetricsExporter(() => {});
    const createTarget = (url: string): DirectMetricsTarget => ({
      url,
      headers: Object.freeze({}),
      resourceAttributes: Object.freeze({ "service.name": "test" }),
      temporality: "cumulative",
    });
    const record = (url: string, name: string) => {
      exporter.record({
        kind: "counter",
        name,
        value: 1,
        attributes: Object.freeze({ project_id: name }),
        options: {},
        timestampUnixNano: "1",
        target: createTarget(url),
      });
    };

    globalThis.fetch = ((url: string | URL | Request) => {
      const normalizedUrl = String(url);
      requestCounts.set(
        normalizedUrl,
        (requestCounts.get(normalizedUrl) ?? 0) + 1,
      );
      return Promise.resolve(
        new Response(null, {
          status: normalizedUrl === replacementUrl ? 200 : 503,
        }),
      );
    }) as typeof fetch;

    try {
      for (let index = 0; index < 16; index++) {
        record(
          `https://failed-${index}.example/v1/metrics`,
          `vf_destination_${index}_total`,
        );
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        await exporter.flush();
      }

      record(replacementUrl, "vf_replacement_destination_total");
      await exporter.flush();
    } finally {
      exporter.reset();
      globalThis.fetch = originalFetch;
    }

    assertEquals(requestCounts.get(replacementUrl), 1);
  });

  it("times out a stalled direct export without rejecting the caller", async () => {
    using time = new FakeTime();
    const originalFetch = globalThis.fetch;
    let aborted = false;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            aborted = true;
            reject(init.signal?.reason);
          }, { once: true });
        })) as typeof fetch;

      try {
        metrics.counter("vf_timeout_total", 1);
        const flush = metrics.flush();
        await time.tickAsync(10_000);
        await flush;
      } finally {
        resetMetricsForTests();
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(aborted, true);
  });

  it("does not retry a non-retryable OTLP rejection", async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = (() => {
        requestCount++;
        return Promise.resolve(new Response(null, { status: 400 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_bad_request_total", 1);
        await metrics.flush();
        await metrics.flush();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requestCount, 1);
  });

  it("serializes direct metric descriptions and units", async () => {
    const originalFetch = globalThis.fetch;
    let body: {
      resourceMetrics: Array<{
        scopeMetrics: Array<{
          metrics: Array<Record<string, unknown>>;
        }>;
      }>;
    } | undefined;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        body = JSON.parse(String(init?.body));
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.histogram(
          "vf_latency_seconds",
          1.5,
          undefined,
          { description: "Request latency", unit: "s" },
        );
        await metrics.flush();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertExists(body);
    const resourceMetric = body.resourceMetrics[0];
    const scopeMetric = resourceMetric?.scopeMetrics[0];
    const metric = scopeMetric?.metrics[0];
    assertExists(metric);
    assertEquals(metric.description, "Request latency");
    assertEquals(metric.unit, "s");
  });

  it("does not let invalid measurements or provider failures escape into application code", () => {
    const calls: string[] = [];
    setGlobalMetricsAPI({
      getMeter() {
        return {
          createCounter() {
            calls.push("createCounter");
            return {
              add() {
                calls.push("add");
                throw new Error("provider failed");
              },
            };
          },
          createHistogram() {
            calls.push("createHistogram");
            throw new Error("provider failed");
          },
          createUpDownCounter() {
            return { add() {} };
          },
          createObservableGauge() {
            calls.push("createObservableGauge");
            throw new Error("provider failed");
          },
        };
      },
    } as MetricsAPI);

    metrics.counter("1-invalid", 1);
    metrics.counter("vf_invalid_total", Number.NaN);
    metrics.counter("vf_invalid_total", -1);
    metrics.counter("vf_valid_total", 1);
    metrics.histogram("vf_valid_seconds", 1);
    metrics.gauge("vf_valid_depth", 1);

    assertEquals(calls, [
      "createCounter",
      "add",
      "createHistogram",
      "createObservableGauge",
    ]);
  });

  it("serializes direct exports per destination without overlapping requests", async () => {
    const originalFetch = globalThis.fetch;
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const exportedNames: string[] = [];
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let requestCount = 0;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
        requestCount++;
        activeRequests++;
        maxActiveRequests = Math.max(maxActiveRequests, activeRequests);
        const body = JSON.parse(String(init?.body));
        exportedNames.push(
          ...body.resourceMetrics[0].scopeMetrics[0].metrics.map(
            (metric: { name: string }) => metric.name,
          ),
        );
        try {
          if (requestCount === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          return new Response(null, { status: 200 });
        } finally {
          activeRequests--;
        }
      }) as typeof fetch;

      try {
        metrics.counter("vf_first_total", 1);
        const firstFlush = metrics.flush();
        await firstStarted.promise;

        metrics.counter("vf_second_total", 1);
        const secondFlush = metrics.flush();
        await Promise.resolve();
        await Promise.resolve();
        releaseFirst.resolve();
        await Promise.all([firstFlush, secondFlush]);
      } finally {
        globalThis.fetch = originalFetch;
        releaseFirst.resolve();
      }
    });

    assertEquals(maxActiveRequests, 1);
    assertEquals(exportedNames.sort(), ["vf_first_total", "vf_second_total"]);
  });

  it("drops a cumulative update that would overflow an OTLP number", async () => {
    const originalFetch = globalThis.fetch;
    let exportedValue: number | undefined;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        exportedValue = body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum
          .dataPoints[0].asDouble;
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_large_total", Number.MAX_VALUE);
        metrics.counter("vf_large_total", Number.MAX_VALUE);
        await metrics.flush();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(exportedValue, Number.MAX_VALUE);
  });

  it("keeps one stable metadata definition per direct metric name", async () => {
    const originalFetch = globalThis.fetch;
    let exportedMetrics: Array<Record<string, unknown>> = [];

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        exportedMetrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter(
          "vf_stable_total",
          1,
          undefined,
          { description: "Stable definition", unit: "1" },
        );
        metrics.counter(
          "vf_stable_total",
          1,
          undefined,
          { description: "Conflicting definition", unit: "items" },
        );
        await metrics.flush();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(exportedMetrics.length, 1);
    assertEquals(exportedMetrics[0]?.description, "Stable definition");
    assertEquals(
      (exportedMetrics[0]?.sum as {
        dataPoints: Array<{ asDouble: number }>;
      }).dataPoints[0]?.asDouble,
      1,
    );
  });

  it("bounds direct series and user attributes", async () => {
    const originalFetch = globalThis.fetch;
    let exportedSeries = 0;
    let firstAttributeCount = 0;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        const exported = body.resourceMetrics[0].scopeMetrics[0].metrics as Array<{
          sum: { dataPoints: Array<{ attributes: unknown[] }> };
        }>;
        exportedSeries += exported.length;
        firstAttributeCount ||= exported[0]?.sum.dataPoints[0]?.attributes.length ?? 0;
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        const manyAttributes = Object.fromEntries(
          Array.from({ length: 20 }, (_, index) => [`label_${index}`, String(index)]),
        );
        metrics.counter("vf_bounded_total", 1, manyAttributes);
        for (let index = 1; index <= 1_000; index++) {
          metrics.counter("vf_bounded_total", 1, { series: String(index) });
        }
        await metrics.flush();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(exportedSeries, 1_000);
    assertEquals(firstAttributeCount, 16);
  });

  it("rejects unsafe direct endpoints and headers without issuing requests", async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;
    globalThis.fetch = (() => {
      requestCount++;
      return Promise.resolve(new Response(null, { status: 200 }));
    }) as typeof fetch;

    try {
      await withEnv({
        OTEL_METRICS_ENABLED: "true",
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "file:///tmp/metrics",
      }, async () => {
        metrics.counter("vf_unsafe_endpoint_total");
      });
      await withEnv({
        OTEL_METRICS_ENABLED: "true",
        OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
        OTEL_EXPORTER_OTLP_METRICS_HEADERS: "Authorization=secret\r\nx-evil=1",
      }, async () => {
        metrics.counter("vf_unsafe_header_total");
      });
      await metrics.flush();
    } finally {
      globalThis.fetch = originalFetch;
    }

    assertEquals(requestCount, 0);
  });
});
