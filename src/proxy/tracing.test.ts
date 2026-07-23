import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals } from "#veryfront/testing/assert";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd";
import {
  _resetShimForTests,
  getGlobalTracerProvider,
  type Span,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import type { TracingExporter } from "#veryfront/extensions/observability/tracing-exporter.ts";
import {
  _resetOTLPForTests,
  endSpan,
  initializeOTLPWithApis,
  resolveOtlpGate,
  sanitizeProxySpanUrl,
  shutdownOTLP,
  startServerSpan,
} from "./tracing.ts";

const OTEL_ENV_KEYS = [
  "OTEL_TRACES_ENABLED",
  "OTEL_SERVICE_NAME",
  "OTEL_EXPORTER_OTLP_ENDPOINT",
  "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT",
] as const;

function setOtelEnv(vars: Partial<Record<(typeof OTEL_ENV_KEYS)[number], string>>): void {
  for (const key of OTEL_ENV_KEYS) {
    const value = vars[key];
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
}

function createFakeSpan(): Span {
  return {
    setAttribute: () => createFakeSpan(),
    setAttributes: () => createFakeSpan(),
    setStatus: () => createFakeSpan(),
    recordException: () => {},
    addEvent: () => createFakeSpan(),
    end: () => {},
    spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 1 }),
    updateName: () => {},
  } as unknown as Span;
}

function createFakeExporter(overrides: Partial<TracingExporter> = {}): {
  exporter: TracingExporter;
  calls: { start: number; shutdown: number };
} {
  const calls = { start: 0, shutdown: 0 };
  const fakeTracer: Tracer = {
    startSpan: () => createFakeSpan(),
    startActiveSpan: ((_name: string, ...rest: unknown[]) => {
      const fn = rest.find((arg) => typeof arg === "function") as
        | ((span: Span) => unknown)
        | undefined;
      return fn?.(createFakeSpan());
    }) as Tracer["startActiveSpan"],
  };
  const exporter: TracingExporter = {
    // deno-lint-ignore require-await
    start: async () => {
      calls.start++;
    },
    // deno-lint-ignore require-await
    export: async () => {},
    // deno-lint-ignore require-await
    shutdown: async () => {
      calls.shutdown++;
    },
    getProvider: () => ({ getTracer: () => fakeTracer }),
    getMetricsAPI: () => null,
    getTraceAPI: () => null,
    ...overrides,
  };
  return { exporter, calls };
}

describe("proxy otlp gate", () => {
  it("removes credentials, query values, and fragments from span URLs", () => {
    assertEquals(
      sanitizeProxySpanUrl(
        "https://user:password@api.example.test/path?access_token=secret&page=2#private",
      ),
      "https://api.example.test/path",
    );
    assertEquals(sanitizeProxySpanUrl("not a URL"), "[invalid-url]");
    assertEquals(sanitizeProxySpanUrl("file://example.test/runtime/config.json"), "[invalid-url]");
  });

  it("does not record raw upstream errors in span status or exceptions", () => {
    const recorded: unknown[] = [];
    const span = {
      ...createFakeSpan(),
      setStatus(status: unknown) {
        recorded.push(status);
        return this;
      },
      recordException(error: unknown) {
        recorded.push(
          error instanceof Error ? { name: error.name, message: error.message } : error,
        );
      },
    } as unknown as Span;

    endSpan(span, 502, new Error("token=span-secret at internal-host.example"));
    assertEquals(JSON.stringify(recorded).includes("span-secret"), false);
    assertEquals(JSON.stringify(recorded).includes("internal-host.example"), false);
  });

  it('disables tracing when OTEL_TRACES_ENABLED is not "true"', () => {
    const gate = resolveOtlpGate({ enabled: false, endpoint: "http://collector" });
    assertEquals(gate.ok, false);
    if (!gate.ok) assertEquals(gate.reason.includes("OTEL_TRACES_ENABLED"), true);
  });

  it("disables tracing when no OTLP endpoint is configured", () => {
    const gate = resolveOtlpGate({ enabled: true, endpoint: "" });
    assertEquals(gate.ok, false);
    if (!gate.ok) assertEquals(gate.reason.includes("OTLP endpoint"), true);
  });

  it("passes when tracing is enabled and an endpoint is set", () => {
    assertEquals(resolveOtlpGate({ enabled: true, endpoint: "http://collector" }).ok, true);
  });
});

describe("proxy otlp initialization", () => {
  const savedEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of OTEL_ENV_KEYS) savedEnv.set(key, Deno.env.get(key));
    _resetOTLPForTests();
    _resetShimForTests();
  });

  afterEach(async () => {
    await shutdownOTLP();
    _resetOTLPForTests();
    _resetShimForTests();
    for (const [key, value] of savedEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  });

  it("does not load the exporter when tracing is disabled", async () => {
    setOtelEnv({});
    let loaderCalls = 0;
    // deno-lint-ignore require-await
    await initializeOTLPWithApis(async () => {
      loaderCalls++;
      return createFakeExporter().exporter;
    });

    assertEquals(loaderCalls, 0);
    assertEquals(startServerSpan("GET", "/"), null);
  });

  it("starts the exporter and wires the shim provider when enabled", async () => {
    setOtelEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
      OTEL_SERVICE_NAME: "proxy-test",
    });
    const { exporter, calls } = createFakeExporter();
    const noopProvider = getGlobalTracerProvider();

    // deno-lint-ignore require-await
    await initializeOTLPWithApis(async () => exporter);

    assertEquals(calls.start, 1);
    assertNotEquals(getGlobalTracerProvider(), noopProvider);
    assertNotEquals(startServerSpan("GET", "/"), null);
  });

  it("prefers OTEL_EXPORTER_OTLP_TRACES_ENDPOINT as the endpoint gate", async () => {
    setOtelEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "http://127.0.0.1:9/v1/traces",
    });
    const { exporter, calls } = createFakeExporter();

    // deno-lint-ignore require-await
    await initializeOTLPWithApis(async () => exporter);

    assertEquals(calls.start, 1);
    assertNotEquals(startServerSpan("GET", "/"), null);
  });

  it("degrades gracefully when the exporter cannot be loaded", async () => {
    setOtelEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    });

    // deno-lint-ignore require-await
    await initializeOTLPWithApis(async () => null);

    assertEquals(startServerSpan("GET", "/"), null);
  });

  it("does not throw when exporter startup fails", async () => {
    setOtelEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    });
    const { exporter } = createFakeExporter({
      start: () => Promise.reject(new Error("collector unreachable")),
    });

    // deno-lint-ignore require-await
    await initializeOTLPWithApis(async () => exporter);

    assertEquals(startServerSpan("GET", "/"), null);
  });

  it("initializes only once", async () => {
    setOtelEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    });
    const { exporter, calls } = createFakeExporter();
    // deno-lint-ignore require-await
    const loader = async (): Promise<TracingExporter | null> => exporter;

    await initializeOTLPWithApis(loader);
    await initializeOTLPWithApis(loader);

    assertEquals(calls.start, 1);
  });

  it("makes concurrent callers await the same initialization", async () => {
    setOtelEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    });
    const { exporter } = createFakeExporter();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let loaderCalls = 0;
    const loader = async () => {
      loaderCalls++;
      await blocked;
      return exporter;
    };

    let secondSettled = false;
    const first = initializeOTLPWithApis(loader);
    const second = initializeOTLPWithApis(loader).finally(() => {
      secondSettled = true;
    });
    await Promise.resolve();
    assertEquals(loaderCalls, 1);
    assertEquals(secondSettled, false);

    release();
    await Promise.all([first, second]);
    assertEquals(secondSettled, true);
  });

  it("releases a partially started exporter and permits a retry", async () => {
    setOtelEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    });
    const failed = createFakeExporter({
      start: () => Promise.reject(new Error("collector unavailable")),
    });
    const succeeding = createFakeExporter();
    let attempts = 0;

    await initializeOTLPWithApis(async () => {
      attempts++;
      return attempts === 1 ? failed.exporter : succeeding.exporter;
    });
    await initializeOTLPWithApis(async () => {
      attempts++;
      return succeeding.exporter;
    });

    assertEquals(attempts, 2);
    assertEquals(failed.calls.shutdown, 1);
    assertEquals(succeeding.calls.start, 1);
    assertNotEquals(startServerSpan("GET", "/"), null);
  });

  it("flushes the exporter on shutdown and deactivates spans", async () => {
    setOtelEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    });
    const { exporter, calls } = createFakeExporter();
    // deno-lint-ignore require-await
    await initializeOTLPWithApis(async () => exporter);

    await shutdownOTLP();

    assertEquals(calls.shutdown, 1);
    assertEquals(startServerSpan("GET", "/"), null);
  });

  it("shutdown is safe when tracing was never initialized", async () => {
    await shutdownOTLP();
  });

  it("shutdown swallows exporter shutdown failures", async () => {
    setOtelEnv({
      OTEL_TRACES_ENABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:9",
    });
    const { exporter } = createFakeExporter({
      shutdown: () => Promise.reject(new Error("flush failed")),
    });
    // deno-lint-ignore require-await
    await initializeOTLPWithApis(async () => exporter);

    await shutdownOTLP();
  });
});
