import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  type ApplicationErrorReporter,
  captureApplicationError,
  flushApplicationErrors,
  setApplicationErrorReporter,
} from "./application-errors.ts";

export { captureApplicationError, flushApplicationErrors };
export type { ApplicationErrorContext, ApplicationErrorReporter } from "./application-errors.ts";

const DEFAULT_SERVICE_NAME = "veryfront-server";

export type SentryConfig = {
  dsn?: string;
  environment?: string;
  release?: string;
  serviceName?: string;
};

type SentryExtensionModule = {
  createSentryApplicationErrorReporter(config: Required<SentryConfig>): ApplicationErrorReporter;
};

type SentryExtensionLoader = () => Promise<SentryExtensionModule>;

let initialized = false;

export function initializeSentryFromEnv(): Promise<boolean> {
  return initializeSentry({
    dsn: getEnv("SENTRY_DSN"),
    environment: getEnv("SENTRY_ENVIRONMENT") ?? getEnv("OTEL_DEPLOYMENT_ENVIRONMENT"),
    release: getEnv("SENTRY_RELEASE") ?? getEnv("OTEL_SERVICE_VERSION"),
    serviceName: getEnv("SENTRY_SERVICE_NAME") ?? getEnv("OTEL_SERVICE_NAME"),
  });
}

export async function initializeSentry(
  config: SentryConfig,
  loadExtension: SentryExtensionLoader = loadSentryExtension,
): Promise<boolean> {
  if (initialized) return true;

  const dsn = config.dsn?.trim();
  if (!dsn) return false;

  const extension = await loadExtension();
  const reporter = extension.createSentryApplicationErrorReporter({
    dsn,
    environment: config.environment?.trim() ?? "",
    release: config.release?.trim() ?? "",
    serviceName: config.serviceName?.trim() || DEFAULT_SERVICE_NAME,
  });
  setApplicationErrorReporter(reporter);
  initialized = true;
  return true;
}

export function resetSentryForTests(): void {
  initialized = false;
  setApplicationErrorReporter(undefined);
}

function loadSentryExtension(): Promise<SentryExtensionModule> {
  return importFirstPartyExtensionModule<SentryExtensionModule>(
    "ext-observability-sentry",
    "@veryfront/ext-observability-sentry",
  );
}
