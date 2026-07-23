import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type SpanContext,
} from "#veryfront/observability/tracing/api-shim.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

export interface FilesystemTelemetryCapture {
  entries: LogEntry[];
  spanAttributes: Array<Record<string, AttributeValue>>;
  spanStatuses: Array<{ code: number; message?: string }>;
  spanExceptions: unknown[];
  publicErrors: unknown[];
  consoleOutput: string[];
  recordPublicError(error: unknown): void;
}

function serializeCapturedValue(value: unknown): string {
  return JSON.stringify(value, (_key, nestedValue) => {
    if (nestedValue instanceof Error) {
      const candidate = nestedValue as Error & {
        detail?: unknown;
        context?: unknown;
        cause?: unknown;
      };
      return {
        name: candidate.name,
        message: candidate.message,
        stack: candidate.stack,
        detail: candidate.detail,
        context: candidate.context,
        cause: candidate.cause,
      };
    }
    return nestedValue;
  });
}

export function assertFilesystemTelemetryOmits(
  capture: FilesystemTelemetryCapture,
  canaries: readonly string[],
): void {
  const serialized = serializeCapturedValue(capture);
  const leakedCanaries = canaries.filter((canary) => serialized.includes(canary));
  assertEquals(
    leakedCanaries,
    [],
    `Filesystem telemetry exposed ${leakedCanaries.length} sensitive canaries`,
  );
}

export async function captureFilesystemTelemetry<T>(
  operation: (capture: FilesystemTelemetryCapture) => Promise<T> | T,
): Promise<{ capture: FilesystemTelemetryCapture; result: T }> {
  const previousLevel = Deno.env.get("LOG_LEVEL");
  const previousFormat = Deno.env.get("LOG_FORMAT");
  const originalConsole = {
    debug: console.debug,
    error: console.error,
    log: console.log,
    warn: console.warn,
  };
  const spanContext: SpanContext = {
    traceId: "00000000000000000000000000000000",
    spanId: "0000000000000000",
    traceFlags: 0,
  };
  const capture: FilesystemTelemetryCapture = {
    entries: [],
    spanAttributes: [],
    spanStatuses: [],
    spanExceptions: [],
    publicErrors: [],
    consoleOutput: [],
    recordPublicError(error) {
      capture.publicErrors.push(error);
    },
  };
  const span: Span = {
    setAttribute() {
      return span;
    },
    setAttributes() {
      return span;
    },
    setStatus(status) {
      capture.spanStatuses.push(status);
      return span;
    },
    recordException(error) {
      capture.spanExceptions.push(error);
    },
    addEvent() {
      return span;
    },
    end() {},
    spanContext: () => spanContext,
    updateName() {},
  };
  const captureConsole = (...args: unknown[]) => {
    capture.consoleOutput.push(args.map((arg) => serializeCapturedValue(arg)).join(" "));
  };

  Deno.env.set("LOG_LEVEL", "DEBUG");
  Deno.env.set("LOG_FORMAT", "json");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => capture.entries.push(entry));
  console.debug = captureConsole;
  console.error = captureConsole;
  console.log = captureConsole;
  console.warn = captureConsole;
  setGlobalTracerProvider({
    getTracer: () => ({
      startSpan(_name, options) {
        capture.spanAttributes.push(options?.attributes ?? {});
        return span;
      },
      startActiveSpan: (_name: string, ...args: unknown[]) => {
        const callback = args.find((arg) => typeof arg === "function") as
          | ((activeSpan: Span) => unknown)
          | undefined;
        return callback?.(span);
      },
    }),
  });

  try {
    return { capture, result: await operation(capture) };
  } finally {
    __resetLogRecordEmitterForTests();
    _resetShimForTests();
    console.debug = originalConsole.debug;
    console.error = originalConsole.error;
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    if (previousLevel === undefined) Deno.env.delete("LOG_LEVEL");
    else Deno.env.set("LOG_LEVEL", previousLevel);
    if (previousFormat === undefined) Deno.env.delete("LOG_FORMAT");
    else Deno.env.set("LOG_FORMAT", previousFormat);
    __resetLoggerConfigForTests();
  }
}
