/** Correlation context attached to an unexpected application failure. */
export type ApplicationErrorContext = {
  boundary: string;
  method?: string;
  requestId?: string;
  spanId?: string;
  traceId?: string;
  attributes?: Record<string, string | number | boolean>;
};

/** Vendor-neutral application error capture and delivery contract. */
export type ApplicationErrorReporter = {
  capture(error: unknown, context: ApplicationErrorContext): string | undefined;
  flush(timeoutMs?: number): Promise<boolean>;
};

/** Runtime context passed to an explicitly selected reporter initializer. */
export type ApplicationErrorReporterInitializationContext = {
  serviceName: string;
};

/** Reporter and cleanup ownership returned by an application-selected initializer. */
export type ApplicationErrorReporterSession = {
  reporter: ApplicationErrorReporter;
  dispose(): void | Promise<void>;
};

/** Application-composition contract for an error-reporting implementation. */
export type ApplicationErrorReporterInitializer = {
  initialize(
    context: ApplicationErrorReporterInitializationContext,
  ):
    | ApplicationErrorReporterSession
    | undefined
    | Promise<ApplicationErrorReporterSession | undefined>;
};

/** Contract name used when an application composes a reporter through extensions. */
export const ApplicationErrorReporterInitializerName = "ApplicationErrorReporterInitializer";
