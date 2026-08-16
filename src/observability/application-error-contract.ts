/** Scalar metadata value attached to an application error. */
export type ApplicationErrorAttributeValue = string | number | boolean;

/** Sanitized context attached when a runtime reports an application error. */
export type ApplicationErrorContext = {
  /** Stable boundary name for the failing runtime operation. */
  boundary: string;
  /** HTTP method associated with the failure. */
  method?: string;
  /** Stable process role used by Sentry dashboards and alerts. */
  processRole?: string;
  /** Request correlation identifier. */
  requestId?: string;
  /** OpenTelemetry span correlation identifier. */
  spanId?: string;
  /** OpenTelemetry trace correlation identifier. */
  traceId?: string;
  /** Stable failure classification (e.g. "tenant-build") tagged on the event. */
  errorClass?: string;
  /** Severity of the captured event; reporters default to "error" when unset. */
  level?: "error" | "warning";
  /** Sanitized scalar metadata for the failure boundary. */
  attributes?: Record<string, ApplicationErrorAttributeValue>;
};

/** Provider-neutral application error capture and flush interface. */
export type ApplicationErrorReporter = {
  capture(error: unknown, context: ApplicationErrorContext): string | undefined;
  flush(timeoutMs?: number): Promise<boolean>;
};
