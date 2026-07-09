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
    return JSON.stringify(value);
  }

  return value;
}

function createTracerSpan<TContext, TSpan extends OpenTelemetrySpan>(
  contextApi: OpenTelemetryContextApi<TContext>,
  span: TSpan,
  context: TContext,
): ServiceTracerSpan<TContext, TSpan> {
  const spanContext = span.spanContext();

  return {
    setTag: (key, value) => {
      span.setAttribute(key, toAttributeValue(value));
      return span;
    },
    setAttributes: (attributes) => {
      for (const [key, value] of Object.entries(attributes)) {
        span.setAttribute(key, toAttributeValue(value));
      }
      return span;
    },
    finish: () => {
      span.end();
    },
    withContext: <T>(fn: () => T): T => contextApi.with(context, fn),
    context: () => ({
      toTraceId: () => spanContext.traceId,
      toSpanId: () => spanContext.spanId,
    }),
    otelSpan: span,
    otelContext: context,
  };
}

function setSpanErrorStatus<TSpan extends OpenTelemetrySpan>(
  span: TSpan,
  errorStatusCode: number,
  error: unknown,
): void {
  span.setStatus({ code: errorStatusCode });
  if (error instanceof Error) {
    span.recordException(error);
  }
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise;
}

/** Create open telemetry service tracer. */
export function createOpenTelemetryServiceTracer<
  TContext,
  TSpan extends OpenTelemetrySpan,
  TSpanOptions,
>(
  options: CreateOpenTelemetryServiceTracerOptions<TContext, TSpan, TSpanOptions>,
): OpenTelemetryServiceTracer<TContext, TSpan, TSpanOptions> {
  const otelTracer = options.trace.getTracer(options.serviceName);

  function wrap<TArgs extends unknown[], TResult>(
    name: string,
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs): TResult => {
      const span = otelTracer.startSpan(name, undefined, options.context.active());
      const contextWithSpan = options.trace.setSpan(options.context.active(), span);
      try {
        return options.context.with(contextWithSpan, () => fn(...args));
      } catch (error) {
        setSpanErrorStatus(span, options.errorStatusCode, error);
        throw error;
      } finally {
        span.end();
      }
    };
  }

  function trace<T>(name: string, fn: () => Promise<T>): Promise<T>;
  function trace<T>(name: string, fn: () => T): T;
  function trace<T>(name: string, fn: () => T | Promise<T>): T | Promise<T> {
    return otelTracer.startActiveSpan(name, (span) => {
      try {
        const result = fn();
        if (isPromise(result)) {
          return result
            .then((value) => {
              span.end();
              return value;
            })
            .catch((error) => {
              setSpanErrorStatus(span, options.errorStatusCode, error);
              span.end();
              throw error;
            });
        }
        span.end();
        return result;
      } catch (error) {
        setSpanErrorStatus(span, options.errorStatusCode, error);
        span.end();
        throw error;
      }
    });
  }

  const tracer: ServiceTracer<TContext, TSpan, TSpanOptions> = {
    init: () => {},
    startSpan: (name, startOptions) => {
      let parentContext = options.context.active();

      if (startOptions?.childOf?.otelSpan) {
        parentContext = options.trace.setSpan(
          options.context.active(),
          startOptions.childOf.otelSpan,
        );
      }

      const span = otelTracer.startSpan(name, startOptions, parentContext);
      const spanContext = options.trace.setSpan(parentContext, span);
      return createTracerSpan(options.context, span, spanContext);
    },
    scope: () => ({
      active: () => {
        const activeContext = options.context.active();
        const activeSpan = options.trace.getSpan(activeContext);
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
      const activeSpan = tracer.scope().active();
      if (!activeSpan) return;

      activeSpan.setAttributes(attributes);
    },
    getTraceContext() {
      const activeSpan = tracer.scope().active();
      if (!activeSpan) {
        return {};
      }

      const spanContext = activeSpan.otelSpan.spanContext();
      return {
        traceId: spanContext.traceId,
        spanId: spanContext.spanId,
      };
    },
  };
}
