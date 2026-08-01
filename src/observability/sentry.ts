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
const SENTRY_ERROR_REPORTER = "sentry";

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
let initializationGeneration = 0;
let initializationPromise: Promise<boolean> | undefined;

/**
 * Resolve the compatibility-release Sentry flag.
 *
 * Explicit false always disables reporting. While the flag is unset (or is an
 * unrecognized value), callers retain their pre-flag behavior until managed
 * deployments have been migrated to explicit values.
 */
export function isSentryEnabled(
  enabled: string | undefined,
  legacyEnabled: boolean,
): boolean {
  switch (enabled?.trim().toLowerCase()) {
    case "true":
    case "1":
      return true;
    case "false":
    case "0":
      return false;
    default:
      return legacyEnabled;
  }
}

export function resolveSentryConfigFromEnv(
  defaultServiceName = DEFAULT_SERVICE_NAME,
): SentryConfig | undefined {
  const reporterSelected = getEnv("VERYFRONT_ERROR_REPORTER")?.trim().toLowerCase() ===
    SENTRY_ERROR_REPORTER;
  if (!reporterSelected || !isSentryEnabled(getEnv("SENTRY_ENABLED"), reporterSelected)) {
    return undefined;
  }

  const dsn = getEnv("SENTRY_DSN")?.trim();
  if (!dsn) return undefined;

  return {
    dsn,
    environment: getEnv("SENTRY_ENVIRONMENT") ?? getEnv("OTEL_DEPLOYMENT_ENVIRONMENT"),
    release: getEnv("SENTRY_RELEASE") ?? getEnv("OTEL_SERVICE_VERSION"),
    serviceName: (getEnv("SENTRY_SERVICE_NAME") ?? getEnv("OTEL_SERVICE_NAME"))?.trim() ||
      defaultServiceName,
  };
}

export function initializeSentryFromEnv(
  defaultServiceName = DEFAULT_SERVICE_NAME,
): Promise<boolean> {
  const config = resolveSentryConfigFromEnv(defaultServiceName);
  return config ? initializeSentry(config) : Promise.resolve(false);
}

export async function initializeSentry(
  config: SentryConfig,
  loadExtension: SentryExtensionLoader = loadSentryExtension,
): Promise<boolean> {
  if (initialized) return true;

  const dsn = config.dsn?.trim();
  if (!dsn) return false;

  if (initializationPromise) return await initializationPromise;

  const generation = initializationGeneration;
  const pending = (async () => {
    const extension = await loadExtension();
    if (generation !== initializationGeneration) return false;

    const reporter = extension.createSentryApplicationErrorReporter({
      dsn,
      environment: config.environment?.trim() ?? "",
      release: config.release?.trim() ?? "",
      serviceName: config.serviceName?.trim() || DEFAULT_SERVICE_NAME,
    });
    setApplicationErrorReporter(reporter);
    initialized = true;
    return true;
  })();
  initializationPromise = pending;
  try {
    return await pending;
  } finally {
    if (initializationPromise === pending) initializationPromise = undefined;
  }
}

export function resetSentryForTests(): void {
  initializationGeneration += 1;
  initializationPromise = undefined;
  initialized = false;
  setApplicationErrorReporter(undefined);
}

function loadSentryExtension(): Promise<SentryExtensionModule> {
  return importFirstPartyExtensionModule<SentryExtensionModule>(
    "ext-observability-sentry",
    "@veryfront/ext-observability-sentry",
  );
}
