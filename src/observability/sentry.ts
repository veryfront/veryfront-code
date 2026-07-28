import { importFirstPartyExtensionModule } from "#veryfront/extensions/first-party-import.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";
import {
  type ApplicationErrorReporter,
  captureApplicationError,
  flushApplicationErrors,
  setApplicationErrorReporter,
} from "./application-errors.ts";
import { MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH, MAX_OBSERVABILITY_NAME_LENGTH } from "./limits.ts";

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
let initializationPromise: Promise<boolean> | null = null;
let lifecycleGeneration = 0;

export function resolveSentryConfigFromEnv(
  defaultServiceName = DEFAULT_SERVICE_NAME,
): SentryConfig | undefined {
  let provider: string | undefined;
  try {
    provider = getEnv("VERYFRONT_ERROR_REPORTER");
  } catch {
    return undefined;
  }
  if (provider?.trim().toLowerCase() !== SENTRY_ERROR_REPORTER) {
    return undefined;
  }

  try {
    return {
      dsn: getEnv("SENTRY_DSN"),
      environment: getEnv("SENTRY_ENVIRONMENT") ?? getEnv("OTEL_DEPLOYMENT_ENVIRONMENT"),
      release: getEnv("SENTRY_RELEASE") ?? getEnv("OTEL_SERVICE_VERSION"),
      serviceName: normalizeOptionalText(
        getEnv("SENTRY_SERVICE_NAME") ?? getEnv("OTEL_SERVICE_NAME"),
        MAX_OBSERVABILITY_NAME_LENGTH,
      ) || normalizeOptionalText(defaultServiceName, MAX_OBSERVABILITY_NAME_LENGTH) ||
        DEFAULT_SERVICE_NAME,
    };
  } catch {
    return undefined;
  }
}

export function initializeSentryFromEnv(
  defaultServiceName = DEFAULT_SERVICE_NAME,
): Promise<boolean> {
  const config = resolveSentryConfigFromEnv(defaultServiceName);
  return config ? initializeSentry(config) : Promise.resolve(false);
}

export function initializeSentry(
  config: SentryConfig,
  loadExtension: SentryExtensionLoader = loadSentryExtension,
): Promise<boolean> {
  if (initialized) return Promise.resolve(true);
  if (initializationPromise) return initializationPromise;

  const normalized = normalizeSentryConfig(config);
  if (!normalized) return Promise.resolve(false);

  const generation = lifecycleGeneration;
  const attempt = (async (): Promise<boolean> => {
    const extension = await loadExtension();
    if (generation !== lifecycleGeneration) return false;
    if (typeof extension?.createSentryApplicationErrorReporter !== "function") {
      throw new TypeError("Sentry extension does not provide an application error reporter");
    }

    const nextReporter = extension.createSentryApplicationErrorReporter(normalized);
    if (
      nextReporter === null || typeof nextReporter !== "object" ||
      typeof nextReporter.capture !== "function" ||
      typeof nextReporter.flush !== "function"
    ) {
      throw new TypeError("Sentry extension returned an invalid application error reporter");
    }
    if (generation !== lifecycleGeneration) return false;

    setApplicationErrorReporter(nextReporter);
    initialized = true;
    return true;
  })();
  const tracked = attempt.finally(() => {
    if (initializationPromise === tracked) initializationPromise = null;
  });
  initializationPromise = tracked;
  return tracked;
}

export function resetSentryForTests(): void {
  lifecycleGeneration++;
  initialized = false;
  initializationPromise = null;
  setApplicationErrorReporter(undefined);
}

function normalizeSentryConfig(config: SentryConfig): Required<SentryConfig> | null {
  try {
    if (config === null || typeof config !== "object") return null;
    const dsn = normalizeOptionalText(config.dsn, MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH);
    if (!dsn) return null;
    return {
      dsn,
      environment: normalizeOptionalText(
        config.environment,
        MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
      ),
      release: normalizeOptionalText(
        config.release,
        MAX_OBSERVABILITY_CONFIG_TEXT_LENGTH,
      ),
      serviceName: normalizeOptionalText(
        config.serviceName,
        MAX_OBSERVABILITY_NAME_LENGTH,
      ) || DEFAULT_SERVICE_NAME,
    };
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: unknown, maxLength: number): string {
  if (value === undefined) return "";
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return "";
  return normalized;
}

function loadSentryExtension(): Promise<SentryExtensionModule> {
  return importFirstPartyExtensionModule<SentryExtensionModule>(
    "ext-observability-sentry",
    "@veryfront/ext-observability-sentry",
  );
}
