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
import {
  runWithProjectEnv,
  runWithTrustedProjectEnv,
} from "#veryfront/server/project-env/storage.ts";
import {
  __resetLoggerConfigForTests,
  __subscribeLogRecordEmitter,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
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
      await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
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

  it("does not expose direct targets through inherited descriptor accessors", async () => {
    const observed: unknown[] = [];
    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-a",
      OTEL_METRICS_ENABLED: "true",
    }, async () => {
      await withMockFetch(
        (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch,
        async () => {
          Object.defineProperty(Object.prototype, "get", {
            configurable: true,
            get() {
              observed.push((this as { value?: unknown }).value);
              return undefined;
            },
          });
          Object.defineProperty(Object.prototype, "set", {
            configurable: true,
            get() {
              observed.push((this as { value?: unknown }).value);
              return undefined;
            },
          });
          try {
            runWithTrustedProjectEnv(
              {
                OTEL_METRICS_ENABLED: "true",
                OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
                OTEL_EXPORTER_OTLP_METRICS_HEADERS: "Authorization=Bearer private-token",
              },
              { projectId: "project-a", environmentId: "env-a" },
              () => metrics.counter("vf_descriptor_safety_total", 1),
            );
          } finally {
            delete (Object.prototype as { get?: unknown }).get;
            delete (Object.prototype as { set?: unknown }).set;
          }
          await metrics.__flushForTests();
        },
      );
    });

    assertEquals(observed, []);
  });

  it("keeps exporting after a non-ok collector response", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let status = 500;

    Deno.env.set("OTEL_METRICS_ENABLED", "true");
    Deno.env.set("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/otlp");
    Deno.env.set("OTEL_SERVICE_NAME", "veryfront-server");

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      return Promise.resolve(new Response("", { status }));
    }) as typeof fetch;

    try {
      metrics.counter("vf_rejected_batch_total", 1, { project_id: "project-123" });
      assertEquals(
        await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests(),
        undefined,
        "a non-ok collector response must not reject the flush",
      );
      assertEquals(requests.length, 1, "the rejected batch must still have been sent once");

      status = 200;
      metrics.counter("vf_recovered_batch_total", 1, { project_id: "project-123" });
      await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OTEL_METRICS_ENABLED");
      Deno.env.delete("OTEL_EXPORTER_OTLP_ENDPOINT");
      Deno.env.delete("OTEL_SERVICE_NAME");
    }

    assertEquals(requests.length, 2, "the next batch must still be exported");
    const body = JSON.parse(String(requests[1]?.init?.body));
    assertEquals(
      body.resourceMetrics[0].scopeMetrics[0].metrics.map((entry: { name: string }) => entry.name),
      ["vf_recovered_batch_total"],
      "a non-ok collector response degrades silently and does not poison the queue",
    );
  });

  it("keeps exporting after the collector request rejects", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    let failing = true;

    Deno.env.set("OTEL_METRICS_ENABLED", "true");
    Deno.env.set("OTEL_EXPORTER_OTLP_ENDPOINT", "https://collector.example/otlp");
    Deno.env.set("OTEL_SERVICE_NAME", "veryfront-server");

    globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), init });
      if (failing) return Promise.reject(new TypeError("network down"));
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;

    try {
      metrics.counter("vf_unreachable_batch_total", 1, { project_id: "project-123" });
      assertEquals(
        await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests(),
        undefined,
        "a failed collector request must not reject out of the flush timer",
      );
      assertEquals(requests.length, 1, "the failed batch must still have been attempted once");

      failing = false;
      metrics.counter("vf_reachable_batch_total", 1, { project_id: "project-123" });
      await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
    } finally {
      globalThis.fetch = originalFetch;
      Deno.env.delete("OTEL_METRICS_ENABLED");
      Deno.env.delete("OTEL_EXPORTER_OTLP_ENDPOINT");
      Deno.env.delete("OTEL_SERVICE_NAME");
    }

    assertEquals(requests.length, 2, "the next batch must still be exported");
    const body = JSON.parse(String(requests[1]?.init?.body));
    assertEquals(
      body.resourceMetrics[0].scopeMetrics[0].metrics.map((entry: { name: string }) => entry.name),
      ["vf_reachable_batch_total"],
      "a network failure degrades silently and does not poison the queue",
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
      await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
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
      "http://veryfront-api:80/internal/metrics/otlp/v1/metrics",
    );
    assertEquals(
      (requests[0]?.init?.headers as Record<string, string>).Authorization,
      "Basic aW50ZXJuYWwtdXNlcjppbnRlcm5hbC1wYXNz",
    );
  });

  it("does not expose internal metrics credentials to a replaced Base64 encoder", async () => {
    const originalBtoa = Object.getOwnPropertyDescriptor(globalThis, "btoa");
    const observedValues: string[] = [];
    const requests: RequestInit[] = [];

    await withEnv({
      OTEL_METRICS_ENABLED: "true",
      VERYFRONT_API_BASE_URL: "http://veryfront-api:80",
      VERYFRONT_API_INTERNAL_USER: "internal-user",
      VERYFRONT_API_INTERNAL_PASS: "internal-pass",
    }, async () => {
      await withMockFetch(
        ((_url: string | URL | Request, init?: RequestInit) => {
          requests.push(init ?? {});
          return Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          Object.defineProperty(globalThis, "btoa", {
            configurable: true,
            writable: true,
            value: (value: string) => {
              observedValues.push(value);
              return "forged-authorization";
            },
          });
          try {
            metrics.counter("vf_internal_metric_total", 1);
            await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
          } finally {
            if (originalBtoa) Object.defineProperty(globalThis, "btoa", originalBtoa);
            else Reflect.deleteProperty(globalThis, "btoa");
          }
        },
      );
    });

    assertEquals(observedValues, []);
    assertEquals(
      (requests[0]?.headers as Record<string, string>).Authorization,
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
          await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
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

  it("never exports one environment's queued samples to another environment's OTLP target", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-victim,env-attacker",
      OTEL_METRICS_ENABLED: "true",
      VERYFRONT_API_BASE_URL: "http://veryfront-api:80",
      VERYFRONT_API_INTERNAL_USER: "internal-user",
      VERYFRONT_API_INTERNAL_PASS: "internal-pass",
    }, async () => {
      await withMockFetch(
        ((url: string | URL | Request, init?: RequestInit) => {
          requests.push({ url: String(url), init });
          return Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          // A victim environment enqueues a sample bound for the internal proxy.
          metrics.counter("vf_victim_metric_total", 1, { project_id: "victim-project" });

          // A co-located environment configured with its own OTLP endpoint then
          // enqueues a sample and the flush fires under ITS project-env context —
          // exactly the ambient context the flush timer inherits in production.
          await runWithProjectEnv({
            OTEL_METRICS_ENABLED: "true",
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://attacker.example/v1/metrics",
            OTEL_EXPORTER_OTLP_METRICS_HEADERS: "x-api-key=attacker-key",
          }, async () => {
            metrics.counter("vf_attacker_metric_total", 1, { project_id: "attacker-project" });
            await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
          });
        },
      );
    });

    assertEquals(requests.length, 2, "each environment's samples must be exported separately");

    const byUrl = new Map(requests.map((request) => [request.url, request]));
    const internalRequest = byUrl.get("http://veryfront-api:80/internal/metrics/otlp/v1/metrics");
    const attackerRequest = byUrl.get("https://attacker.example/v1/metrics");

    const internalMetrics = JSON.parse(String(internalRequest?.init?.body))
      .resourceMetrics[0].scopeMetrics[0].metrics.map((entry: { name: string }) => entry.name);
    assertEquals(
      internalMetrics,
      ["vf_victim_metric_total"],
      "the victim's sample must go to the target bound when it was enqueued",
    );

    const attackerMetrics = JSON.parse(String(attackerRequest?.init?.body))
      .resourceMetrics[0].scopeMetrics[0].metrics.map((entry: { name: string }) => entry.name);
    assertEquals(
      attackerMetrics,
      ["vf_attacker_metric_total"],
      "a project-configured OTLP endpoint must never receive other environments' samples",
    );
    assertEquals(
      (attackerRequest?.init?.headers as Record<string, string>).Authorization,
      undefined,
      "internal proxy credentials must never reach a project-configured endpoint",
    );
  });

  it("exports later target groups when the first endpoint stalls", async () => {
    const requestedUrls: string[] = [];

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-project,env-internal",
      OTEL_METRICS_ENABLED: "true",
      VERYFRONT_API_BASE_URL: "http://veryfront-api:80",
      VERYFRONT_API_INTERNAL_USER: "internal-user",
      VERYFRONT_API_INTERNAL_PASS: "internal-pass",
    }, async () => {
      await withMockFetch(
        ((url: string | URL | Request, init?: RequestInit) => {
          const requestedUrl = String(url);
          requestedUrls[requestedUrls.length] = requestedUrl;
          if (requestedUrl !== "https://stalled.example/v1/metrics") {
            return Promise.resolve(new Response("{}", { status: 200 }));
          }

          return new Promise<Response>((resolve) => {
            const finish = () => resolve(new Response("{}", { status: 504 }));
            if (init?.signal?.aborted) {
              finish();
            } else {
              init?.signal?.addEventListener("abort", finish, { once: true });
            }
          });
        }) as typeof fetch,
        async () => {
          metrics.__setDirectExportTimeoutForTests(25);
          await runWithProjectEnv({
            OTEL_METRICS_ENABLED: "true",
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://stalled.example/v1/metrics",
          }, () => {
            metrics.counter("vf_stalled_metric_total", 1);
          });
          metrics.counter("vf_internal_metric_total", 1);

          await metrics.__flushForTests();
        },
      );
    });

    assertEquals(requestedUrls, [
      "https://stalled.example/v1/metrics",
      "http://veryfront-api:80/internal/metrics/otlp/v1/metrics",
    ]);
  });

  it("dispatches another project while a tenant target pipeline is stalled", async () => {
    const requestedUrls: string[] = [];
    const stalledResponse = Promise.withResolvers<Response>();

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-a,env-b",
      OTEL_METRICS_ENABLED: "true",
    }, async () => {
      await withMockFetch(
        ((url: string | URL | Request) => {
          const requestedUrl = String(url);
          requestedUrls[requestedUrls.length] = requestedUrl;
          return requestedUrl === "https://stalled.example/v1/metrics"
            ? stalledResponse.promise
            : Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          metrics.__setDirectExportTimeoutForTests(5_000);
          runWithTrustedProjectEnv(
            {
              OTEL_METRICS_ENABLED: "true",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://stalled.example/v1/metrics",
            },
            { projectId: "project-a", environmentId: "env-a" },
            () => {
              for (let index = 0; index < 1_000; index++) {
                metrics.counter("vf_stalled_metric_total", 1);
              }
            },
          );

          runWithTrustedProjectEnv(
            {
              OTEL_METRICS_ENABLED: "true",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://later.example/v1/metrics",
            },
            { projectId: "project-b", environmentId: "env-b" },
            () => metrics.counter("vf_later_metric_total", 1),
          );
          const flush = metrics.__flushForTests();
          for (let attempt = 0; attempt < 20 && requestedUrls.length < 2; attempt++) {
            await Promise.resolve();
          }

          assertEquals(requestedUrls, [
            "https://stalled.example/v1/metrics",
            "https://later.example/v1/metrics",
          ]);
          stalledResponse.resolve(new Response("{}", { status: 200 }));
          await flush;
        },
      );
    });
  });

  it("does not expose internal metrics credentials to replaced target-grouping intrinsics", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const observed: string[] = [];
    const nativeStringify = JSON.stringify;
    const nativePush = Array.prototype.push;
    const nativeIterator = Array.prototype[Symbol.iterator];
    const nativeToJSONDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
    const nativeDefineProperty = Object.defineProperty;
    const nativeIndexDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "0");
    const recordObserved = (value: string): void => {
      nativeDefineProperty(observed, String(observed.length), {
        value,
        configurable: true,
        enumerable: true,
        writable: true,
      });
    };

    // Record every value a replaced intrinsic would be able to read. Each spy
    // delegates to the captured native so behaviour is unchanged.
    const record = (values: unknown[]): void => {
      for (let index = 0; index < values.length; index++) {
        const value = values[index];
        if (typeof value === "string") {
          recordObserved(value);
          continue;
        }
        try {
          recordObserved(String(nativeStringify(value)));
        } catch {
          // Unserializable values cannot carry the credential as data.
        }
      }
    };

    const nativeEntries = Object.entries;
    const nativeMap = Array.prototype.map;
    const nativeSplice = Array.prototype.splice;
    const nativeSort = Array.prototype.sort;
    const nativeLocaleCompare = String.prototype.localeCompare;
    const nativeMapSet = Map.prototype.set;

    const restore = () => {
      Object.entries = nativeEntries;
      Array.prototype.map = nativeMap;
      Array.prototype.push = nativePush;
      Array.prototype.splice = nativeSplice;
      Array.prototype.sort = nativeSort;
      String.prototype.localeCompare = nativeLocaleCompare;
      Map.prototype.set = nativeMapSet;
      JSON.stringify = nativeStringify;
      Array.prototype[Symbol.iterator] = nativeIterator;
      if (nativeToJSONDescriptor) {
        nativeDefineProperty(Array.prototype, "toJSON", nativeToJSONDescriptor);
      } else {
        delete (Array.prototype as { toJSON?: unknown }).toJSON;
      }
      if (nativeIndexDescriptor) {
        nativeDefineProperty(Array.prototype, "0", nativeIndexDescriptor);
      } else {
        delete Array.prototype[0];
      }
    };

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-1,env-2",
      OTEL_METRICS_ENABLED: "true",
      VERYFRONT_API_BASE_URL: "http://veryfront-api:80",
      VERYFRONT_API_INTERNAL_USER: "internal-user",
      VERYFRONT_API_INTERNAL_PASS: "internal-pass",
    }, async () => {
      await withMockFetch(
        ((url: string | URL | Request, init?: RequestInit) => {
          nativeDefineProperty(requests, String(requests.length), {
            value: { url: String(url), init },
            configurable: true,
            enumerable: true,
            writable: true,
          });
          return Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          Object.entries = ((value: object) => {
            record([value]);
            return nativeEntries(value);
          }) as typeof Object.entries;
          Array.prototype.map = function (this: unknown[], callback, thisArg?) {
            record([this]);
            return nativeMap.call(this, callback, thisArg);
          } as typeof Array.prototype.map;
          Array.prototype.push = function (this: unknown[], ...values: unknown[]) {
            record([this, ...values]);
            const incoming = values.find((value) =>
              typeof value === "object" && value !== null && "targetKey" in value
            ) as { targetKey?: unknown } | undefined;
            if (typeof incoming?.targetKey === "string") {
              for (const queued of this) {
                if (typeof queued === "object" && queued !== null && "targetKey" in queued) {
                  (queued as { targetKey?: unknown }).targetKey = incoming.targetKey;
                }
              }
            }
            return nativePush.apply(this, values);
          } as typeof Array.prototype.push;
          Array.prototype.splice = function (
            this: unknown[],
            start: number,
            deleteCount?: number,
            ...items: unknown[]
          ) {
            record([this, ...items]);
            return Reflect.apply(
              nativeSplice,
              this,
              deleteCount === undefined ? [start] : [start, deleteCount, ...items],
            );
          } as typeof Array.prototype.splice;
          Array.prototype.sort = function (this: unknown[], compare?) {
            record([this]);
            return nativeSort.call(this, compare) as unknown[];
          } as typeof Array.prototype.sort;
          String.prototype.localeCompare = function (this: string, that: string) {
            record([String(this), that]);
            return nativeLocaleCompare.call(String(this), that);
          } as typeof String.prototype.localeCompare;
          Map.prototype.set = function (this: Map<unknown, unknown>, key, value) {
            record([key, value]);
            return nativeMapSet.call(this, key, value) as Map<unknown, unknown>;
          } as typeof Map.prototype.set;
          JSON.stringify = ((value: unknown, replacer?, space?) => {
            record([value]);
            return nativeStringify(
              value,
              replacer as (this: unknown, key: string, value: unknown) => unknown,
              space,
            );
          }) as typeof JSON.stringify;
          Array.prototype[Symbol.iterator] = function () {
            for (let index = 0; index < this.length; index++) {
              const value = this[index];
              if (typeof value === "string") recordObserved(value);
              if (Array.isArray(value)) {
                if (typeof value[0] === "string") recordObserved(value[0]);
                if (typeof value[1] === "string") recordObserved(value[1]);
              }
            }
            return Reflect.apply(nativeIterator, this, []);
          };
          nativeDefineProperty(Array.prototype, "toJSON", {
            value: function (this: unknown[]) {
              for (let index = 0; index < this.length; index++) {
                const value = this[index];
                if (typeof value === "string") recordObserved(value);
                if (Array.isArray(value)) {
                  if (typeof value[0] === "string") recordObserved(value[0]);
                  if (typeof value[1] === "string") recordObserved(value[1]);
                }
              }
              return this;
            },
            configurable: true,
          });
          nativeDefineProperty(Array.prototype, "0", {
            set(value: unknown) {
              record([value]);
              nativeDefineProperty(this, "0", {
                value,
                configurable: true,
                enumerable: true,
                writable: true,
              });
            },
            configurable: true,
          });

          try {
            // Two distinct targets so the flush must group by target identity,
            // which is where the credential-bearing headers get compared.
            metrics.counter("vf_internal_metric_total", 1, {
              project_id: "project-1",
              tenant_marker: "private-telemetry",
            });
            await runWithProjectEnv({
              OTEL_METRICS_ENABLED: "true",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
            }, async () => {
              metrics.counter("vf_project_metric_total", 1, { project_id: "project-2" });
              await (metrics as unknown as { __flushForTests(): Promise<void> })
                .__flushForTests();
            });
          } finally {
            restore();
          }
        },
      );
    });

    assertEquals(requests.length, 2, "both targets must still be exported");
    const exportedNames = new Map(
      requests.map((request) => [
        request.url,
        JSON.parse(String(request.init?.body)).resourceMetrics[0].scopeMetrics[0].metrics.map(
          (metric: { name: string }) => metric.name,
        ),
      ]),
    );
    assertEquals(
      exportedNames.get("http://veryfront-api:80/internal/metrics/otlp/v1/metrics"),
      ["vf_internal_metric_total"],
    );
    assertEquals(
      exportedNames.get("https://collector.example/v1/metrics"),
      ["vf_project_metric_total"],
    );

    const encodedCredential = "aW50ZXJuYWwtdXNlcjppbnRlcm5hbC1wYXNz";
    const leaked = observed.filter((value) =>
      value.includes(encodedCredential) || value.includes("internal-pass") ||
      value.includes("vf_internal_metric_total") || value.includes("private-telemetry")
    );
    assertEquals(
      leaked,
      [],
      "target grouping and serialization must not expose credentials or queued telemetry to replaceable intrinsics",
    );
  });

  it("bounds distinct direct targets created from mutable project environment values", async () => {
    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-project",
      OTEL_METRICS_ENABLED: "true",
    }, async () => {
      await withMockFetch(
        (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch,
        async () => {
          const requestContext = {
            projectId: "forged-request-0",
            projectSlug: "forged-request",
            token: "token",
          };
          await runWithRequestContext(requestContext, async () => {
            for (let index = 0; index < 150; index++) {
              requestContext.projectId = `forged-request-${index}`;
              runWithTrustedProjectEnv(
                {
                  OTEL_METRICS_ENABLED: "true",
                  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
                  OTEL_SERVICE_NAME: `project-${index}`,
                  VERYFRONT_PROJECT_ID: `forged-project-${index}`,
                },
                { projectId: "project-a", environmentId: "env-a" },
                () => metrics.counter("vf_project_metric_total", 1),
              );
            }
            await metrics.__flushForTests();
          });
          runWithTrustedProjectEnv(
            {
              OTEL_METRICS_ENABLED: "true",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
              OTEL_SERVICE_NAME: "project-b",
              VERYFRONT_PROJECT_ID: "forged-project-a",
            },
            { projectId: "project-b", environmentId: "env-b" },
            () => metrics.counter("vf_project_metric_total", 1),
          );
          await metrics.__flushForTests();
        },
      );
    });

    assertEquals(metrics.__getDirectTargetCountForTests(), 17);
  });

  it("applies tenant target quotas to metrics routed through the internal proxy", async () => {
    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-project",
      OTEL_METRICS_ENABLED: "true",
      VERYFRONT_API_BASE_URL: "http://veryfront-api:80",
      VERYFRONT_API_INTERNAL_USER: "internal-user",
      VERYFRONT_API_INTERNAL_PASS: "internal-pass",
    }, async () => {
      await withMockFetch(
        (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch,
        async () => {
          for (let index = 0; index < 150; index++) {
            runWithTrustedProjectEnv(
              {
                OTEL_METRICS_ENABLED: "true",
                OTEL_SERVICE_NAME: `project-${index}`,
              },
              { projectId: "project-a", environmentId: "env-a" },
              () => metrics.counter("vf_project_metric_total", 1),
            );
          }
          await metrics.__flushForTests();
          runWithTrustedProjectEnv(
            {
              OTEL_METRICS_ENABLED: "true",
              OTEL_SERVICE_NAME: "project-b",
            },
            { projectId: "project-b", environmentId: "env-b" },
            () => metrics.counter("vf_project_metric_total", 1),
          );
          await metrics.__flushForTests();
        },
      );
    });

    assertEquals(metrics.__getDirectTargetCountForTests(), 17);
  });

  it("evicts credential-bearing targets without consulting Array species", async () => {
    let speciesCalls = 0;
    const originalSpecies = Object.getOwnPropertyDescriptor(Array, Symbol.species);
    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-project",
      OTEL_METRICS_ENABLED: "true",
      VERYFRONT_API_BASE_URL: "http://veryfront-api:80",
      VERYFRONT_API_INTERNAL_USER: "internal-user",
      VERYFRONT_API_INTERNAL_PASS: "internal-pass",
    }, async () => {
      await withMockFetch(
        (() => Promise.resolve(new Response("{}", { status: 200 }))) as typeof fetch,
        async () => {
          for (let index = 0; index < 16; index++) {
            runWithTrustedProjectEnv(
              { OTEL_METRICS_ENABLED: "true", OTEL_SERVICE_NAME: `project-${index}` },
              { projectId: "project-a", environmentId: "env-a" },
              () => metrics.counter("vf_project_metric_total", 1),
            );
          }
          await metrics.__flushForTests();

          Object.defineProperty(Array, Symbol.species, {
            get() {
              speciesCalls++;
              return Array;
            },
            configurable: true,
          });
          try {
            runWithTrustedProjectEnv(
              { OTEL_METRICS_ENABLED: "true", OTEL_SERVICE_NAME: "project-new" },
              { projectId: "project-a", environmentId: "env-a" },
              () => metrics.counter("vf_project_metric_total", 1),
            );
          } finally {
            if (originalSpecies) Object.defineProperty(Array, Symbol.species, originalSpecies);
          }
        },
      );
    });

    assertEquals(speciesCalls, 0);
  });

  it("dispatches every target without consulting Promise species", async () => {
    const requestedUrls: string[] = [];
    const originalSpecies = Object.getOwnPropertyDescriptor(Promise, Symbol.species);
    await withEnv({ OTEL_METRICS_ENABLED: "true" }, async () => {
      await withMockFetch(
        ((url: string | URL | Request) => {
          requestedUrls.push(String(url));
          return Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          await runWithProjectEnv({
            OTEL_METRICS_ENABLED: "true",
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://first.example/v1/metrics",
          }, () => metrics.counter("vf_first_total", 1));
          await runWithProjectEnv({
            OTEL_METRICS_ENABLED: "true",
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://second.example/v1/metrics",
          }, () => metrics.counter("vf_second_total", 1));

          Object.defineProperty(Promise, Symbol.species, {
            get() {
              throw new Error("Promise species must not run");
            },
            configurable: true,
          });
          let flush: Promise<void>;
          try {
            flush = metrics.__flushForTests();
          } finally {
            if (originalSpecies) Object.defineProperty(Promise, Symbol.species, originalSpecies);
          }
          await flush;
        },
      );
    });

    assertEquals(requestedUrls.sort(), [
      "https://first.example/v1/metrics",
      "https://second.example/v1/metrics",
    ]);
  });

  it("keeps in-flight direct targets inside the global bound", async () => {
    let activeRequests = 0;
    let maxActiveRequests = 0;
    let requestCount = 0;
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    const firstGate = new Promise<void>((resolve) => releaseFirst = resolve);
    const secondGate = new Promise<void>((resolve) => releaseSecond = resolve);

    await withEnv({ OTEL_METRICS_ENABLED: "true" }, async () => {
      await withMockFetch(
        (async () => {
          requestCount++;
          activeRequests++;
          if (activeRequests > maxActiveRequests) maxActiveRequests = activeRequests;
          await (requestCount <= 16 ? firstGate : secondGate);
          activeRequests--;
          return new Response("{}", { status: 200 });
        }) as typeof fetch,
        async () => {
          for (let index = 0; index < 16; index++) {
            await runWithProjectEnv({
              OTEL_METRICS_ENABLED: "true",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
              OTEL_SERVICE_NAME: `first-${index}`,
              VERYFRONT_PROJECT_ID: "project-a",
            }, () => metrics.counter("vf_project_metric_total", 1));
          }
          const firstFlush = metrics.__flushForTests();
          for (let attempt = 0; attempt < 10 && requestCount < 16; attempt++) {
            await Promise.resolve();
          }

          for (let index = 0; index < 16; index++) {
            await runWithProjectEnv({
              OTEL_METRICS_ENABLED: "true",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://collector.example/v1/metrics",
              OTEL_SERVICE_NAME: `first-${index}`,
              VERYFRONT_PROJECT_ID: "project-a",
            }, () => metrics.counter("vf_project_metric_total", 1));
          }
          const secondFlush = metrics.__flushForTests();
          await Promise.resolve();
          assertEquals(requestCount, 16);
          releaseFirst();
          for (let attempt = 0; attempt < 20 && requestCount < 32; attempt++) {
            await Promise.resolve();
          }
          releaseSecond();
          await Promise.all([firstFlush, secondFlush]);

          assertEquals(requestCount, 32);
          assertEquals(maxActiveRequests, 16);
          assertEquals(metrics.__getDirectTargetCountForTests(), 16);
        },
      );
    });
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
        await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    assertEquals(requests.length, 1);
    assertEquals(
      requests[0]?.url,
      "http://veryfront-api:80/internal/metrics/otlp/v1/metrics",
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
      await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
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
    assertEquals(metric.histogram.dataPoints[0].count, 2);
    assertEquals(metric.histogram.dataPoints[0].sum, 162);
    assertEquals(
      metric.histogram.dataPoints[0].explicitBounds,
      [0, 10, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
      "exported histogram must carry the documented bucket boundaries",
    );
    assertEquals(
      metric.histogram.dataPoints[0].bucketCounts,
      [0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0],
      "42ms lands in the (10,50] bucket and 120ms in the (100,250] bucket",
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
      await (metrics as unknown as { __flushForTests(): Promise<void> }).__flushForTests();
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

  it("keeps accepting a tenant's samples while its own export is in flight", async () => {
    const bodies: string[] = [];
    const stalled = Promise.withResolvers<Response>();

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-a",
      OTEL_METRICS_ENABLED: "true",
    }, async () => {
      await withMockFetch(
        ((_url: string | URL | Request, init?: RequestInit) => {
          bodies[bodies.length] = String(init?.body);
          return bodies.length === 1
            ? stalled.promise
            : Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          metrics.__setDirectExportTimeoutForTests(5_000);
          const emit = (name: string) =>
            runWithTrustedProjectEnv(
              {
                OTEL_METRICS_ENABLED: "true",
                OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://tenant.example/v1/metrics",
              },
              { projectId: "project-a", environmentId: "env-a" },
              () => metrics.counter(name, 1),
            );

          // One full batch leaves the queue immediately and sits on the wire.
          for (let index = 0; index < 100; index++) emit("vf_batched_metric_total");
          assertEquals(bodies.length, 1, "the full batch must already be exporting");

          emit("vf_late_metric_total");
          stalled.resolve(new Response("{}", { status: 200 }));
          await metrics.__flushForTests();
        },
      );
    });

    assertEquals(
      bodies.length,
      2,
      "samples emitted while an export is in flight must not consume the pending quota",
    );
    assertEquals(
      JSON.parse(String(bodies[1])).resourceMetrics[0].scopeMetrics[0].metrics.map((
        entry: { name: string },
      ) => entry.name),
      ["vf_late_metric_total"],
    );
  });

  it("keeps cumulative direct totals separate per export target", async () => {
    const requests: Array<{ url: string; body: string }> = [];

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-a,env-b",
      OTEL_METRICS_ENABLED: "true",
    }, async () => {
      await withMockFetch(
        ((url: string | URL | Request, init?: RequestInit) => {
          requests[requests.length] = { url: String(url), body: String(init?.body) };
          return Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          const emitTo = (endpoint: string) =>
            runWithProjectEnv({
              OTEL_METRICS_ENABLED: "true",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: endpoint,
            }, () => {
              metrics.counter("vf_shared_metric_total", 1, { outcome: "pass" });
              metrics.histogram("vf_shared_latency_ms", 42, { outcome: "pass" });
            });

          emitTo("https://first.example/v1/metrics");
          await metrics.__flushForTests();
          emitTo("https://second.example/v1/metrics");
          await metrics.__flushForTests();
        },
      );
    });

    assertEquals(requests.length, 2);
    assertEquals(requests[1]?.url, "https://second.example/v1/metrics");
    const exported = JSON.parse(String(requests[1]?.body))
      .resourceMetrics[0].scopeMetrics[0].metrics;
    assertEquals(
      exported[0].sum.dataPoints[0].asDouble,
      1,
      "a counter total must not carry another target's accumulated value",
    );
    assertEquals(
      exported[1].histogram.dataPoints[0].count,
      1,
      "a histogram total must not carry another target's accumulated count",
    );
  });

  it("takes resource attributes from the enqueue-time target, not the flushing context", async () => {
    const requests: Array<{ url: string; body: string }> = [];

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-a,env-b",
      OTEL_METRICS_ENABLED: "true",
    }, async () => {
      await withMockFetch(
        ((url: string | URL | Request, init?: RequestInit) => {
          requests[requests.length] = { url: String(url), body: String(init?.body) };
          return Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          runWithProjectEnv({
            OTEL_METRICS_ENABLED: "true",
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://enqueued.example/v1/metrics",
            OTEL_SERVICE_NAME: "enqueue-time-service",
          }, () => metrics.counter("vf_enqueued_total", 1));

          // The flush runs under a different environment's context, exactly as
          // the shared flush timer does in a dedicated runtime.
          await runWithProjectEnv({
            OTEL_METRICS_ENABLED: "true",
            OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://flusher.example/v1/metrics",
            OTEL_SERVICE_NAME: "flush-time-service",
          }, async () => {
            metrics.counter("vf_flusher_total", 1);
            await metrics.__flushForTests();
          });
        },
      );
    });

    const serviceNameOf = (url: string): string =>
      JSON.parse(
        String(requests.find((request) => request.url === url)?.body),
      ).resourceMetrics[0].resource.attributes.find(
        (attribute: { key: string }) => attribute.key === "service.name",
      ).value.stringValue;

    assertEquals(requests.length, 2);
    assertEquals(
      serviceNameOf("https://enqueued.example/v1/metrics"),
      "enqueue-time-service",
      "resource attributes must describe the environment that enqueued the sample",
    );
    assertEquals(
      serviceNameOf("https://flusher.example/v1/metrics"),
      "flush-time-service",
    );
  });

  it("keeps tenants with an empty trusted project id in separate quota buckets", async () => {
    const requestedUrls: string[] = [];
    const stalled = Promise.withResolvers<Response>();

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-a,env-b",
      OTEL_METRICS_ENABLED: "true",
    }, async () => {
      await withMockFetch(
        ((url: string | URL | Request) => {
          const requestedUrl = String(url);
          requestedUrls[requestedUrls.length] = requestedUrl;
          return requestedUrl === "https://tenant-a.example/v1/metrics"
            ? stalled.promise
            : Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          metrics.__setDirectExportTimeoutForTests(5_000);
          // Both runtimes report an empty project id, so only the slug tells
          // the two tenants apart.
          for (let index = 0; index < 200; index++) {
            runWithTrustedProjectEnv(
              {
                OTEL_METRICS_ENABLED: "true",
                OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://tenant-a.example/v1/metrics",
              },
              { projectId: "", projectSlug: "tenant-a", environmentId: "env-a" },
              () => metrics.counter("vf_tenant_a_total", 1),
            );
          }
          runWithTrustedProjectEnv(
            {
              OTEL_METRICS_ENABLED: "true",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://tenant-b.example/v1/metrics",
            },
            { projectId: "", projectSlug: "tenant-b", environmentId: "env-b" },
            () => metrics.counter("vf_tenant_b_total", 1),
          );

          stalled.resolve(new Response("{}", { status: 200 }));
          await metrics.__flushForTests();
        },
      );
    });

    assertEquals(
      requestedUrls.some((requested) => requested === "https://tenant-b.example/v1/metrics"),
      true,
      "one tenant saturating its quota must not silence a different tenant",
    );
  });

  it("keeps project ids and project slugs in separate quota namespaces", async () => {
    const requestedUrls: string[] = [];
    const stalled = Promise.withResolvers<Response>();

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-a,env-b",
      OTEL_METRICS_ENABLED: "true",
    }, async () => {
      await withMockFetch(
        ((url: string | URL | Request) => {
          const requestedUrl = String(url);
          requestedUrls[requestedUrls.length] = requestedUrl;
          return requestedUrl === "https://tenant-id.example/v1/metrics"
            ? stalled.promise
            : Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          metrics.__setDirectExportTimeoutForTests(5_000);
          for (let index = 0; index < 200; index++) {
            runWithTrustedProjectEnv(
              {
                OTEL_METRICS_ENABLED: "true",
                OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://tenant-id.example/v1/metrics",
              },
              { projectId: "shared-identity", projectSlug: "tenant-a", environmentId: "env-a" },
              () => metrics.counter("vf_project_id_scope_total", 1),
            );
          }
          runWithTrustedProjectEnv(
            {
              OTEL_METRICS_ENABLED: "true",
              OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://tenant-slug.example/v1/metrics",
            },
            { projectId: "", projectSlug: "shared-identity", environmentId: "env-b" },
            () => metrics.counter("vf_project_slug_scope_total", 1),
          );

          stalled.resolve(new Response("{}", { status: 200 }));
          await metrics.__flushForTests();
        },
      );
    });

    assertEquals(
      new Set(requestedUrls).has("https://tenant-slug.example/v1/metrics"),
      true,
      "an id and slug with equal text must not share a capacity scope",
    );
  });

  it("reserves queue capacity for platform metrics when tenants saturate the queue", async () => {
    const requestedUrls: string[] = [];
    const stalled = Promise.withResolvers<Response>();
    const tenantUrl = (tenant: number) => `https://tenant-${tenant}.example/v1/metrics`;
    const stalledTenantUrls = new Set([1, 2, 3, 4, 5, 6].map(tenantUrl));

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-1,env-2,env-3,env-4,env-5,env-6",
      OTEL_METRICS_ENABLED: "true",
      VERYFRONT_API_BASE_URL: "http://veryfront-api:80",
      VERYFRONT_API_INTERNAL_USER: "internal-user",
      VERYFRONT_API_INTERNAL_PASS: "internal-pass",
    }, async () => {
      await withMockFetch(
        ((url: string | URL | Request) => {
          const requestedUrl = String(url);
          requestedUrls[requestedUrls.length] = requestedUrl;
          return stalledTenantUrls.has(requestedUrl)
            ? stalled.promise
            : Promise.resolve(new Response("{}", { status: 200 }));
        }) as typeof fetch,
        async () => {
          metrics.__setDirectExportTimeoutForTests(5_000);
          const emitTenantSamples = (tenant: number, count: number) => {
            for (let index = 0; index < count; index++) {
              runWithTrustedProjectEnv(
                {
                  OTEL_METRICS_ENABLED: "true",
                  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: tenantUrl(tenant),
                },
                { projectId: `project-${tenant}`, environmentId: `env-${tenant}` },
                () => metrics.counter("vf_tenant_metric_total", 1),
              );
            }
          };

          // Every tenant endpoint stalls, so tenant samples pile up against the
          // shared queue bound.
          for (let tenant = 1; tenant <= 5; tenant++) emitTenantSamples(tenant, 300);
          const droppedBeforeOverflow = metrics.__getDroppedDirectSampleCountForTests();
          emitTenantSamples(6, 1);
          assertEquals(
            metrics.__getDroppedDirectSampleCountForTests() > droppedBeforeOverflow,
            true,
            "tenant traffic must stop at the tenant share of the queue",
          );

          // A platform metric carries no tenant scope and must still be queued.
          metrics.counter("vf_platform_metric_total", 1);

          stalled.resolve(new Response("{}", { status: 200 }));
          await metrics.__flushForTests();
        },
      );
    });

    assertEquals(
      requestedUrls.some((requested) =>
        requested === "http://veryfront-api:80/internal/metrics/otlp/v1/metrics"
      ),
      true,
      "the platform reserve must keep internal metrics exportable under tenant load",
    );
  });

  it("reports dropped direct samples instead of discarding them silently", async () => {
    const records: LogEntry[] = [];
    const stalled = Promise.withResolvers<Response>();
    let unsubscribe = () => {};

    await withEnv({
      SERVER_ID: "server-1",
      ENVIRONMENT_IDS: "env-a",
      OTEL_METRICS_ENABLED: "true",
      LOG_LEVEL: "DEBUG",
    }, async () => {
      __resetLoggerConfigForTests();
      unsubscribe = __subscribeLogRecordEmitter((record) => {
        records[records.length] = record;
      });
      try {
        await withMockFetch(
          ((url: string | URL | Request) => {
            return String(url) === "https://tenant.example/v1/metrics"
              ? stalled.promise
              : Promise.resolve(new Response("{}", { status: 200 }));
          }) as typeof fetch,
          async () => {
            metrics.__setDirectExportTimeoutForTests(5_000);
            for (let index = 0; index < 301; index++) {
              runWithTrustedProjectEnv(
                {
                  OTEL_METRICS_ENABLED: "true",
                  OTEL_EXPORTER_OTLP_METRICS_ENDPOINT: "https://tenant.example/v1/metrics",
                },
                { projectId: "project-a", environmentId: "env-a" },
                () => metrics.counter("vf_tenant_metric_total", 1),
              );
            }

            stalled.resolve(new Response("{}", { status: 200 }));
            await metrics.__flushForTests();
          },
        );
      } finally {
        unsubscribe();
        __resetLoggerConfigForTests();
      }
    });

    assertEquals(
      metrics.__getDroppedDirectSampleCountForTests() > 0,
      true,
      "an over-quota sample must be counted",
    );
    assertEquals(
      records.some((record) => record.message === "metrics: direct OTLP sample dropped"),
      true,
      "an over-quota drop must be observable in the logs",
    );
  });
});
