import { serverLogger } from "#veryfront/utils";
import { type Span, SpanStatusCode } from "#veryfront/observability/tracing/api-shim.ts";
import {
  classifyTelemetryError,
  extractSafeHttpScheme,
  normalizeHttpMethod,
  setSanitizedSpanError,
} from "#veryfront/observability/telemetry-safety.ts";
import { endSpan, setSpanAttributes, SpanNames, startSpan, withSpan } from "../tracing/index.ts";
import { recordRenderError } from "../metrics/index.ts";

const logger = serverLogger.component("auto-instrument");

type RenderOutcome<T> =
  | { state: "pending" }
  | { state: "resolved"; value: T }
  | { state: "rejected"; error: unknown };

function logInstrumentationFailure(message: string, error: unknown): void {
  try {
    logger.debug(message, { failure_category: classifyTelemetryError(error) });
  } catch {
    // Logging must not affect application behavior.
  }
}

/** Instrument a React render operation without recording component identity. */
export async function instrumentReactRender<T>(
  renderFn: () => Promise<T> | T,
  _componentName: string,
): Promise<T> {
  const startTime = readMonotonicTime();
  const operationState: { outcome: RenderOutcome<T> } = { outcome: { state: "pending" } };
  let operationPromise: Promise<T> | undefined;

  const invokeRenderOnce = (span: Span | null): Promise<T> => {
    operationPromise ??= (async () => {
      try {
        const value = await renderFn();
        operationState.outcome = { state: "resolved", value };
        try {
          recordRenderDuration(span, startTime);
        } catch (instrumentationError) {
          logInstrumentationFailure("Render duration instrumentation failed", instrumentationError);
        }
        return value;
      } catch (error) {
        operationState.outcome = { state: "rejected", error };
        handleRenderError(span, error);
        throw error;
      }
    })();
    return operationPromise;
  };

  try {
    return await withSpan(
      SpanNames.RENDER_COMPONENT,
      invokeRenderOnce,
      { kind: "internal" },
    );
  } catch (instrumentationError) {
    if (operationState.outcome.state === "resolved") return operationState.outcome.value;
    if (operationState.outcome.state === "rejected") throw operationState.outcome.error;

    logInstrumentationFailure("React render instrumentation failed", instrumentationError);
    if (operationPromise) return await operationPromise;
    return await renderFn();
  }
}

/** Instrument an error handler with bounded failure metadata. */
export function instrumentErrorHandler(
  handler: (error: Error, request?: Request) => Promise<Response> | Response,
  captureToSpan = true,
): (error: Error, request?: Request) => Promise<Response> | Response {
  return (error: Error, request?: Request): Promise<Response> | Response => {
    if (captureToSpan) {
      try {
        captureErrorToSpan(error, request);
      } catch (instrumentationError) {
        logInstrumentationFailure("Error handler instrumentation failed", instrumentationError);
      }
    }
    return handler(error, request);
  };
}

function handleRenderError(span: Span | null, error: unknown): void {
  try {
    recordRenderError();
  } catch (instrumentationError) {
    logInstrumentationFailure("Render error metric failed", instrumentationError);
  }

  setSanitizedSpanError(span, SpanStatusCode.ERROR, error);
}

function recordRenderDuration(span: Span | null, startTime: number | undefined): void {
  if (startTime === undefined) return;
  const endTime = readMonotonicTime();
  if (endTime === undefined) return;
  const duration = endTime - startTime;
  setSpanAttributes(span, {
    "render.duration_ms": Number.isFinite(duration) && duration > 0 ? Math.floor(duration) : 0,
  });
}

function readMonotonicTime(): number | undefined {
  try {
    const value = performance.now();
    return Number.isFinite(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function captureErrorToSpan(error: Error, request?: Request): void {
  const category = classifyTelemetryError(error);
  const span = startSpan("error.handler", {
    kind: "internal",
    attributes: {
      error: true,
      "error.category": category,
      "error.type": category,
    },
  });

  if (request) {
    const requestAttributes: Record<string, string | number | boolean> = {
      "http.method": normalizeHttpMethod(request.method),
    };
    const scheme = extractSafeHttpScheme(request.url);
    if (scheme) requestAttributes["http.scheme"] = scheme;
    setSpanAttributes(span, requestAttributes);
  }

  endSpan(span, error);
}
