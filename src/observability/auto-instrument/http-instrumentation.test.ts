import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AttributeValue,
  type Context,
  getGlobalTracerProvider,
  propagation,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
  type Tracer,
  type TracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import { createInstrumentedFetch, instrumentHttpHandler } from "./http-instrumentation.ts";

const PRIVATE_HOST_CANARY = "private-customer.example";
const PRIVATE_PROJECT_CANARY = "private-project-canary";
const PRIVATE_FILE_CANARY = "private-file-canary";
const PRIVATE_RELEASE_CANARY = "private-release-canary";
const PRIVATE_CUSTOMER_CANARY = "private-customer-canary";
const PRIVATE_QUERY_CANARY = "private-query-canary";
const PRIVATE_FRAGMENT_CANARY = "private-fragment-canary";
const PRIVATE_USERINFO_CANARY = "private-userinfo-canary";
const PRIVATE_ERROR_CANARY = "private-error-canary";

type RecordedSpan = {
  name: string;
  initialAttributes: Record<string, AttributeValue>;
  attributes: Record<string, AttributeValue>;
  statuses: Array<{ code: number; message?: string }>;
  exceptions: unknown[];
  events: Array<{ name: string; attributes?: Record<string, AttributeValue> }>;
  endCalls: number;
};

type RecordingTracerOptions = {
  throwFromHooks?: boolean;
  throwAfterCallback?: boolean;
};

function createRecordingProvider(options: RecordingTracerOptions = {}): {
  provider: TracerProvider;
  spans: RecordedSpan[];
} {
  const spans: RecordedSpan[] = [];
  const spanContext: SpanContext = {
    traceId: "00000000000000000000000000000001",
    spanId: "0000000000000001",
    traceFlags: 1,
  };

  function createSpan(
    name: string,
    initialAttributes: Record<string, AttributeValue> = {},
  ): Span {
    const recording: RecordedSpan = {
      name,
      initialAttributes: { ...initialAttributes },
      attributes: {},
      statuses: [],
      exceptions: [],
      events: [],
      endCalls: 0,
    };
    spans.push(recording);

    const span: Span = {
      setAttribute(key, value) {
        recording.attributes[key] = value;
        if (options.throwFromHooks) throw new Error("tracer-set-attribute-failure");
        return span;
      },
      setAttributes(attributes) {
        Object.assign(recording.attributes, attributes);
        if (options.throwFromHooks) throw new Error("tracer-set-attributes-failure");
        return span;
      },
      setStatus(status) {
        recording.statuses.push(status);
        if (options.throwFromHooks) throw new Error("tracer-set-status-failure");
        return span;
      },
      recordException(error) {
        recording.exceptions.push(error);
        if (options.throwFromHooks) throw new Error("tracer-record-exception-failure");
      },
      addEvent(name, attributes) {
        recording.events.push({ name, attributes });
        if (options.throwFromHooks) throw new Error("tracer-add-event-failure");
        return span;
      },
      end() {
        recording.endCalls++;
        if (options.throwFromHooks) throw new Error("tracer-end-failure");
      },
      spanContext() {
        return spanContext;
      },
      updateName() {},
    };

    return span;
  }

  const tracer: Tracer = {
    startSpan(name, spanOptions) {
      return createSpan(name, spanOptions?.attributes);
    },
    startActiveSpan<T>(
      name: string,
      optionsOrCallback:
        | { kind?: number; attributes?: Record<string, AttributeValue> }
        | ((span: Span) => T),
      contextOrCallback?: Context | ((span: Span) => T),
      callback?: (span: Span) => T,
    ): T {
      const spanOptions = typeof optionsOrCallback === "function" ? undefined : optionsOrCallback;
      const invoke = typeof optionsOrCallback === "function"
        ? optionsOrCallback
        : typeof contextOrCallback === "function"
        ? contextOrCallback
        : callback!;
      const result = invoke(createSpan(name, spanOptions?.attributes));
      if (!options.throwAfterCallback) return result;

      if (result instanceof Promise) {
        return result.then(() => {
          throw new Error("tracer-after-callback-failure");
        }) as T;
      }
      throw new Error("tracer-after-callback-failure");
    },
  };

  return {
    spans,
    provider: { getTracer: () => tracer },
  };
}

async function withRecordingProvider<T>(
  options: RecordingTracerOptions,
  run: (spans: RecordedSpan[]) => Promise<T>,
): Promise<T> {
  const originalProvider = getGlobalTracerProvider();
  const recording = createRecordingProvider(options);
  setGlobalTracerProvider(recording.provider);
  try {
    return await run(recording.spans);
  } finally {
    setGlobalTracerProvider(originalProvider);
  }
}

function assertNoPrivateCanaries(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (
    const canary of [
      PRIVATE_HOST_CANARY,
      PRIVATE_PROJECT_CANARY,
      PRIVATE_FILE_CANARY,
      PRIVATE_RELEASE_CANARY,
      PRIVATE_CUSTOMER_CANARY,
      PRIVATE_QUERY_CANARY,
      PRIVATE_FRAGMENT_CANARY,
      PRIVATE_USERINFO_CANARY,
      PRIVATE_ERROR_CANARY,
    ]
  ) {
    assertEquals(serialized.includes(canary), false, `telemetry exposed ${canary}`);
  }
}

describe("observability/auto-instrument/http-instrumentation", () => {
  it("keeps fetch attributes bounded and preserves Request headers", async () => {
    await withRecordingProvider({}, async (spans) => {
      let calls = 0;
      let receivedHeaders = new Headers();
      const baseFetch = ((_input: RequestInfo | URL, init?: RequestInit) => {
        calls++;
        receivedHeaders = new Headers(init?.headers);
        return Promise.resolve(
          new Response("ok", { status: 200, headers: { "content-length": "2" } }),
        );
      }) as typeof fetch;
      const instrumented = createInstrumentedFetch(baseFetch);
      const request = new Request(
        `https://${PRIVATE_HOST_CANARY}/projects/${PRIVATE_PROJECT_CANARY}/files/${PRIVATE_FILE_CANARY}/releases/${PRIVATE_RELEASE_CANARY}/customers/${PRIVATE_CUSTOMER_CANARY}?value=${PRIVATE_QUERY_CANARY}#${PRIVATE_FRAGMENT_CANARY}`,
        { method: "POST", headers: { "x-existing": "preserved" } },
      );

      const response = await instrumented(request);

      assertEquals(await response.text(), "ok");
      assertEquals(calls, 1);
      assertEquals(receivedHeaders.get("x-existing"), "preserved");
      assertEquals(spans[0]?.name, "http.client.fetch");
      assertEquals(spans[0]?.initialAttributes, {
        "http.method": "POST",
        "http.scheme": "https",
      });
      assertNoPrivateCanaries(spans);
    });
  });

  it("injects only trace-context headers and preserves application authorization", async () => {
    propagation.setGlobalPropagator({
      inject(_context, carrier, setter) {
        setter?.set(carrier, "traceparent", "00-trace-span-01");
        setter?.set(carrier, "authorization", "Bearer telemetry-private-value");
        setter?.set(carrier, "baggage", "customer=private-value");
      },
      extract(context) {
        return context;
      },
      fields: () => ["traceparent", "authorization", "baggage"],
    });
    let receivedHeaders = new Headers();

    try {
      const instrumented = createInstrumentedFetch(
        ((_input, init) => {
          receivedHeaders = new Headers(init?.headers);
          return Promise.resolve(new Response("ok"));
        }) as typeof fetch,
      );
      await instrumented("https://example.invalid", {
        headers: { authorization: "Bearer application-value" },
      });

      assertEquals(receivedHeaders.get("traceparent"), "00-trace-span-01");
      assertEquals(receivedHeaders.get("authorization"), "Bearer application-value");
      assertEquals(receivedHeaders.has("baggage"), false);
    } finally {
      propagation.setGlobalPropagator({
        inject() {},
        extract(context) {
          return context;
        },
        fields: () => [],
      });
    }
  });

  it("omits concrete server request identity unless a route template is explicit", async () => {
    await withRecordingProvider({}, async (spans) => {
      const handler = instrumentHttpHandler(
        () => new Response("ok"),
        { routeTemplate: "/projects/{project}/files/{file}" },
      );
      await handler(
        new Request(
          `https://${PRIVATE_HOST_CANARY}/projects/${PRIVATE_PROJECT_CANARY}/files/${PRIVATE_FILE_CANARY}?value=${PRIVATE_QUERY_CANARY}`,
          { method: "GET" },
        ),
      );

      assertEquals(spans[0]?.name, "http.server.request");
      assertEquals(spans[0]?.initialAttributes, {
        "http.method": "GET",
        "http.scheme": "https",
        "http.route": "/projects/{project}/files/{file}",
      });
      assertNoPrivateCanaries(spans);
    });
  });

  it("does not record raw fetch errors or stringify thrown values", async () => {
    await withRecordingProvider({}, async (spans) => {
      const thrown = {
        get toString(): never {
          throw new Error(`${PRIVATE_ERROR_CANARY}-stringification`);
        },
      };
      let calls = 0;
      const instrumented = createInstrumentedFetch(
        (() => {
          calls++;
          throw thrown;
        }) as unknown as typeof fetch,
      );

      let caught: unknown;
      try {
        await instrumented(
          `https://${PRIVATE_USERINFO_CANARY}@${PRIVATE_HOST_CANARY}/${PRIVATE_PROJECT_CANARY}`,
        );
      } catch (error) {
        caught = error;
      }

      assertEquals(caught, thrown);
      assertEquals(calls, 1);
      assertEquals(spans[0]?.exceptions, []);
      assertEquals(spans[0]?.statuses.at(-1), { code: 2 });
      assertEquals(spans[0]?.attributes["error.category"], "thrown_object");
      assertNoPrivateCanaries(spans);
    });
  });

  it("preserves a successful fetch when tracer hooks fail after invocation", async () => {
    await withRecordingProvider(
      { throwFromHooks: true, throwAfterCallback: true },
      async () => {
        let calls = 0;
        const instrumented = createInstrumentedFetch(
          (() => {
            calls++;
            return Promise.resolve(new Response("application-result"));
          }) as typeof fetch,
        );

        const response = await instrumented("https://example.invalid/stable");

        assertEquals(await response.text(), "application-result");
        assertEquals(calls, 1);
      },
    );
  });

  it("preserves a successful handler result when response metadata access fails", async () => {
    await withRecordingProvider({}, async () => {
      const applicationResponse = {
        get status(): never {
          throw new Error("private-response-status-canary");
        },
        get headers(): never {
          throw new Error("private-response-headers-canary");
        },
      } as unknown as Response;
      let calls = 0;
      const handler = instrumentHttpHandler(() => {
        calls++;
        return applicationResponse;
      });

      const result = await handler(new Request("https://example.invalid/stable"));

      assertEquals(result, applicationResponse);
      assertEquals(calls, 1);
    });
  });

  it("falls back to one unchanged fetch when propagation injection fails", async () => {
    const originalProvider = getGlobalTracerProvider();
    const recording = createRecordingProvider();
    setGlobalTracerProvider(recording.provider);
    propagation.setGlobalPropagator({
      inject() {
        throw new Error("private-propagator-error-canary");
      },
      extract(context) {
        return context;
      },
      fields: () => [],
    });
    let calls = 0;
    let receivedInit: RequestInit | undefined;
    const originalInit: RequestInit = { headers: { "x-existing": "preserved" } };

    try {
      const instrumented = createInstrumentedFetch(
        ((_input, init) => {
          calls++;
          receivedInit = init;
          return Promise.resolve(new Response("application-result"));
        }) as typeof fetch,
      );

      const response = await instrumented("https://example.invalid/health", originalInit);

      assertEquals(await response.text(), "application-result");
      assertEquals(calls, 1);
      assertEquals(receivedInit, originalInit);
    } finally {
      propagation.setGlobalPropagator({
        inject() {},
        extract(context) {
          return context;
        },
        fields: () => [],
      });
      setGlobalTracerProvider(originalProvider);
    }
  });

  it("preserves the original handler failure when tracer hooks fail", async () => {
    await withRecordingProvider(
      { throwFromHooks: true, throwAfterCallback: true },
      async () => {
        class PrivateErrorCanary extends Error {}
        const applicationError = new PrivateErrorCanary(PRIVATE_ERROR_CANARY);
        applicationError.cause = `${PRIVATE_PROJECT_CANARY}-cause`;
        let calls = 0;
        const instrumented = instrumentHttpHandler(() => {
          calls++;
          throw applicationError;
        });

        let caught: unknown;
        try {
          await instrumented(new Request(`https://${PRIVATE_HOST_CANARY}/private/path`));
        } catch (error) {
          caught = error;
        }

        assertEquals(caught, applicationError);
        assertEquals(calls, 1);
      },
    );
  });
});
