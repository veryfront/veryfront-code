import { serverLogger as logger } from "#veryfront/utils";
import {
  context as otContext,
  propagation,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from "@opentelemetry/api";
import type { ErrorAttributes, HttpAttributes } from "./types.ts";

const log = logger.component("auto-instrument");

const tracer = trace.getTracer("veryfront-http");

const headersGetter = {
  keys(carrier: Headers): string[] {
    return [...carrier.keys()];
  },
  get(carrier: Headers, key: string): string | undefined {
    return carrier.get(key) ?? undefined;
  },
};

function extractParentContext(headers: Headers) {
  try {
    return propagation.extract(otContext.active(), headers, headersGetter);
  } catch (error) {
    log.debug("Failed to extract parent context", error);
    return otContext.active();
  }
}

export function instrumentHttpHandler(
  handler: (request: Request) => Promise<Response> | Response,
): (request: Request) => Promise<Response> {
  return async function instrumentedHttpHandler(request: Request): Promise<Response> {
    const startTime = performance.now();
    const url = new URL(request.url);
    const httpAttrs = buildHttpAttributes(request, url);
    const parentContext = extractParentContext(request.headers);

    try {
      return await tracer.startActiveSpan(
        "http.server.request",
        { kind: SpanKind.SERVER, attributes: httpAttrs },
        parentContext,
        async (span) => {
          try {
            const response = await handler(request);
            recordResponseSuccess(span, response, performance.now() - startTime, httpAttrs);
            return response;
          } catch (error) {
            recordResponseError(span, error, performance.now() - startTime, httpAttrs);
            throw error;
          } finally {
            span.end();
          }
        },
      );
    } catch (error) {
      logger.debug(
        "[auto-instrument] HTTP handler span failed, falling back to raw handler",
        error,
      );
      return await handler(request);
    }
  };
}

export function createInstrumentedFetch(
  baseFetch: typeof fetch = globalThis.fetch,
): typeof fetch {
  return async function instrumentedFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const startTime = performance.now();
    const urlString = extractFetchUrl(input);
    const method = init?.method ?? "GET";

    const fetchAttrs: HttpAttributes = {
      "http.method": method,
      "http.url": urlString,
      "http.target": urlString,
      "http.host": "",
      "http.scheme": "",
    };

    try {
      const parsed = new URL(urlString);
      fetchAttrs["http.target"] = parsed.pathname;
      fetchAttrs["http.host"] = parsed.host;
      fetchAttrs["http.scheme"] = parsed.protocol.replace(":", "");
    } catch {
      // Relative URLs are fine; leave defaults
    }

    try {
      return await tracer.startActiveSpan(
        "http.client.fetch",
        { kind: SpanKind.CLIENT, attributes: fetchAttrs },
        async (span) => {
          try {
            const headers = new Headers(init?.headers);
            propagation.inject(otContext.active(), headers, {
              set: (h, k, v) => h.set(k, v),
            });

            const response = await baseFetch(input, { ...init, headers });
            recordResponseSuccess(span, response, performance.now() - startTime, fetchAttrs);
            return response;
          } catch (error) {
            recordResponseError(span, error, performance.now() - startTime, fetchAttrs);
            throw error;
          } finally {
            span.end();
          }
        },
      );
    } catch (error) {
      log.debug("Fetch span failed, falling back to base fetch", error);
      return await baseFetch(input, init);
    }
  };
}

function buildHttpAttributes(request: Request, url: URL): HttpAttributes {
  return {
    "http.method": request.method,
    "http.url": request.url,
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

  span.setAttributes({
    "http.status_code": response.status,
    "http.response.size": Number(response.headers.get("content-length") ?? 0),
    "http.duration_ms": Math.round(duration),
  });

  if (response.status >= 500) {
    span.setStatus({ code: SpanStatusCode.ERROR });
  } else if (response.status >= 400) {
    span.setStatus({ code: SpanStatusCode.UNSET, message: `HTTP ${response.status}` });
  } else {
    span.setStatus({ code: SpanStatusCode.OK });
  }

  // Preserve original request method/path for downstream analysis
  span.setAttributes({
    "http.method": httpAttrs["http.method"],
    "http.target": httpAttrs["http.target"],
  });
}

function recordResponseError(
  span: Span | null,
  error: unknown,
  duration: number,
  httpAttrs: HttpAttributes,
): void {
  if (!span) return;

  span.recordException(error as Error);
  span.setAttributes({
    ...buildErrorAttributes(error),
    "http.duration_ms": Math.round(duration),
    "http.method": httpAttrs["http.method"],
    "http.target": httpAttrs["http.target"],
  });
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message: error instanceof Error ? error.message : String(error),
  });
}

function extractFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function buildErrorAttributes(error: unknown): ErrorAttributes {
  if (error instanceof Error) {
    return {
      error: "true",
      "error.type": error.constructor.name,
      "error.message": error.message,
    };
  }

  return {
    error: "true",
    "error.type": "Unknown",
    "error.message": String(error),
  };
}
