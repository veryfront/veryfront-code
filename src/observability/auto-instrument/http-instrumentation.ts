import { serverLogger } from "#veryfront/utils";
import { sanitizeUrlForSpan } from "#veryfront/utils/logger/redact.ts";
import {
  type Context,
  context as otContext,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from "#veryfront/observability/tracing/api-shim.ts";
import type { ErrorAttributes, HttpAttributes } from "./types.ts";
import { sanitizeErrorForTelemetry } from "../telemetry-error.ts";
import { runAsyncWithContextFallback } from "../tracing/context-callback.ts";

const logger = serverLogger.component("auto-instrument");

function getHttpTracer() {
  return trace.getTracer("veryfront-http");
}

function reportTelemetryFailure(failureMessage: string, error: unknown): void {
  try {
    logger.debug(failureMessage, error);
  } catch (_) {
    /* expected: telemetry and logging failures must not affect application work */
  }
}

function runTelemetryOperation(operation: () => void, failureMessage: string): void {
  try {
    operation();
  } catch (error) {
    reportTelemetryFailure(failureMessage, error);
  }
}

async function runWithActiveSpanFallback<T>(
  activate: (callback: (span: Span) => Promise<T>) => Promise<T> | T,
  operation: (span: Span | null) => Promise<T>,
  failureMessage: string,
): Promise<T> {
  let selectedSpan: Span | null = null;
  let spanSelected = false;

  return await runAsyncWithContextFallback(
    async (invoke) => {
      return await activate((candidate) => {
        if (!spanSelected) {
          spanSelected = true;
          selectedSpan = candidate ?? null;
        } else if (candidate && candidate !== selectedSpan) {
          runTelemetryOperation(
            () => candidate.end(),
            "Failed to end duplicate active span",
          );
        }
        return invoke();
      });
    },
    () => operation(selectedSpan),
    (error) => reportTelemetryFailure(failureMessage, error),
  );
}

const headersGetter = {
  keys(carrier: Headers): string[] {
    return [...carrier.keys()];
  },
  get(carrier: Headers, key: string): string | undefined {
    return carrier.get(key) ?? undefined;
  },
};

function extractParentContext(headers: Headers): Context | undefined {
  try {
    return propagation.extract(otContext.active(), headers, headersGetter);
  } catch (error) {
    reportTelemetryFailure("Failed to extract parent context", error);
    return undefined;
  }
}

/** Handler for instrument HTTP. */
export function instrumentHttpHandler(
  handler: (request: Request) => Promise<Response> | Response,
): (request: Request) => Promise<Response> {
  return async function instrumentedHttpHandler(request: Request): Promise<Response> {
    const startTime = performance.now();
    const url = new URL(request.url);
    const httpAttrs = buildHttpAttributes(request, url);
    const parentContext = extractParentContext(request.headers);
    const runHandler = async (span: Span | null): Promise<Response> => {
      try {
        const response = await handler(request);
        runTelemetryOperation(
          () => recordResponseSuccess(span, response, performance.now() - startTime, httpAttrs),
          "Failed to record HTTP server response",
        );
        return response;
      } catch (error) {
        runTelemetryOperation(
          () => recordResponseError(span, error, performance.now() - startTime, httpAttrs),
          "Failed to record HTTP server error",
        );
        throw error;
      } finally {
        if (span) {
          runTelemetryOperation(() => span.end(), "Failed to end HTTP server span");
        }
      }
    };
    const spanOptions = { kind: SpanKind.SERVER, attributes: httpAttrs };
    return await runWithActiveSpanFallback(
      (callback) => {
        const tracer = getHttpTracer();
        return parentContext
          ? tracer.startActiveSpan("http.server.request", spanOptions, parentContext, callback)
          : tracer.startActiveSpan("http.server.request", spanOptions, callback);
      },
      runHandler,
      "[auto-instrument] HTTP handler span failed, falling back to raw handler",
    );
  };
}
/** Create a fetch implementation instrumented with observability spans. */
export function createInstrumentedFetch(
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async function instrumentedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startTime = performance.now();
    const urlString = extractFetchUrl(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const spanUrl = sanitizeUrlForSpan(urlString);

    const fetchAttrs: HttpAttributes = {
      "http.method": method,
      "http.url": spanUrl,
      "http.target": spanUrl,
      "http.host": "",
      "http.scheme": "",
    };

    try {
      const parsed = new URL(urlString);
      fetchAttrs["http.target"] = parsed.pathname;
      fetchAttrs["http.host"] = parsed.host;
      fetchAttrs["http.scheme"] = parsed.protocol.replace(":", "");
    } catch (_) {
      /* expected: relative URLs cannot be parsed, leave defaults */
    }

    return await runWithActiveSpanFallback(
      (callback) =>
        getHttpTracer().startActiveSpan(
          "http.client.fetch",
          { kind: SpanKind.CLIENT, attributes: fetchAttrs },
          callback,
        ),
      async (span) => {
        try {
          let effectiveInit = init;
          if (span) {
            try {
              const headers = new Headers(
                init?.headers ?? (input instanceof Request ? input.headers : undefined),
              );
              runTelemetryOperation(
                () =>
                  propagation.inject(otContext.active(), headers, {
                    set: (h, k, v) => h.set(k, v),
                  }),
                "Failed to inject fetch trace context",
              );
              effectiveInit = { ...init, headers };
            } catch (error) {
              reportTelemetryFailure("Failed to prepare fetch trace context", error);
            }
          }

          const response = await baseFetch(input, effectiveInit);
          runTelemetryOperation(
            () => recordResponseSuccess(span, response, performance.now() - startTime, fetchAttrs),
            "Failed to record HTTP client response",
          );
          return response;
        } catch (error) {
          runTelemetryOperation(
            () => recordResponseError(span, error, performance.now() - startTime, fetchAttrs),
            "Failed to record HTTP client error",
          );
          throw error;
        } finally {
          if (span) {
            runTelemetryOperation(() => span.end(), "Failed to end HTTP client span");
          }
        }
      },
      "Fetch span failed, falling back to base fetch",
    );
  };
}

function buildHttpAttributes(request: Request, url: URL): HttpAttributes {
  return {
    "http.method": request.method,
    "http.url": sanitizeUrlForSpan(request.url),
    "http.target": url.pathname,
    "http.host": url.host,
    "http.scheme": url.protocol.replace(":", ""),
  };
}

function recordResponseSuccess(
  span: Span | null,
  response: Response,
  duration: number,
  httpAttrs: HttpAttributes,
): void {
  if (!span) return;

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  runTelemetryOperation(
    () =>
      span.setAttributes({
        "http.status_code": response.status,
        "http.response.size": Number.isFinite(contentLength) && contentLength >= 0
          ? contentLength
          : 0,
        "http.duration_ms": Math.max(0, Math.round(duration)),
        "http.method": httpAttrs["http.method"],
        "http.target": httpAttrs["http.target"],
      }),
    "Failed to record HTTP response attributes",
  );

  runTelemetryOperation(() => {
    if (response.status >= 500) {
      span.setStatus({ code: SpanStatusCode.ERROR });
    } else if (response.status >= 400) {
      span.setStatus({ code: SpanStatusCode.UNSET, message: `HTTP ${response.status}` });
    } else {
      span.setStatus({ code: SpanStatusCode.OK });
    }
  }, "Failed to record HTTP response status");
}

function recordResponseError(
  span: Span | null,
  error: unknown,
  duration: number,
  httpAttrs: HttpAttributes,
): void {
  if (!span) return;

  const telemetryError = sanitizeErrorForTelemetry(error);

  runTelemetryOperation(
    () => span.recordException(telemetryError),
    "Failed to record HTTP exception",
  );
  runTelemetryOperation(
    () =>
      span.setAttributes({
        ...buildErrorAttributes(error),
        "http.duration_ms": Math.max(0, Math.round(duration)),
        "http.method": httpAttrs["http.method"],
        "http.target": httpAttrs["http.target"],
      }),
    "Failed to record HTTP error attributes",
  );
  runTelemetryOperation(
    () =>
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: telemetryError.message,
      }),
    "Failed to record HTTP error status",
  );
}

function extractFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function buildErrorAttributes(error: unknown): ErrorAttributes {
  const telemetryError = sanitizeErrorForTelemetry(error);
  return {
    error: "true",
    "error.type": telemetryError.name,
    "error.message": telemetryError.message,
  };
}
