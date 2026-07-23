import { serverLogger } from "#veryfront/utils";
import {
  context as otContext,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  classifyTelemetryError,
  extractSafeHttpScheme,
  normalizeHttpMethod,
  normalizeRouteTemplate,
  runSpanHook,
  setSanitizedSpanError,
} from "#veryfront/observability/telemetry-safety.ts";
import type { HttpAttributes, HttpHandlerInstrumentationOptions } from "./types.ts";

const logger = serverLogger.component("auto-instrument");
const PROPAGATION_HEADERS = new Set(["traceparent", "tracestate"]);
const MAX_PROPAGATION_VALUE_LENGTH = 8_192;

function getHttpTracer() {
  return trace.getTracer("veryfront-http");
}

const headersGetter = {
  keys(carrier: Headers): string[] {
    return [...PROPAGATION_HEADERS].filter((key) => carrier.has(key));
  },
  get(carrier: Headers, key: string): string | undefined {
    if (!PROPAGATION_HEADERS.has(key.toLowerCase())) return undefined;
    return carrier.get(key) ?? undefined;
  },
};

function logInstrumentationFailure(message: string, error: unknown): void {
  try {
    logger.debug(message, { failure_category: classifyTelemetryError(error) });
  } catch {
    // Logging must not affect application behavior.
  }
}

function extractParentContext(headers: Headers) {
  try {
    return propagation.extract(otContext.active(), headers, headersGetter);
  } catch (error) {
    logInstrumentationFailure("Failed to extract parent context", error);
    return otContext.active();
  }
}

type ResponseOutcome =
  | { state: "pending" }
  | { state: "resolved"; response: Response }
  | { state: "rejected"; error: unknown };

/** Instrument an HTTP handler without recording concrete request identity. */
export function instrumentHttpHandler(
  handler: (request: Request) => Promise<Response> | Response,
  options: HttpHandlerInstrumentationOptions = {},
): (request: Request) => Promise<Response> {
  return async function instrumentedHttpHandler(request: Request): Promise<Response> {
    const startTime = readMonotonicTime();
    let httpAttrs: HttpAttributes;
    let parentContext: ReturnType<typeof extractParentContext>;
    try {
      httpAttrs = buildServerHttpAttributes(request, options.routeTemplate);
      parentContext = extractParentContext(request.headers);
    } catch (instrumentationError) {
      logInstrumentationFailure("HTTP handler instrumentation failed", instrumentationError);
      return await handler(request);
    }
    const operationState: { outcome: ResponseOutcome } = { outcome: { state: "pending" } };
    let operationPromise: Promise<Response> | undefined;

    const invokeHandlerOnce = (span: Span): Promise<Response> => {
      operationPromise ??= (async () => {
        try {
          const response = await handler(request);
          operationState.outcome = { state: "resolved", response };
          recordResponseSuccess(span, response, elapsedMilliseconds(startTime));
          return response;
        } catch (error) {
          operationState.outcome = { state: "rejected", error };
          recordResponseError(span, error, elapsedMilliseconds(startTime));
          throw error;
        }
      })();
      return operationPromise;
    };

    try {
      return await getHttpTracer().startActiveSpan(
        "http.server.request",
        { kind: SpanKind.SERVER, attributes: httpAttrs },
        parentContext,
        async (span) => {
          try {
            return await invokeHandlerOnce(span);
          } finally {
            runSpanHook(() => span.end());
          }
        },
      );
    } catch (instrumentationError) {
      logInstrumentationFailure("HTTP handler instrumentation failed", instrumentationError);

      if (operationState.outcome.state === "resolved") return operationState.outcome.response;
      if (operationState.outcome.state === "rejected") throw operationState.outcome.error;
      if (operationPromise) return await operationPromise;
      return await handler(request);
    }
  };
}

/** Create a fetch implementation instrumented with low-cardinality spans. */
export function createInstrumentedFetch(
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async function instrumentedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startTime = readMonotonicTime();
    const operationState: { outcome: ResponseOutcome } = { outcome: { state: "pending" } };
    let operationPromise: Promise<Response> | undefined;

    try {
      const fetchAttrs = buildFetchHttpAttributes(input, init);

      const invokeFetchOnce = (span: Span): Promise<Response> => {
        if (operationPromise) return operationPromise;

        const forwardedInit = createForwardedFetchInit(input, init);
        operationPromise = (async () => {
          try {
            const response = await baseFetch(input, forwardedInit);
            operationState.outcome = { state: "resolved", response };
            recordResponseSuccess(span, response, elapsedMilliseconds(startTime));
            return response;
          } catch (error) {
            operationState.outcome = { state: "rejected", error };
            recordResponseError(span, error, elapsedMilliseconds(startTime));
            throw error;
          }
        })();
        return operationPromise;
      };

      return await getHttpTracer().startActiveSpan(
        "http.client.fetch",
        { kind: SpanKind.CLIENT, attributes: fetchAttrs },
        async (span) => {
          try {
            return await invokeFetchOnce(span);
          } finally {
            runSpanHook(() => span.end());
          }
        },
      );
    } catch (instrumentationError) {
      logInstrumentationFailure("Fetch instrumentation failed", instrumentationError);

      if (operationState.outcome.state === "resolved") return operationState.outcome.response;
      if (operationState.outcome.state === "rejected") throw operationState.outcome.error;
      if (operationPromise) return await operationPromise;
      return await baseFetch(input, init);
    }
  };
}

function buildServerHttpAttributes(
  request: Request,
  routeTemplate: unknown,
): HttpAttributes {
  const attributes: HttpAttributes = {
    "http.method": normalizeHttpMethod(request.method),
  };
  const scheme = extractSafeHttpScheme(request.url);
  const route = normalizeRouteTemplate(routeTemplate);
  if (scheme) attributes["http.scheme"] = scheme;
  if (route) attributes["http.route"] = route;
  return attributes;
}

function buildFetchHttpAttributes(input: RequestInfo | URL, init?: RequestInit): HttpAttributes {
  const inputMethod = input instanceof Request ? input.method : undefined;
  const attributes: HttpAttributes = {
    "http.method": normalizeHttpMethod(init?.method ?? inputMethod ?? "GET"),
  };
  const scheme = extractSafeHttpScheme(extractFetchUrl(input));
  if (scheme) attributes["http.scheme"] = scheme;
  return attributes;
}

function createForwardedFetchInit(
  input: RequestInfo | URL,
  init?: RequestInit,
): RequestInit {
  const inheritedHeaders = input instanceof Request ? input.headers : undefined;
  const headers = new Headers(init?.headers ?? inheritedHeaders);
  propagation.inject(otContext.active(), headers, {
    set: (carrier, key, value) => {
      if (
        PROPAGATION_HEADERS.has(key.toLowerCase()) &&
        value.length <= MAX_PROPAGATION_VALUE_LENGTH && !/[\r\n]/.test(value)
      ) {
        carrier.set(key, value);
      }
    },
  });
  return { ...init, headers };
}

function recordResponseSuccess(
  span: Span | null,
  response: Response,
  duration: number,
): void {
  if (!span) return;

  try {
    const statusCode = response.status;
    const responseAttributes: HttpAttributes = {
      "http.status_code": statusCode,
      "http.duration_ms": normalizeDuration(duration),
    };
    const responseSize = parseResponseSize(response.headers.get("content-length"));
    if (responseSize !== undefined) responseAttributes["http.response.size"] = responseSize;

    runSpanHook(() => span.setAttributes(responseAttributes));
    if (statusCode >= 500) {
      runSpanHook(() => span.setStatus({ code: SpanStatusCode.ERROR }));
    } else if (statusCode >= 400) {
      runSpanHook(() => span.setStatus({ code: SpanStatusCode.UNSET }));
    } else {
      runSpanHook(() => span.setStatus({ code: SpanStatusCode.OK }));
    }
  } catch (error) {
    logInstrumentationFailure("Failed to read HTTP response metadata", error);
  }
}

function recordResponseError(
  span: Span | null,
  error: unknown,
  duration: number,
): void {
  if (!span) return;

  setSanitizedSpanError(span, SpanStatusCode.ERROR, error);
  runSpanHook(() =>
    span.setAttributes({
      "http.duration_ms": normalizeDuration(duration),
    })
  );
}

function extractFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function normalizeDuration(duration: number): number {
  return Number.isFinite(duration) && duration > 0 ? Math.round(duration) : 0;
}

function readMonotonicTime(): number | undefined {
  try {
    const value = performance.now();
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function elapsedMilliseconds(startTime: number | undefined): number {
  if (startTime === undefined) return 0;
  const endTime = readMonotonicTime();
  return endTime === undefined ? 0 : endTime - startTime;
}

function parseResponseSize(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const size = Number(value);
  return Number.isSafeInteger(size) ? size : undefined;
}
