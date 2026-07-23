import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
  type Tracer,
} from "#veryfront/observability/tracing/api-shim.ts";
import { initTracing } from "#veryfront/observability/tracing/index.ts";
import { instrumentErrorHandler, instrumentReactRender } from "./react-instrumentation.ts";

const PRIVATE_COMPONENT_CANARY = "PrivateCustomerComponentCanary";
const PRIVATE_ERROR_CANARY = "private-react-error-canary";
const PRIVATE_URL_CANARY = "private-request-path-canary";

type RecordedSpan = {
  name: string;
  initialAttributes: Record<string, AttributeValue>;
  attributes: Record<string, AttributeValue>;
  statuses: Array<{ code: number; message?: string }>;
  exceptions: unknown[];
  endCalls: number;
};

const spans: RecordedSpan[] = [];
let throwFromHooks = false;
let initialized = false;

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
    endCalls: 0,
  };
  spans.push(recording);
  const spanContext: SpanContext = {
    traceId: "00000000000000000000000000000001",
    spanId: "0000000000000001",
    traceFlags: 1,
  };

  const span: Span = {
    setAttribute(key, value) {
      recording.attributes[key] = value;
      if (throwFromHooks) throw new Error("tracer-set-attribute-failure");
      return span;
    },
    setAttributes(attributes) {
      Object.assign(recording.attributes, attributes);
      if (throwFromHooks) throw new Error("tracer-set-attributes-failure");
      return span;
    },
    setStatus(status) {
      recording.statuses.push(status);
      if (throwFromHooks) throw new Error("tracer-set-status-failure");
      return span;
    },
    recordException(error) {
      recording.exceptions.push(error);
      if (throwFromHooks) throw new Error("tracer-record-exception-failure");
    },
    addEvent() {
      return span;
    },
    end() {
      recording.endCalls++;
      if (throwFromHooks) throw new Error("tracer-end-failure");
    },
    spanContext() {
      return spanContext;
    },
    updateName() {},
  };
  return span;
}

async function ensureRecordingTracing(): Promise<void> {
  spans.length = 0;
  throwFromHooks = false;
  if (initialized) return;

  const tracer: Tracer = {
    startSpan(name, options) {
      return createSpan(name, options?.attributes);
    },
    startActiveSpan: (() => {
      throw new Error("not used");
    }) as Tracer["startActiveSpan"],
  };
  setGlobalTracerProvider({ getTracer: () => tracer });
  await initTracing({ enabled: true, exporter: "console" });
  initialized = true;
}

function assertNoPrivateCanaries(value: unknown): void {
  const serialized = JSON.stringify(value);
  for (const canary of [PRIVATE_COMPONENT_CANARY, PRIVATE_ERROR_CANARY, PRIVATE_URL_CANARY]) {
    assertEquals(serialized.includes(canary), false, `telemetry exposed ${canary}`);
  }
}

describe("observability/auto-instrument/react-instrumentation", () => {
  it("records only bounded render failure metadata", async () => {
    await ensureRecordingTracing();
    class PrivateReactCanaryError extends Error {}
    const applicationError = new PrivateReactCanaryError(PRIVATE_ERROR_CANARY);
    applicationError.cause = `${PRIVATE_URL_CANARY}-cause`;

    let caught: unknown;
    try {
      await instrumentReactRender(() => {
        throw applicationError;
      }, PRIVATE_COMPONENT_CANARY);
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, applicationError);
    assertEquals(spans[0]?.exceptions, []);
    assertEquals(spans[0]?.attributes["error.category"], "error");
    assertEquals(spans[0]?.statuses.at(-1), { code: 2 });
    assertNoPrivateCanaries(spans);
  });

  it("omits error messages, stacks, causes, and concrete request URLs", async () => {
    await ensureRecordingTracing();
    class PrivateHandlerCanaryError extends Error {}
    const applicationError = new PrivateHandlerCanaryError(PRIVATE_ERROR_CANARY);
    applicationError.stack = `${PRIVATE_ERROR_CANARY}-stack`;
    applicationError.cause = `${PRIVATE_ERROR_CANARY}-cause`;
    let calls = 0;
    const instrumented = instrumentErrorHandler(() => {
      calls++;
      return new Response("handled", { status: 500 });
    });

    const response = await instrumented(
      applicationError,
      new Request(`https://private.example/${PRIVATE_URL_CANARY}?value=${PRIVATE_ERROR_CANARY}`, {
        method: "POST",
      }),
    );

    assertEquals(await response.text(), "handled");
    assertEquals(calls, 1);
    assertEquals(spans[0]?.initialAttributes, {
      error: true,
      "error.category": "error",
      "error.type": "error",
    });
    assertEquals(spans[0]?.attributes["http.method"], "POST");
    assertEquals(spans[0]?.attributes["http.scheme"], "https");
    assertEquals(spans[0]?.exceptions, []);
    assertNoPrivateCanaries(spans);
  });

  it("does not let failing span hooks mask or repeat a render failure", async () => {
    await ensureRecordingTracing();
    throwFromHooks = true;
    const applicationError = new Error(PRIVATE_ERROR_CANARY);
    let calls = 0;

    let caught: unknown;
    try {
      await instrumentReactRender(() => {
        calls++;
        throw applicationError;
      }, PRIVATE_COMPONENT_CANARY);
    } catch (error) {
      caught = error;
    } finally {
      throwFromHooks = false;
    }

    assertEquals(caught, applicationError);
    assertEquals(calls, 1);
  });

  it("preserves a successful render when span hooks fail", async () => {
    await ensureRecordingTracing();
    throwFromHooks = true;
    let calls = 0;

    try {
      const result = await instrumentReactRender(() => {
        calls++;
        return "application-result";
      }, PRIVATE_COMPONENT_CANARY);

      assertEquals(result, "application-result");
      assertEquals(calls, 1);
    } finally {
      throwFromHooks = false;
    }
  });
});
