import { initializeSentryFromEnv } from "#veryfront/observability/sentry.ts";

/**
 * Initialize env-configured production error reporting for the server process.
 *
 * Configuration comes only from deployment-owned environment variables
 * (`VERYFRONT_ERROR_REPORTER`, `SENTRY_ENABLED`, `SENTRY_DSN`, and related
 * settings). The call accepts no reporter, config, or loader input, so a
 * caller cannot select where framework error payloads are sent; the
 * process-wide Sentry mutators stay internal. Initialization is idempotent
 * and resolves to whether an env-configured reporter is installed.
 */
export function initializeProductionErrorReportingFromEnv(): Promise<boolean> {
  return initializeSentryFromEnv();
}
