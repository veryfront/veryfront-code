import {
  normalizeTelemetryName,
  runSpanHook,
  sanitizeTelemetryAttributes,
  setSanitizedSpanError,
} from "../telemetry-safety.ts";
import {
  REDACTED,
  redactSensitive,
  sanitizeUrlCredentials,
} from "#veryfront/utils/logger/redact.ts";

const MAX_SERVICE_ATTRIBUTES = 32;
const MAX_SERVICE_ATTRIBUTE_KEY_LENGTH = 128;
const MAX_SERVICE_ATTRIBUTE_STRING_LENGTH = 256;
const MAX_SERVICE_ATTRIBUTE_ARRAY_LENGTH = 32;

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
/** Scalar value accepted by the service tracer's OpenTelemetry bridge. */
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
      typeof item === "string" ||
      (typeof item === "number" && Number.isFinite(item)) ||
      typeof item === "boolean"
    );
}

function toAttributeValue(
  value: ServiceTracerAttributeInput,
): ServiceTracerAttributePrimitive | readonly ServiceTracerAttributePrimitive[] {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object" && isPrimitiveArray(value)) {
    return value.slice(0, MAX_SERVICE_ATTRIBUTE_ARRAY_LENGTH).map((item) =>
      typeof item === "string"
        ? sanitizeUrlCredentials(item).slice(0, MAX_SERVICE_ATTRIBUTE_STRING_LENGTH)
        : item
    );
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(redactSensitive(value)).slice(
        0,
        MAX_SERVICE_ATTRIBUTE_STRING_LENGTH,
      );
    } catch {
      return REDACTED;
    }
  }

  if (typeof value === "string") {
    return sanitizeUrlCredentials(value).slice(0, MAX_SERVICE_ATTRIBUTE_STRING_LENGTH);
  }
  if (typeof value === "number" && !Number.isFinite(value)) return 0;

  return value;
}

function readSpanContext<TSpan extends OpenTelemetrySpan>(
  span: TSpan,
): OpenTelemetrySpanContext | undefined {
  try {
    const context = span.spanContext();
    const traceId = context.traceId;
    const spanId = context.spanId;
    return typeof traceId === "string" && typeof spanId === "string"
      ? { traceId, spanId }
      : undefined;
  } catch {
    return undefined;
  }
}

function createTracerSpan<TContext, TSpan extends OpenTelemetrySpan>(
  contextApi: OpenTelemetryContextApi<TContext>,
  span: TSpan,
  context: TContext,
): ServiceTracerSpan<TContext, TSpan> {
  const spanContext = readSpanContext(span);
  let ended = false;

  return {
    setTag: (key, value) => {
      runSpanHook(() =>
        span.setAttribute(
          normalizeTelemetryName(key),
          toAttributeValue(value),
        )
      );
      return span;
    },
    setAttributes: (attributes) => {
      try {
        let count = 0;
        for (const [key, value] of Object.entries(attributes)) {
          if (count++ >= MAX_SERVICE_ATTRIBUTES) break;
          if (key.length === 0 || key.length > MAX_SERVICE_ATTRIBUTE_KEY_LENGTH) continue;
          runSpanHook(() =>
            span.setAttribute(normalizeTelemetryName(key), toAttributeValue(value))
          );
        }
      } catch {
        // Attribute snapshots are optional telemetry.
      }
      return span;
    },
    finish: () => {
      if (ended) return;
      ended = true;
      runSpanHook(() => span.end());
    },
    withContext: <T>(fn: () => T): T => {
      const invocation = createSingleInvocation(fn);
      try {
        return contextApi.with(context, invocation.invoke);
      } catch {
        const state = invocation.getState();
        if (state.state === "resolved") return state.value;
        if (state.state === "rejected") throw state.error;
        return invocation.invoke();
      }
    },
    context: () =>
      spanContext
        ? {
          toTraceId: () => spanContext.traceId,
          toSpanId: () => spanContext.spanId,
        }
        : undefined,
    otelSpan: span,
    otelContext: context,
  };
}

function setSpanErrorStatus<TSpan extends OpenTelemetrySpan>(
  span: TSpan,
  errorStatusCode: number,
  error: unknown,
): void {
  setSanitizedSpanError(span, errorStatusCode, error);
}

function isPromise(value: unknown): value is Promise<unknown> {
  try {
    return !!value && (typeof value === "object" || typeof value === "function") &&
      typeof (value as { then?: unknown }).then === "function";
  } catch {
    return false;
  }
}

type InvocationState<T> =
  | { state: "pending" }
  | { state: "resolved"; value: T }
  | { state: "rejected"; error: unknown };

function createSingleInvocation<T>(fn: () => T): {
  invoke(): T;
  getState(): InvocationState<T>;
} {
  let state: InvocationState<T> = { state: "pending" };

  return {
    invoke(): T {
      if (state.state === "resolved") return state.value;
      if (state.state === "rejected") throw state.error;

      try {
        const value = fn();
        state = { state: "resolved", value };
        return value;
      } catch (error) {
        state = { state: "rejected", error };
        throw error;
      }
    },
    getState: () => state,
  };
}

/** Create open telemetry service tracer. */
export function createOpenTelemetryServiceTracer<
  TContext,
  TSpan extends OpenTelemetrySpan,
  TSpanOptions,
>(
  options: CreateOpenTelemetryServiceTracerOptions<TContext, TSpan, TSpanOptions>,
): OpenTelemetryServiceTracer<TContext, TSpan, TSpanOptions> {
  const otelTracer = options.trace.getTracer(normalizeTelemetryName(options.serviceName));

  function wrap<TArgs extends unknown[], TResult>(
    name: string,
    fn: (...args: TArgs) => TResult,
  ): (...args: TArgs) => TResult {
    return (...args: TArgs): TResult => {
      const invocation = createSingleInvocation(() => fn(...args));
      let span: TSpan;

      try {
        span = otelTracer.startSpan(
          normalizeTelemetryName(name),
          undefined,
          options.context.active(),
        );
      } catch {
        return invocation.invoke();
      }

      let ended = false;
      let callbackInvoked = false;
      let callbackResult: TResult | undefined;
      const endOnce = (): void => {
        if (ended) return;
        ended = true;
        runSpanHook(() => span.end());
      };

      const observeResult = (result: TResult): TResult => {
        if (!isPromise(result)) {
          endOnce();
          callbackResult = result;
          return result;
        }

        const observedResult = result.then(
          (value) => {
            endOnce();
            return value;
          },
          (error) => {
            setSpanErrorStatus(span, options.errorStatusCode, error);
            endOnce();
            throw error;
          },
        ) as TResult;
        callbackResult = observedResult;
        return observedResult;
      };

      try {
        const contextWithSpan = options.trace.setSpan(options.context.active(), span);
        return options.context.with(contextWithSpan, () => {
          callbackInvoked = true;
          return observeResult(invocation.invoke());
        });
      } catch {
        const invocationState = invocation.getState();
        if (invocationState.state === "rejected") {
          setSpanErrorStatus(span, options.errorStatusCode, invocationState.error);
          endOnce();
          throw invocationState.error;
        }
        if (callbackInvoked) {
          return callbackResult as TResult;
        }

        try {
          return observeResult(invocation.invoke());
        } catch (applicationError) {
          setSpanErrorStatus(span, options.errorStatusCode, applicationError);
          endOnce();
          throw applicationError;
        }
      }
    };
  }

  function trace<T>(name: string, fn: () => Promise<T>): Promise<T>;
  function trace<T>(name: string, fn: () => T): T;
  function trace<T>(name: string, fn: () => T | Promise<T>): T | Promise<T> {
    const invocation = createSingleInvocation(fn);
    let callbackInvoked = false;
    let callbackResult: T | Promise<T> | undefined;

    try {
      return otelTracer.startActiveSpan(normalizeTelemetryName(name), (span) => {
        callbackInvoked = true;
        let ended = false;
        const endOnce = (): void => {
          if (ended) return;
          ended = true;
          runSpanHook(() => span.end());
        };

        try {
          const result = invocation.invoke();
          if (isPromise(result)) {
            callbackResult = result.then(
              (value) => {
                endOnce();
                return value;
              },
              (error) => {
                setSpanErrorStatus(span, options.errorStatusCode, error);
                endOnce();
                throw error;
              },
            );
            return callbackResult;
          }
          endOnce();
          callbackResult = result;
          return result;
        } catch (error) {
          setSpanErrorStatus(span, options.errorStatusCode, error);
          endOnce();
          throw error;
        }
      });
    } catch {
      const invocationState = invocation.getState();
      if (invocationState.state === "rejected") throw invocationState.error;
      if (callbackInvoked) return callbackResult as T | Promise<T>;
      return invocation.invoke();
    }
  }

  const tracer: ServiceTracer<TContext, TSpan, TSpanOptions> = {
    init: () => {},
    startSpan: (name, startOptions) => {
      let parentContext = options.context.active();
      const { childOf, ...rawOtelOptions } = startOptions ?? {};
      const otelOptions = "attributes" in rawOtelOptions
        ? {
          ...rawOtelOptions,
          attributes: sanitizeTelemetryAttributes(rawOtelOptions.attributes),
        }
        : rawOtelOptions;

      if (childOf?.otelSpan) {
        parentContext = options.trace.setSpan(
          options.context.active(),
          childOf.otelSpan,
        );
      }

      const span = otelTracer.startSpan(
        normalizeTelemetryName(name),
        otelOptions as TSpanOptions,
        parentContext,
      );
      const spanContext = options.trace.setSpan(parentContext, span);
      return createTracerSpan(options.context, span, spanContext);
    },
    scope: () => ({
      active: () => {
        try {
          const activeContext = options.context.active();
          const activeSpan = options.trace.getSpan(activeContext);
          if (!activeSpan) return null;

          return createTracerSpan(options.context, activeSpan, activeContext);
        } catch {
          return null;
        }
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
      try {
        const activeSpan = tracer.scope().active();
        const spanContext = activeSpan?.context();
        if (!spanContext) return {};
        return {
          traceId: spanContext.toTraceId(),
          spanId: spanContext.toSpanId(),
        };
      } catch {
        return {};
      }
    },
  };
}
