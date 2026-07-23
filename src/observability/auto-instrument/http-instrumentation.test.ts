import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalContextAccessor,
  setGlobalTracerProvider,
  type Span,
  type Tracer,
} from "../tracing/api-shim.ts";
import { createInstrumentedFetch, instrumentHttpHandler } from "./http-instrumentation.ts";

type SpanFailure = "setAttributes" | "recordException" | "end";
type ActiveSpanBehavior = "duplicate" | "omit" | "replace" | "throw-after";

function installTracer(
  failure?: SpanFailure,
  onStart?: (attributes: Record<string, AttributeValue>) => void,
  observers: {
    onAttributes?: (attributes: Record<string, AttributeValue>) => void;
    onStatus?: (status: { code: number; message?: string }) => void;
    onException?: (error: unknown) => void;
  } = {},
): void {
  const span: Span = {
    setAttribute() {
      return span;
    },
    setAttributes(attributes) {
      if (failure === "setAttributes") throw new Error("telemetry setAttributes failed");
      observers.onAttributes?.(attributes);
      return span;
    },
    setStatus(status) {
      observers.onStatus?.(status);
      return span;
    },
    recordException(error) {
      if (failure === "recordException") throw new Error("telemetry recordException failed");
      observers.onException?.(error);
    },
    addEvent() {
      return span;
    },
    end() {
      if (failure === "end") throw new Error("telemetry end failed");
    },
    spanContext() {
      return { traceId: "1".repeat(32), spanId: "1".repeat(16), traceFlags: 1 };
    },
    updateName() {},
  };

  const tracer = {
    startActiveSpan(
      _name: string,
      optionsOrFn:
        | { attributes?: Record<string, AttributeValue> }
        | ((span: Span) => unknown),
      contextOrFn?: unknown,
      fn?: (span: Span) => unknown,
    ) {
      const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
      const callback = typeof optionsOrFn === "function"
        ? optionsOrFn
        : typeof contextOrFn === "function"
        ? contextOrFn as (span: Span) => unknown
        : fn!;
      onStart?.(options.attributes ?? {});
      return callback(span);
    },
  } as unknown as Tracer;

  setGlobalTracerProvider({ getTracer: () => tracer });
}

function installMaliciousTracer(behavior: ActiveSpanBehavior): void {
  const span: Span = {
    setAttribute() {
      return span;
    },
    setAttributes() {
      return span;
    },
    setStatus() {
      return span;
    },
    recordException() {},
    addEvent() {
      return span;
    },
    end() {},
    spanContext() {
      return { traceId: "1".repeat(32), spanId: "1".repeat(16), traceFlags: 1 };
    },
    updateName() {},
  };
  const tracer = {
    startActiveSpan(...args: unknown[]) {
      const callback = args.at(-1) as (span: Span) => unknown;
      if (behavior === "omit") return Promise.resolve(new Response("provider replacement"));

      const applicationResult = callback(span);
      if (behavior === "duplicate") callback(span);
      if (behavior === "throw-after") throw new Error("provider failed after callback");
      if (behavior === "replace") return Promise.resolve(new Response("provider replacement"));
      return applicationResult;
    },
  } as unknown as Tracer;

  setGlobalTracerProvider({ getTracer: () => tracer });
}

describe("observability/auto-instrument/http-instrumentation", () => {
  afterEach(() => {
    _resetShimForTests();
  });

  it("preserves Request method and headers while adding tracing headers", async () => {
    let spanAttributes: Record<string, AttributeValue> = {};
    installTracer(undefined, (attributes) => {
      spanAttributes = attributes;
    });

    let received: Request | undefined;
    const baseFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      received = new Request(input, init);
      return Promise.resolve(new Response("ok"));
    }) as typeof fetch;
    const instrumentedFetch = createInstrumentedFetch(baseFetch);
    const request = new Request("https://example.com/items", {
      method: "POST",
      headers: {
        authorization: "Bearer <TOKEN>",
        "x-request-id": "request-1",
      },
    });

    await instrumentedFetch(request);

    assertEquals(received?.method, "POST");
    assertEquals(received?.headers.get("authorization"), "Bearer <TOKEN>");
    assertEquals(received?.headers.get("x-request-id"), "request-1");
    assertEquals(spanAttributes["http.method"], "POST");
  });

  it("runs HTTP handlers exactly once despite adversarial active-span providers", async () => {
    for (const behavior of ["duplicate", "omit", "replace", "throw-after"] as const) {
      _resetShimForTests();
      installMaliciousTracer(behavior);
      let calls = 0;
      const expected = new Response(`handler-${behavior}`);
      const instrumentedHandler = instrumentHttpHandler(() => {
        calls++;
        return expected;
      });

      const result = await instrumentedHandler(new Request("https://example.com/items"));

      assertEquals(result, expected);
      assertEquals(calls, 1);
    }
  });

  it("runs base fetch exactly once despite adversarial active-span providers", async () => {
    for (const behavior of ["duplicate", "omit", "replace", "throw-after"] as const) {
      _resetShimForTests();
      installMaliciousTracer(behavior);
      let calls = 0;
      const expected = new Response(`fetch-${behavior}`);
      const instrumentedFetch = createInstrumentedFetch(
        (() => {
          calls++;
          return Promise.resolve(expected);
        }) as typeof fetch,
      );

      const result = await instrumentedFetch("https://example.com/items");

      assertEquals(result, expected);
      assertEquals(calls, 1);
    }
  });

  it("preserves the exact application rejection when a provider replaces its result", async () => {
    installMaliciousTracer("replace");
    const applicationError = new Error("application rejection");
    let calls = 0;
    const instrumentedHandler = instrumentHttpHandler(() => {
      calls++;
      throw applicationError;
    });

    let caught: unknown;
    try {
      await instrumentedHandler(new Request("https://example.com/items"));
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, applicationError);
    assertEquals(calls, 1);
  });

  it("does not replace a successful fetch result when span recording fails", async () => {
    installTracer("setAttributes");
    const instrumentedFetch = createInstrumentedFetch(
      (() => Promise.resolve(new Response("application result"))) as typeof fetch,
    );

    const response = await instrumentedFetch("https://example.com/items");

    assertEquals(await response.text(), "application result");
  });

  it("does not replace a successful handler result when span finalization fails", async () => {
    installTracer("end");
    const instrumentedHandler = instrumentHttpHandler(() => new Response("application result"));

    const response = await instrumentedHandler(new Request("https://example.com/items"));

    assertEquals(await response.text(), "application result");
  });

  it("runs the handler when the context provider cannot return an active context", async () => {
    installTracer();
    setGlobalContextAccessor({
      active: () => {
        throw new Error("context provider failed");
      },
      with: (_context, fn) => fn(),
    });
    let calls = 0;
    const instrumentedHandler = instrumentHttpHandler(() => {
      calls++;
      return new Response("application result");
    });

    const response = await instrumentedHandler(new Request("https://example.com/items"));

    assertEquals(await response.text(), "application result");
    assertEquals(calls, 1);
  });

  it("preserves the original handler failure when error telemetry also fails", async () => {
    installTracer("recordException");
    const applicationError = new Error("application failed");
    const instrumentedHandler = instrumentHttpHandler(() => {
      throw applicationError;
    });

    await assertRejects(
      () => instrumentedHandler(new Request("https://example.com/items")),
      Error,
      "application failed",
    );
  });

  it("redacts URL credentials from recorded failures without changing the thrown error", async () => {
    let recordedAttributes: Record<string, AttributeValue> = {};
    let recordedStatus: { code: number; message?: string } | undefined;
    let recordedException: unknown;
    installTracer(undefined, undefined, {
      onAttributes: (attributes) => {
        recordedAttributes = attributes;
      },
      onStatus: (status) => {
        recordedStatus = status;
      },
      onException: (error) => {
        recordedException = error;
      },
    });
    const applicationError = new Error(
      "failed https://user:password@example.test/path?access_token=secret",
    );
    const instrumentedHandler = instrumentHttpHandler(() => {
      throw applicationError;
    });

    try {
      await instrumentedHandler(new Request("https://example.com/items"));
      throw new Error("expected handler failure");
    } catch (error) {
      assertEquals(error, applicationError);
    }

    assertEquals(String(recordedAttributes["error.message"]).includes("secret"), false);
    assertEquals(recordedStatus?.message?.includes("secret"), false);
    assertEquals((recordedException as Error).message.includes("secret"), false);
  });
});
