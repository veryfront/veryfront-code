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
const MISSING_DSN_WARNING =
  "Sentry is enabled, but SENTRY_DSN is empty. Sentry reporting is disabled.";

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

let initializationGeneration = 0;
let initializationPromise: Promise<boolean> | undefined;
let initializationOwner: symbol | undefined;
let initializingConfig: Required<SentryConfig> | undefined;
let installedConfig: Required<SentryConfig> | undefined;
let missingDsnWarningEmitted = false;

/** Return whether Sentry is explicitly enabled. */
export function isSentryEnabled(enabled: string | undefined): boolean {
  switch (enabled?.trim().toLowerCase()) {
    case "true":
    case "1":
      return true;
    default:
      return false;
  }
}

export function resolveSentryConfigFromEnv(
  defaultServiceName = DEFAULT_SERVICE_NAME,
): SentryConfig | undefined {
  const reporterSelected = getEnv("VERYFRONT_ERROR_REPORTER")?.trim().toLowerCase() ===
    SENTRY_ERROR_REPORTER;
  if (!reporterSelected || !isSentryEnabled(getEnv("SENTRY_ENABLED"))) {
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
  loadExtension: SentryExtensionLoader = loadSentryExtension,
): Promise<boolean> {
  const config = resolveSentryConfigFromEnv(defaultServiceName);
  if (!config && shouldWarnAboutMissingDsn()) warnAboutMissingDsnOnce();
  return config ? initializeSentry(config, loadExtension) : Promise.resolve(false);
}

/**
 * Initialize the process-wide Sentry reporter once.
 *
 * Concurrent calls coalesce only when their normalized configurations are
 * identical. Once installed, an identical configuration remains idempotent;
 * a different configuration returns `false` because it was not applied.
 */
export async function initializeSentry(
  config: SentryConfig,
  loadExtension: SentryExtensionLoader = loadSentryExtension,
): Promise<boolean> {
  const dsn = config.dsn?.trim();
  if (!dsn) return false;

  const normalizedConfig: Required<SentryConfig> = {
    dsn,
    environment: config.environment?.trim() ?? "",
    release: config.release?.trim() ?? "",
    serviceName: config.serviceName?.trim() || DEFAULT_SERVICE_NAME,
  };
  if (installedConfig) return sentryConfigsEqual(installedConfig, normalizedConfig);
  if (initializationPromise) {
    return initializingConfig && sentryConfigsEqual(initializingConfig, normalizedConfig)
      ? await initializationPromise
      : false;
  }

  const generation = initializationGeneration;
  const owner = Symbol("sentry-initialization");
  const pending = (async () => {
    const extension = await loadExtension();
    if (generation !== initializationGeneration) return false;

    const reporter = extension.createSentryApplicationErrorReporter({ ...normalizedConfig });
    setApplicationErrorReporter(reporter);
    installedConfig = normalizedConfig;
    return true;
  })();
  initializationPromise = pending;
  initializationOwner = owner;
  initializingConfig = normalizedConfig;
  try {
    return await pending;
  } finally {
    if (generation === initializationGeneration && initializationOwner === owner) {
      initializationPromise = undefined;
      initializationOwner = undefined;
      initializingConfig = undefined;
    }
  }
}

export function resetSentryForTests(): void {
  initializationGeneration += 1;
  initializationPromise = undefined;
  initializationOwner = undefined;
  initializingConfig = undefined;
  installedConfig = undefined;
  missingDsnWarningEmitted = false;
  setApplicationErrorReporter(undefined);
}

function sentryConfigsEqual(
  left: Required<SentryConfig>,
  right: Required<SentryConfig>,
): boolean {
  return left.dsn === right.dsn && left.environment === right.environment &&
    left.release === right.release && left.serviceName === right.serviceName;
}

function shouldWarnAboutMissingDsn(): boolean {
  const reporterSelected = getEnv("VERYFRONT_ERROR_REPORTER")?.trim().toLowerCase() ===
    SENTRY_ERROR_REPORTER;
  return reporterSelected && isSentryEnabled(getEnv("SENTRY_ENABLED")) &&
    !getEnv("SENTRY_DSN")?.trim();
}

function warnAboutMissingDsnOnce(): void {
  if (missingDsnWarningEmitted) return;
  missingDsnWarningEmitted = true;
  console.warn(MISSING_DSN_WARNING);
}

function loadSentryExtension(): Promise<SentryExtensionModule> {
  return importFirstPartyExtensionModule<SentryExtensionModule>(
    "ext-observability-sentry",
    "@veryfront/ext-observability-sentry",
  );
}
