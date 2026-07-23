import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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
import { metrics } from "./index.ts";
import { shutdownProjectMetrics } from "./lifecycle.ts";
import { flushMetricsForTests, resetMetricsForTests } from "./testing.ts";

describe("metrics public SDK", () => {
  afterEach(() => {
    _resetShimForTests();
    resetMetricsForTests();
  });

  it("exposes only the documented metric operations", () => {
    assertEquals(Object.keys(metrics).sort(), ["counter", "gauge", "histogram"]);
  });

  it("rejects invalid instrument names and values before recording", () => {
    assertThrows(
      () => metrics.counter("1_invalid", 1),
      TypeError,
      "Metric names must begin with an ASCII letter",
    );
    assertThrows(
      () => metrics.counter("vf_negative_total", -1),
      RangeError,
      "non-negative",
    );
    assertThrows(
      () => metrics.histogram("vf_invalid_histogram", Number.NaN),
      RangeError,
      "finite",
    );
    assertThrows(
      () => metrics.gauge("vf_invalid_gauge", Number.POSITIVE_INFINITY),
      RangeError,
      "finite",
    );
    assertThrows(
      () => metrics.counter("vf_invalid_attribute_total", 1, { score: Number.NaN }),
      RangeError,
      "finite",
    );
    assertThrows(
      () => metrics.counter("vf_empty_attribute_total", 1, { "": "value" }),
      TypeError,
      "must not be empty",
    );
    assertThrows(
      () => metrics.counter("vf_large_attribute_total", 1, { value: "x".repeat(4_097) }),
      RangeError,
      "4096 UTF-8 bytes",
    );
    assertThrows(
      () =>
        metrics.counter("vf_object_attribute_total", 1, {
          value: {} as unknown as string,
        }),
      TypeError,
      "string, number, or boolean",
    );
    assertThrows(
      () =>
        metrics.counter(
          "vf_many_attributes_total",
          1,
          Object.fromEntries(
            Array.from({ length: 129 }, (_, index) => [`attribute_${index}`, "value"]),
          ),
        ),
      RangeError,
      "at most 128 attributes",
    );
    metrics.counter(
      "vf_null_attributes_total",
      1,
      Object.fromEntries(
        Array.from({ length: 129 }, (_, index) => [`unused_${index}`, null]),
      ),
    );
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

  it("rebinds cached instruments when the global metrics API changes", () => {
    const calls: string[] = [];
    const createApi = (label: string) =>
      ({
        getMeter() {
          return {
            createCounter() {
              return {
                add() {
                  calls.push(label);
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
      }) as MetricsAPI;

    setGlobalMetricsAPI(createApi("first"));
    metrics.counter("vf_provider_revision_total");
    setGlobalMetricsAPI(createApi("second"));
    metrics.counter("vf_provider_revision_total");

    assertEquals(calls, ["first", "second"]);
  });

  it("bounds dynamic instrument definitions consistently", () => {
    for (let index = 0; index < 1_000; index += 1) {
      metrics.counter(`vf_dynamic_${index}`);
    }
    assertThrows(
      () => metrics.counter("vf_dynamic_overflow"),
      RangeError,
      "1000 counter instruments",
    );
  });

  it("bounds observable gauge cardinality without dropping project context", async () => {
    let callback: ((result: ObservableResult) => void) | undefined;
    const observedAttributes: Array<Record<string, unknown> | undefined> = [];
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

    for (let index = 0; index < 1_999; index += 1) {
      metrics.gauge("vf_cardinality_gauge", index, { series: String(index) });
    }
    await runWithRequestContext({
      projectId: "project-123",
      projectSlug: "demo-project",
      productionMode: true,
      token: "token",
    }, async () => {
      for (let index = 1_999; index < 2_010; index += 1) {
        metrics.gauge("vf_cardinality_gauge", index, { series: String(index) });
      }
    });
    callback?.({
      observe(_value, attributes) {
        observedAttributes.push(attributes);
      },
    });

    assertEquals(observedAttributes.length, 2_000);
    assertEquals(
      observedAttributes.some((attributes) => attributes?.["otel.metric.overflow"] === true),
      true,
    );
    assertEquals(
      observedAttributes.find((attributes) => attributes?.["otel.metric.overflow"] === true)
        ?.["project_id"],
      "project-123",
    );
  });

  it("is a no-op when no metrics API is installed", () => {
    metrics.counter("vf_missing_provider_total");
    metrics.histogram("vf_missing_provider_ms", 1);
    metrics.gauge("vf_missing_provider_gauge", 1);
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
      await flushMetricsForTests();
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
      new Headers(requests[0]?.init?.headers).get("Authorization"),
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
      await flushMetricsForTests();
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
      new Headers(requests[0]?.init?.headers).get("Authorization"),
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
          OTEL_RESOURCE_ATTRIBUTES: "deployment.environment.name=prod%20eu,service.name=ignored",
          OTEL_SERVICE_NAME: "veryfront-ops-agent",
        }, async () => {
          metrics.counter("vf_eval_result_total", 1, { project_id: "project-123" });
          await flushMetricsForTests();
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requests.length, 1);
    assertEquals(requests[0]?.url, "https://otlp.datadoghq.eu/v1/metrics");
    assertEquals(
      new Headers(requests[0]?.init?.headers).get("dd-api-key"),
      "project-key",
    );

    const body = JSON.parse(String(requests[0]?.init?.body));
    assertEquals(
      body.resourceMetrics[0].resource.attributes.find(
        (attr: { key: string }) => attr.key === "service.name",
      ).value.stringValue,
      "veryfront-ops-agent",
    );
    assertEquals(
      body.resourceMetrics[0].resource.attributes.find(
        (attr: { key: string }) => attr.key === "deployment.environment.name",
      ).value.stringValue,
      "prod eu",
    );
  });

  it("defers explicitly unsupported OTLP protocols to the installed SDK", async () => {
    let sdkCalls = 0;
    let directCalls = 0;
    const originalFetch = globalThis.fetch;
    setGlobalMetricsAPI({
      getMeter() {
        return {
          createCounter() {
            return {
              add() {
                sdkCalls += 1;
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

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_PROTOCOL: "grpc",
      VERYFRONT_API_BASE_URL: "",
      VERYFRONT_API_INTERNAL_USER: "",
      VERYFRONT_API_INTERNAL_PASS: "",
    }, async () => {
      globalThis.fetch = (() => {
        directCalls += 1;
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;
      try {
        metrics.counter("vf_sdk_protocol_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(sdkCalls, 1);
    assertEquals(directCalls, 0);
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
        await flushMetricsForTests();
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
      new Headers(requests[0]?.init?.headers).get("Authorization"),
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
      const options = { description: "Eval duration", unit: "ms" };
      metrics.histogram("vf_eval_duration_ms", 42, { project_id: "project-123" }, options);
      metrics.histogram("vf_eval_duration_ms", 120, { project_id: "project-123" }, options);
      await flushMetricsForTests();
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OTEL_METRICS_ENABLED");
      Deno.env.delete("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT");
    }

    assertEquals(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.init?.body));
    const emittedMetrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
    assertEquals(emittedMetrics.length, 1);
    const metric = emittedMetrics[0];
    assertEquals(metric.name, "vf_eval_duration_ms");
    assertEquals(metric.description, "Eval duration");
    assertEquals(metric.unit, "ms");
    assertEquals(metric.histogram.aggregationTemporality, 2);
    assertEquals(metric.histogram.dataPoints[0].count, "2");
    assertEquals(metric.histogram.dataPoints[0].sum, 162);
    assertEquals(
      metric.histogram.dataPoints[0].bucketCounts.reduce(
        (sum: number, count: string) => sum + Number(count),
        0,
      ),
      2,
    );
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
      metrics.gauge("vf_queue_depth", 4, { project_id: "project-123" });
      await flushMetricsForTests();
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OTEL_METRICS_ENABLED");
      Deno.env.delete("OTEL_EXPORTER_OTLP_METRICS_ENDPOINT");
    }

    assertEquals(requests.length, 1);
    const body = JSON.parse(String(requests[0]?.init?.body));
    const metric = body.resourceMetrics[0].scopeMetrics[0].metrics[0];
    assertEquals(metric.name, "vf_queue_depth");
    assertEquals(metric.gauge.dataPoints.length, 1);
    assertEquals(metric.gauge.dataPoints[0].asDouble, 4);
  });

  it("keeps direct counters cumulative across export batches", async () => {
    const originalFetch = globalThis.fetch;
    const totals: number[] = [];

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        totals.push(body.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asDouble);
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_cumulative_total", 1);
        await flushMetricsForTests();
        metrics.counter("vf_cumulative_total", 2);
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(totals, [1, 3]);
  });

  it("keeps cumulative payloads finite when aggregates overflow", async () => {
    const originalFetch = globalThis.fetch;
    let emittedMetrics: Array<Record<string, unknown>> = [];

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body));
        emittedMetrics = body.resourceMetrics[0].scopeMetrics[0].metrics;
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_large_total", Number.MAX_VALUE);
        metrics.counter("vf_large_total", Number.MAX_VALUE);
        metrics.histogram("vf_large_distribution", Number.MAX_VALUE);
        metrics.histogram("vf_large_distribution", Number.MAX_VALUE);
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    const counter = emittedMetrics.find((metric) => metric.name === "vf_large_total") as {
      sum: { dataPoints: Array<{ asDouble: number }> };
    };
    const histogram = emittedMetrics.find(
      (metric) => metric.name === "vf_large_distribution",
    ) as { histogram: { dataPoints: Array<Record<string, unknown>> } };
    assertEquals(counter.sum.dataPoints[0]?.asDouble, Number.MAX_VALUE);
    assertEquals(Object.hasOwn(histogram.histogram.dataPoints[0] ?? {}, "sum"), false);
  });

  it("keeps signal-specific endpoints unchanged", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/custom-metrics?tenant=demo",
    }, async () => {
      globalThis.fetch = ((url: string | URL | Request) => {
        urls.push(String(url));
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_endpoint_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(urls, ["https://collector.example/custom-metrics?tenant=demo"]);
  });

  it("treats empty signal settings as unset", async () => {
    const originalFetch = globalThis.fetch;
    let url: string | undefined;
    let fallbackHeader: string | null = null;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "",
      OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example/base",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "",
      OTEL_EXPORTER_OTLP_HEADERS: "x-fallback=enabled",
      OTEL_EXPORTER_OTLP_PROTOCOL: "",
      OTEL_EXPORTER_OTLP_COMPRESSION: "",
    }, async () => {
      globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
        url = String(input);
        fallbackHeader = new Headers(init?.headers).get("x-fallback");
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_empty_signal_config_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(url, "https://collector.example/base/v1/metrics");
    assertEquals(fallbackHeader, "enabled");
  });

  it("honors gzip compression without changing the OTLP payload", async () => {
    const originalFetch = globalThis.fetch;
    let contentEncoding: string | null = null;
    let compressedBody: BodyInit | null | undefined;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_COMPRESSION: "gzip",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        contentEncoding = new Headers(init?.headers).get("Content-Encoding");
        compressedBody = init?.body;
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_gzip_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    const compressedStream = new Response(compressedBody).body;
    const decompressed = compressedStream
      ? await new Response(compressedStream.pipeThrough(new DecompressionStream("gzip"))).json()
      : null;
    assertEquals(contentEncoding, "gzip");
    assertEquals(
      decompressed.resourceMetrics[0].scopeMetrics[0].metrics[0].name,
      "vf_gzip_total",
    );
  });

  it("isolates queued samples and resources by project export destination", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; body: Record<string, unknown> }> = [];

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-1",
      OTEL_METRICS_ENABLED: "",
      VERYFRONT_API_BASE_URL: "",
      VERYFRONT_API_INTERNAL_USER: "",
      VERYFRONT_API_INTERNAL_PASS: "",
    }, async () => {
      globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
        requests.push({
          url: String(url),
          body: JSON.parse(String(init?.body)) as Record<string, unknown>,
        });
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        await runWithProjectEnv({
          OTEL_METRICS_ENABLED: "true",
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://one.example/ingest",
          OTEL_SERVICE_NAME: "project-one",
        }, () => {
          metrics.counter("vf_project_total", 1, { project_id: "one" });
        });
        await runWithProjectEnv({
          OTEL_METRICS_ENABLED: "true",
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://two.example/ingest",
          OTEL_SERVICE_NAME: "project-two",
        }, () => {
          metrics.counter("vf_project_total", 2, { project_id: "two" });
        });
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requests.map((request) => request.url).sort(), [
      "https://one.example/ingest",
      "https://two.example/ingest",
    ]);
    const serviceNames = requests.map((request) => {
      const resourceMetrics = request.body.resourceMetrics as Array<Record<string, unknown>>;
      const resource = resourceMetrics[0]?.resource as Record<string, unknown>;
      const attributes = resource.attributes as Array<{
        key: string;
        value: { stringValue?: string };
      }>;
      return attributes.find((attribute) => attribute.key === "service.name")?.value.stringValue;
    }).sort();
    assertEquals(serviceNames, ["project-one", "project-two"]);
    const routedSeries = requests.map((request) => {
      const resourceMetrics = request.body.resourceMetrics as Array<Record<string, unknown>>;
      const scopeMetrics = resourceMetrics[0]?.scopeMetrics as Array<Record<string, unknown>>;
      const emittedMetrics = scopeMetrics[0]?.metrics as Array<{
        sum: {
          dataPoints: Array<{
            asDouble: number;
            attributes: Array<{ key: string; value: { stringValue?: string } }>;
          }>;
        };
      }>;
      const point = emittedMetrics[0]?.sum.dataPoints[0];
      const projectId = point?.attributes.find((attribute) => attribute.key === "project_id")
        ?.value.stringValue;
      return `${new URL(request.url).hostname}:${projectId}:${point?.asDouble}`;
    }).sort();
    assertEquals(routedSeries, ["one.example:one:1", "two.example:two:2"]);
  });

  it("bounds concurrent exports across destinations", async () => {
    const originalFetch = globalThis.fetch;
    const pending: Array<() => void> = [];
    let active = 0;
    let maximumActive = 0;
    let requestCount = 0;

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-1",
      OTEL_METRICS_ENABLED: "",
      VERYFRONT_API_BASE_URL: "",
      VERYFRONT_API_INTERNAL_USER: "",
      VERYFRONT_API_INTERNAL_PASS: "",
    }, async () => {
      globalThis.fetch = (() => {
        requestCount += 1;
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        return new Promise<Response>((resolve) => {
          pending.push(() => {
            active -= 1;
            resolve(new Response(null, { status: 200 }));
          });
        });
      }) as typeof fetch;

      try {
        for (let index = 0; index < 5; index += 1) {
          await runWithProjectEnv({
            OTEL_METRICS_ENABLED: "true",
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `https://project-${index}.example/metrics`,
          }, () => {
            metrics.counter("vf_concurrency_total", 1, { project: String(index) });
          });
        }

        const flushing = flushMetricsForTests();
        for (let spin = 0; spin < 100 && pending.length < 4; spin += 1) {
          await Promise.resolve();
        }
        assertEquals(pending.length, 4);
        pending.splice(0).forEach((resolve) => resolve());

        for (let spin = 0; spin < 100 && requestCount < 5; spin += 1) {
          await Promise.resolve();
        }
        assertEquals(requestCount, 5);
        pending.splice(0).forEach((resolve) => resolve());
        await flushing;
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(maximumActive, 4);
  });

  it("does not let shared project env override the host export target", async () => {
    const originalFetch = globalThis.fetch;
    const urls: string[] = [];

    await withEnv({
      SERVER_ID: "",
      ENVIRONMENT_IDS: "",
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://platform.example/metrics",
    }, async () => {
      globalThis.fetch = ((url: string | URL | Request) => {
        urls.push(String(url));
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        await runWithProjectEnv({
          OTEL_METRICS_ENABLED: "true",
          OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://tenant.example/metrics",
        }, () => {
          metrics.counter("vf_shared_total");
        });
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(urls, ["https://platform.example/metrics"]);
  });

  it("retries transient responses with the same immutable payload", async () => {
    const originalFetch = globalThis.fetch;
    const bodies: string[] = [];
    let attempt = 0;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        bodies.push(String(init?.body));
        attempt += 1;
        return Promise.resolve(
          attempt === 1
            ? new Response(null, { status: 503, headers: { "Retry-After": "0" } })
            : new Response(null, { status: 200 }),
        );
      }) as typeof fetch;

      try {
        metrics.counter("vf_retry_total", 2);
        await flushMetricsForTests();
        metrics.counter("vf_retry_total", 1);
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(bodies.length, 3);
    assertEquals(bodies[0], bodies[1]);
    const nextBody = JSON.parse(bodies[2] ?? "{}");
    assertEquals(
      nextBody.resourceMetrics[0].scopeMetrics[0].metrics[0].sum.dataPoints[0].asDouble,
      3,
    );
  });

  it("aborts timed-out exports and retries them", async () => {
    const originalFetch = globalThis.fetch;
    let attempt = 0;
    let firstSignalAborted = false;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: "1",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        attempt += 1;
        if (attempt > 1) return Promise.resolve(new Response(null, { status: 200 }));

        return new Promise<Response>(() => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => {
            firstSignalAborted = true;
          }, { once: true });
        });
      }) as typeof fetch;

      try {
        metrics.counter("vf_timeout_retry_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(firstSignalAborted, true);
    assertEquals(attempt, 2);
  });

  it("does not retry permanent collector responses", async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = (() => {
        requestCount += 1;
        return Promise.resolve(new Response(null, { status: 400 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_permanent_failure_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requestCount, 1);
  });

  it("bounds shutdown export work and stops accepting new samples", async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
    }, async () => {
      globalThis.fetch = (() => {
        requestCount += 1;
        return Promise.resolve(
          new Response(null, { status: 503, headers: { "Retry-After": "0" } }),
        );
      }) as typeof fetch;

      try {
        metrics.counter("vf_shutdown_total");
        await shutdownProjectMetrics(100);
        metrics.counter("vf_after_shutdown_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requestCount, 1);
  });

  it("does not start queued exports after the shutdown deadline", async () => {
    const originalFetch = globalThis.fetch;
    let requestCount = 0;

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-1",
      OTEL_METRICS_ENABLED: "",
      VERYFRONT_API_BASE_URL: "",
      VERYFRONT_API_INTERNAL_USER: "",
      VERYFRONT_API_INTERNAL_PASS: "",
    }, async () => {
      globalThis.fetch = (() => {
        requestCount += 1;
        return new Promise<Response>(() => {});
      }) as typeof fetch;

      try {
        for (let index = 0; index < 5; index += 1) {
          await runWithProjectEnv({
            OTEL_METRICS_ENABLED: "true",
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: `https://project-${index}.example/metrics`,
            OTEL_EXPORTER_OTLP_METRICS_TIMEOUT: "5",
          }, () => {
            metrics.counter("vf_shutdown_queue_total", 1, { project: String(index) });
          });
        }

        await shutdownProjectMetrics(1);
        await new Promise((resolve) => setTimeout(resolve, 25));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requestCount, 4);
  });

  it("logs only sanitized exporter failure metadata", async () => {
    const originalFetch = globalThis.fetch;
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];

    await withEnv({
      VERYFRONT_DEBUG: "1",
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "authorization=Bearer secret-token",
    }, async () => {
      console.warn = (...args: unknown[]) => warnings.push(args);
      globalThis.fetch = (() =>
        Promise.resolve(new Response("private collector detail", { status: 400 }))) as typeof fetch;

      try {
        metrics.counter("vf_sanitized_failure_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
        console.warn = originalWarn;
      }
    });

    const serializedWarnings = JSON.stringify(warnings);
    assertEquals(warnings.length, 1);
    assertEquals(serializedWarnings.includes("400"), true);
    assertEquals(serializedWarnings.includes("secret-token"), false);
    assertEquals(serializedWarnings.includes("private collector detail"), false);
    assertEquals(serializedWarnings.includes("collector.example"), false);
  });

  it("encodes Unicode internal credentials as UTF-8 Basic auth", async () => {
    const originalFetch = globalThis.fetch;
    let authorization: string | undefined;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      VERYFRONT_API_BASE_URL: "https://api.example",
      VERYFRONT_API_INTERNAL_USER: "väl",
      VERYFRONT_API_INTERNAL_PASS: "påss",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        authorization = new Headers(init?.headers).get("Authorization") ?? undefined;
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_unicode_auth_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(authorization, "Basic dsOkbDpww6Vzcw==");
  });

  it("decodes percent-encoded OTLP header values", async () => {
    const originalFetch = globalThis.fetch;
    let apiKey: string | null = null;

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
      OTEL_EXPORTER_OTLP_METRICS_HEADERS: "x-api-key=hello%20world",
    }, async () => {
      globalThis.fetch = ((_url: string | URL | Request, init?: RequestInit) => {
        apiKey = new Headers(init?.headers).get("x-api-key");
        return Promise.resolve(new Response(null, { status: 200 }));
      }) as typeof fetch;

      try {
        metrics.counter("vf_header_total");
        await flushMetricsForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(apiKey, "hello world");
  });
});
