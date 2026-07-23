import { REDACTED, redactForSerialization } from "#veryfront/utils/logger/redact.ts";
import { sanitizeErrorForTelemetry, sanitizeTelemetryAttributeValue } from "../telemetry-error.ts";
import { runSyncWithContextFallback } from "./context-callback.ts";

/** Context for open telemetry span. */
export type OpenTelemetrySpanContext = {
  traceId: string;
  spanId: string;
};

/** Public API contract for open telemetry span. */
export type OpenTelemetrySpan = {
  setAttribute(
    key: string,
    value: ServiceTracerAttributePrimitive | readonly ServiceTracerAttributePrimitive[],
  ): unknown;
  setAttributes(
    attributes: Record<
      string,
      ServiceTracerAttributePrimitive | readonly ServiceTracerAttributePrimitive[]
    >,
  ): unknown;
  setStatus(status: { code: number }): unknown;
  recordException(error: unknown): unknown;
  end(): unknown;
  spanContext(): OpenTelemetrySpanContext;
};

/** Public API contract for open telemetry tracer. */
export type OpenTelemetryTracer<TContext, TSpan extends OpenTelemetrySpan, TSpanOptions> = {
  startSpan(name: string, options: TSpanOptions | undefined, context: TContext): TSpan;
  startActiveSpan<T>(name: string, fn: (span: TSpan) => T): T;
};

/** Public API contract for open telemetry trace API. */
export type OpenTelemetryTraceApi<TContext, TSpan extends OpenTelemetrySpan, TSpanOptions> = {
  getTracer(serviceName: string): OpenTelemetryTracer<TContext, TSpan, TSpanOptions>;
  getSpan(context: TContext): TSpan | undefined;
  setSpan(context: TContext, span: TSpan): TContext;
};

/** Public API contract for open telemetry context API. */
export type OpenTelemetryContextApi<TContext> = {
  active(): TContext;
  with<T>(context: TContext, fn: () => T): T;
};

/** Input payload for service tracer attribute. */
export type ServiceTracerAttributeInput = string | number | boolean | null | undefined | object;
export type ServiceTracerAttributePrimitive = string | number | boolean;
/** Public API contract for service tracer attribute value. */
export type ServiceTracerAttributeValue =
  | ServiceTracerAttributePrimitive
  | readonly ServiceTracerAttributePrimitive[]
  | null
  | undefined;
/** Public API contract for service tracer attributes. */
export type ServiceTracerAttributes = Record<string, ServiceTracerAttributeValue>;

/** Context for service tracer span. */
export type ServiceTracerSpanContext = {
  toTraceId(): string;
  toSpanId(): string;
};

/** Public API contract for service tracer span. */
export type ServiceTracerSpan<
  TContext,
  TSpan extends OpenTelemetrySpan,
> = {
  setTag(key: string, value: ServiceTracerAttributeInput): TSpan;
  setAttributes(attributes: Record<string, ServiceTracerAttributeInput>): TSpan;
  finish(): void;
  withContext<T>(fn: () => T): T;
  context(): ServiceTracerSpanContext | undefined;
  readonly otelSpan: TSpan;
  readonly otelContext: TContext;
};

/** Options accepted by service tracer start span. */
export type ServiceTracerStartSpanOptions<
  TContext,
  TSpan extends OpenTelemetrySpan,
  TSpanOptions,
> = TSpanOptions & {
  childOf?: ServiceTracerSpan<TContext, TSpan>;
};

/** Public API contract for service tracer. */
export type ServiceTracer<TContext, TSpan extends OpenTelemetrySpan, TSpanOptions> = {
  init(): void;
  startSpan(
    name: string,
    options?: ServiceTracerStartSpanOptions<TContext, TSpan, TSpanOptions>,
  ): ServiceTracerSpan<TContext, TSpan>;
  scope(): {
    active(): ServiceTracerSpan<TContext, TSpan> | null;
  };
  wrap<TArgs extends unknown[], TResult>(
    name: string,
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult;
  trace<T>(name: string, fn: () => Promise<T>): Promise<T>;
  trace<T>(name: string, fn: () => T): T;
};

/** Options accepted by create open telemetry service tracer. */
export type CreateOpenTelemetryServiceTracerOptions<
  TContext,
  TSpan extends OpenTelemetrySpan,
  TSpanOptions,
> = {
  serviceName: string;
  context: OpenTelemetryContextApi<TContext>;
  trace: OpenTelemetryTraceApi<TContext, TSpan, TSpanOptions>;
  errorStatusCode: number;
};

/** Public API contract for open telemetry service tracer. */
export type OpenTelemetryServiceTracer<
  TContext,
  TSpan extends OpenTelemetrySpan,
  TSpanOptions,
> = {
  tracer: ServiceTracer<TContext, TSpan, TSpanOptions>;
  setActiveSpanAttributes(attributes: ServiceTracerAttributes): void;
  getTraceContext(): { traceId?: string; spanId?: string };
};

function isPrimitiveArray(
  value: object,
): value is readonly ServiceTracerAttributePrimitive[] {
  return Array.isArray(value) &&
    value.every((item) =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean"
    );
}

function toAttributeValue(
  value: ServiceTracerAttributeInput,
): ServiceTracerAttributePrimitive | readonly ServiceTracerAttributePrimitive[] {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object" && isPrimitiveArray(value)) {
    return value;
  }

  if (typeof value === "object") {
    try {
      const redacted = redactForSerialization(value);
      if (typeof redacted === "string") return redacted;
      return JSON.stringify(redacted) ?? REDACTED;
    } catch (_) {
      return REDACTED;
    }
  }

  return value;
}

function setSpanAttribute<TSpan extends OpenTelemetrySpan>(
  span: TSpan,
  key: string,
  value: ServiceTracerAttributeInput,
): void {
  try {
    span.setAttribute(
      key,
      sanitizeTelemetryAttributeValue(key, toAttributeValue(value)) ?? "",
    );
  } catch (_) {
    /* expected: telemetry failures must not replace application results */
  }
}

function createTracerSpan<TContext, TSpan extends OpenTelemetrySpan>(
  contextApi: OpenTelemetryContextApi<TContext>,
  span: TSpan,
  context: TContext,
): ServiceTracerSpan<TContext, TSpan> {
  return {
    setTag: (key, value) => {
      setSpanAttribute(span, key, value);
      return span;
    },
    setAttributes: (attributes) => {
      try {
        for (const [key, value] of Object.entries(attributes)) {
          setSpanAttribute(span, key, value);
        }
      } catch (_) {
        /* expected: hostile attribute containers fail closed */
      }
      return span;
    },
    finish: () => {
      endSpan(span);
    },
    withContext: <T>(fn: () => T): T =>
      runSyncWithContextFallback(
        (callback) => contextApi.with(context, callback),
        fn,
      ),
    context: () => {
      try {
        const spanContext = span.spanContext();
        return {
          toTraceId: () => spanContext.traceId,
          toSpanId: () => spanContext.spanId,
        };
      } catch (_) {
        return undefined;
      }
    },
    otelSpan: span,
    otelContext: context,
  };
}

function setSpanErrorStatus<TSpan extends OpenTelemetrySpan>(
  span: TSpan,
  errorStatusCode: number,
  error: unknown,
): void {
  try {
    span.setStatus({ code: errorStatusCode });
  } catch (_) {
    /* expected: telemetry failures must not replace application failures */
  }
  try {
    span.recordException(sanitizeErrorForTelemetry(error));
  } catch (_) {
    /* expected: telemetry failures must not replace application failures */
  }
}

function endSpan<TSpan extends OpenTelemetrySpan>(span: TSpan): void {
  try {
    span.end();
  } catch (_) {
    /* expected: telemetry failures must not replace application results */
  }
}

function createInertSpan<TSpan extends OpenTelemetrySpan>(): TSpan {
  const spanContext = Object.freeze({
    traceId: "00000000000000000000000000000000",
    spanId: "0000000000000000",
  });
  const span: OpenTelemetrySpan = Object.freeze({
    setAttribute: () => span,
    setAttributes: () => span,
    setStatus: () => span,
    recordException: () => {},
    end: () => {},
    spanContext: () => spanContext,
  });
  return span as TSpan;
}

function isUsableSpan<TSpan extends OpenTelemetrySpan>(value: unknown): value is TSpan {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) return false;
  try {
    const span = value as OpenTelemetrySpan;
    return typeof span.setAttribute === "function" &&
      typeof span.setAttributes === "function" &&
      typeof span.setStatus === "function" &&
      typeof span.recordException === "function" &&
      typeof span.end === "function" &&
      typeof span.spanContext === "function";
  } catch (_) {
    return false;
  }
}

type SpanFinisher = (failed: boolean, error?: unknown) => void;

function createSpanFinisher<TSpan extends OpenTelemetrySpan>(
  span: TSpan,
  errorStatusCode: number,
): SpanFinisher {
  let finished = false;
  return (failed, error) => {
    if (finished) return;
    finished = true;
    if (failed) setSpanErrorStatus(span, errorStatusCode, error);
    endSpan(span);
  };
}

function getThenMethod(value: unknown): ((...args: unknown[]) => unknown) | null {
  if (
    !((typeof value === "object" && value !== null) || typeof value === "function")
  ) {
    return null;
  }
  const then = (value as { then?: unknown }).then;
  return typeof then === "function" ? then as (...args: unknown[]) => unknown : null;
}

function observeSettlement(
  value: unknown,
  finish: SpanFinisher,
): void {
  let then: ((...args: unknown[]) => unknown) | null;
  try {
    then = getThenMethod(value);
  } catch (error) {
    finish(true, error);
    return;
  }

  if (!then) {
    finish(false);
    return;
  }

  let settled = false;
  try {
    Reflect.apply(then, value, [
      () => {
        if (settled) return;
        settled = true;
        finish(false);
      },
      (error: unknown) => {
        if (settled) return;
        settled = true;
        finish(true, error);
      },
    ]);
  } catch (error) {
    if (settled) return;
    settled = true;
    finish(true, error);
  }
}

function consumeIgnoredThenable(value: unknown): void {
  let then: ((...args: unknown[]) => unknown) | null;
  try {
    then = getThenMethod(value);
  } catch (_) {
    return;
  }
  if (!then) return;
  try {
    Reflect.apply(then, value, [() => {}, () => {}]);
  } catch (_) {
    /* expected: provider-owned thenables cannot affect application outcomes */
  }
}

/** Create open telemetry service tracer. */
export function createOpenTelemetryServiceTracer<
  TContext,
  TSpan extends OpenTelemetrySpan,
  TSpanOptions,
>(
  options: CreateOpenTelemetryServiceTracerOptions<TContext, TSpan, TSpanOptions>,
): OpenTelemetryServiceTracer<TContext, TSpan, TSpanOptions> {
  function getOtelTracer(): OpenTelemetryTracer<TContext, TSpan, TSpanOptions> | undefined {
    try {
      const candidate = options.trace.getTracer(options.serviceName);
      if (
        !candidate || typeof candidate.startSpan !== "function" ||
        typeof candidate.startActiveSpan !== "function"
      ) {
        return undefined;
      }
      return candidate;
    } catch (_) {
      return undefined;
    }
  }

  function getActiveContext(): TContext {
    try {
      return options.context.active();
    } catch (_) {
      return undefined as TContext;
    }
  }

  function setSpanOnContext(context: TContext, span: TSpan): TContext {
    try {
      return options.trace.setSpan(context, span);
    } catch (_) {
      return context;
    }
  }

  function startSpan(
    name: string,
    startOptions: TSpanOptions | undefined,
    context: TContext,
  ): TSpan {
    const tracer = getOtelTracer();
    if (tracer) {
      try {
        const candidate = tracer.startSpan(name, startOptions, context);
        if (isUsableSpan<TSpan>(candidate)) return candidate;
      } catch (_) {
        /* expected: invalid providers fall back to an inert span */
      }
    }
    return createInertSpan<TSpan>();
  }

  function getSpanFromContext(context: TContext): TSpan | undefined {
    try {
      const span = options.trace.getSpan(context);
      return isUsableSpan<TSpan>(span) ? span : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function wrap<TArgs extends unknown[], TResult>(
    name: string,
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs): TResult => {
      const parentContext = getActiveContext();
      const span = startSpan(name, undefined, parentContext);
      const contextWithSpan = setSpanOnContext(parentContext, span);
      const finish = createSpanFinisher(span, options.errorStatusCode);
      let result: TResult;
      try {
        result = runSyncWithContextFallback(
          (callback) => options.context.with(contextWithSpan, callback),
          () => fn(...args),
        );
      } catch (error) {
        finish(true, error);
        throw error;
      }

      observeSettlement(result, finish);
      return result;
    };
  }

  function trace<T>(name: string, fn: () => Promise<T>): Promise<T>;
  function trace<T>(name: string, fn: () => T): T;
  function trace<T>(name: string, fn: () => T | Promise<T>): T | Promise<T> {
    let callbackInvoked = false;
    let callbackSucceeded = false;
    let callbackResult!: T | Promise<T>;
    let callbackError: unknown;
    let selectedSpan: TSpan | undefined;

    const selectSpan = (candidate?: unknown): TSpan => {
      if (!selectedSpan) {
        selectedSpan = isUsableSpan<TSpan>(candidate) ? candidate : createInertSpan<TSpan>();
      } else if (
        isUsableSpan<TSpan>(candidate) && candidate !== selectedSpan
      ) {
        endSpan(candidate);
      }
      return selectedSpan;
    };

    const invoke = (): T | Promise<T> => {
      if (callbackInvoked) {
        if (!callbackSucceeded) throw callbackError;
        return callbackResult;
      }
      callbackInvoked = true;
      const finish = createSpanFinisher(selectSpan(), options.errorStatusCode);
      try {
        callbackResult = fn();
        callbackSucceeded = true;
        observeSettlement(callbackResult, finish);
        return callbackResult;
      } catch (error) {
        callbackError = error;
        finish(true, error);
        throw error;
      }
    };

    const activeTracer = getOtelTracer();
    if (!activeTracer) return invoke();

    let providerResult: unknown;
    try {
      providerResult = activeTracer.startActiveSpan(name, (span) => {
        selectSpan(span);
        return invoke();
      });
    } catch (_) {
      if (!callbackInvoked) return invoke();
      if (!callbackSucceeded) throw callbackError;
      return callbackResult;
    }

    if (!callbackInvoked) {
      consumeIgnoredThenable(providerResult);
      return invoke();
    }
    if (providerResult !== callbackResult) consumeIgnoredThenable(providerResult);
    if (!callbackSucceeded) throw callbackError;
    return callbackResult;
  }

  const tracer: ServiceTracer<TContext, TSpan, TSpanOptions> = {
    init: () => {},
    startSpan: (name, startOptions) => {
      let parentContext = getActiveContext();
      try {
        const parentSpan = startOptions?.childOf?.otelSpan;
        if (parentSpan) {
          parentContext = setSpanOnContext(parentContext, parentSpan);
        }
      } catch (_) {
        /* expected: hostile option accessors do not prevent span creation */
      }

      const span = startSpan(name, startOptions, parentContext);
      const spanContext = setSpanOnContext(parentContext, span);
      return createTracerSpan(options.context, span, spanContext);
    },
    scope: () => ({
      active: () => {
        const activeContext = getActiveContext();
        const activeSpan = getSpanFromContext(activeContext);
        if (!activeSpan) return null;

        return createTracerSpan(options.context, activeSpan, activeContext);
      },
    }),
    wrap,
    trace,
  };

  return {
    tracer,
    setActiveSpanAttributes(attributes) {
      try {
        const activeSpan = tracer.scope().active();
        if (!activeSpan) return;
        activeSpan.setAttributes(attributes);
      } catch (_) {
        /* expected: telemetry failures do not escape */
      }
    },
    getTraceContext() {
      try {
        const activeSpan = tracer.scope().active();
        const spanContext = activeSpan?.context();
        if (!spanContext) return {};
        return {
          traceId: spanContext.toTraceId(),
          spanId: spanContext.toSpanId(),
        };
      } catch (_) {
        return {};
      }
    },
  };
}
