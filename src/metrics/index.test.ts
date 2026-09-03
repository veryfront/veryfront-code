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
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
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

  it("does not expose internal metrics credentials to replaced target-grouping intrinsics", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    const observed: string[] = [];
    const nativeStringify = JSON.stringify;

    // Record every value a replaced intrinsic would be able to read. Each spy
    // delegates to the captured native so behaviour is unchanged.
    const record = (values: unknown[]): void => {
      for (const value of values) {
        if (typeof value === "string") {
          observed[observed.length] = value;
          continue;
        }
        try {
          observed[observed.length] = String(nativeStringify(value));
        } catch {
          // Unserializable values cannot carry the credential as data.
        }
      }
    };

    const nativeEntries = Object.entries;
    const nativeMap = Array.prototype.map;
    const nativePush = Array.prototype.push;
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
          requests[requests.length] = { url: String(url), init };
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

          try {
            // Two distinct targets so the flush must group by target identity,
            // which is where the credential-bearing headers get compared.
            metrics.counter("vf_internal_metric_total", 1, { project_id: "project-1" });
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

    const encodedCredential = "aW50ZXJuYWwtdXNlcjppbnRlcm5hbC1wYXNz";
    const leaked = observed.filter((value) =>
      value.includes(encodedCredential) || value.includes("internal-pass")
    );
    assertEquals(
      leaked,
      [],
      "target grouping must never pass the internal proxy credential through a replaceable intrinsic",
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
});
