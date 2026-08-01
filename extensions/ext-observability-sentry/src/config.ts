import type { ApplicationErrorReporter } from "#veryfront/observability/application-error-contract.ts";

const MAX_CONFIG_TEXT_LENGTH = 4_096;
const MAX_SERVICE_NAME_LENGTH = 255;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export const DEFAULT_SENTRY_DISPOSE_TIMEOUT_MS = 2_000;

export type SentryConfig = {
  dsn?: string;
  environment?: string;
  release?: string;
  serviceName?: string;
};

export type SentryEnvironmentReader = (name: string) => string | undefined;

export type SentryApplicationErrorInitializerOptions = {
  config?: SentryConfig;
  readEnvironment?: SentryEnvironmentReader;
  disposeTimeoutMs?: number;
};

export type SentryApplicationErrorReporterSession = {
  reporter: ApplicationErrorReporter;
  dispose(): void | Promise<void>;
};

export type SentryApplicationErrorReporterInitializer = {
  initialize(context: { serviceName: string }):
    | SentryApplicationErrorReporterSession
    | undefined
    | Promise<SentryApplicationErrorReporterSession | undefined>;
};

type InspectedRecord = Record<string, unknown>;

function inspectRecord(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): InspectedRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${label} must be a plain object`);
  }

  const inspected: InspectedRecord = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw new TypeError(`${label} cannot contain symbol properties`);
    }
    if (!allowedKeys.includes(key)) {
      throw new TypeError(`${label} contains unsupported property ${JSON.stringify(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label} ${key} must be an enumerable data property`);
    }
    inspected[key] = descriptor.value;
  }
  return inspected;
}

function assertSafeText(value: string, label: string, maxLength: number): void {
  if (
    value.length === 0 || value.length > maxLength || value.trim() !== value ||
    value.normalize("NFC") !== value
  ) {
    throw new TypeError(`${label} must be a canonical string of at most ${maxLength} characters`);
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code <= 31 || code === 127) {
      throw new TypeError(`${label} cannot contain control characters`);
    }
  }
}

function snapshotConfiguredText(
  value: unknown,
  label: string,
  maxLength: number,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  assertSafeText(value, label, maxLength);
  return value;
}

export function snapshotSentryConfig(config: SentryConfig | undefined): SentryConfig | undefined {
  if (config === undefined) return undefined;
  const input = inspectRecord(config, "Sentry configuration", [
    "dsn",
    "environment",
    "release",
    "serviceName",
  ]);
  const snapshot: SentryConfig = {};
  const dsn = snapshotConfiguredText(input.dsn, "Sentry configuration dsn", MAX_CONFIG_TEXT_LENGTH);
  const environment = snapshotConfiguredText(
    input.environment,
    "Sentry configuration environment",
    MAX_CONFIG_TEXT_LENGTH,
  );
  const release = snapshotConfiguredText(
    input.release,
    "Sentry configuration release",
    MAX_CONFIG_TEXT_LENGTH,
  );
  const serviceName = snapshotConfiguredText(
    input.serviceName,
    "Sentry configuration serviceName",
    MAX_SERVICE_NAME_LENGTH,
  );
  if (dsn !== undefined) snapshot.dsn = dsn;
  if (environment !== undefined) snapshot.environment = environment;
  if (release !== undefined) snapshot.release = release;
  if (serviceName !== undefined) snapshot.serviceName = serviceName;
  return Object.freeze(snapshot);
}

/** Snapshot extension configuration before it can be observed asynchronously. */
export function snapshotSentryInitializerOptions(
  options: SentryApplicationErrorInitializerOptions,
): Readonly<SentryApplicationErrorInitializerOptions & { disposeTimeoutMs: number }> {
  const input = inspectRecord(options, "Sentry initializer options", [
    "config",
    "readEnvironment",
    "disposeTimeoutMs",
  ]);
  if (input.readEnvironment !== undefined && typeof input.readEnvironment !== "function") {
    throw new TypeError("Sentry initializer readEnvironment must be a function");
  }
  const snapshot: SentryApplicationErrorInitializerOptions & { disposeTimeoutMs: number } = {
    config: snapshotSentryConfig(input.config as SentryConfig | undefined),
    disposeTimeoutMs: resolveSentryDisposeTimeout(input.disposeTimeoutMs as number | undefined),
  };
  if (input.readEnvironment !== undefined) {
    snapshot.readEnvironment = input.readEnvironment as SentryEnvironmentReader;
  }
  return Object.freeze(snapshot);
}

function readOptionalEnvironmentText(
  readEnvironment: SentryEnvironmentReader,
  name: string,
  maxLength: number,
): string {
  const value = readEnvironment(name);
  if (value === undefined) return "";
  if (typeof value !== "string") {
    throw new TypeError(`Sentry environment value ${name} must be a string`);
  }
  if (value.trim().length === 0) return "";
  const normalized = value.trim();
  assertSafeText(normalized, `Sentry environment value ${name}`, maxLength);
  return normalized;
}

function firstConfiguredValue(
  configured: unknown,
  readEnvironment: SentryEnvironmentReader,
  environmentNames: readonly string[],
  maxLength = MAX_CONFIG_TEXT_LENGTH,
): string {
  if (configured !== undefined) {
    if (typeof configured !== "string") {
      throw new TypeError("Configured Sentry value must be a string");
    }
    assertSafeText(configured, "Configured Sentry value", maxLength);
    return configured;
  }
  for (const name of environmentNames) {
    const value = readOptionalEnvironmentText(readEnvironment, name, maxLength);
    if (value) return value;
  }
  return "";
}

export function resolveSentryConfig(options: {
  config?: SentryConfig;
  defaultEnvironment?: string;
  readEnvironment: SentryEnvironmentReader;
  serviceName: string;
}): Required<SentryConfig> | undefined {
  const config = snapshotSentryConfig(options.config) ?? {};
  const dsn = firstConfiguredValue(config.dsn, options.readEnvironment, ["SENTRY_DSN"]);
  if (!dsn) return undefined;

  const environment = firstConfiguredValue(config.environment, options.readEnvironment, [
    "SENTRY_ENVIRONMENT",
    "OTEL_DEPLOYMENT_ENVIRONMENT",
    "APP_ENVIRONMENT",
    "VERYFRONT_ENVIRONMENT",
    "VERYFRONT_ENV",
    "NODE_ENV",
  ]) || (options.defaultEnvironment === undefined ? "" : firstConfiguredValue(
    options.defaultEnvironment,
    options.readEnvironment,
    [],
    MAX_CONFIG_TEXT_LENGTH,
  ));
  const release = firstConfiguredValue(config.release, options.readEnvironment, [
    "SENTRY_RELEASE",
    "OTEL_SERVICE_VERSION",
    "RELEASE_VERSION",
    "VERYFRONT_VERSION",
    "npm_package_version",
  ]);
  const serviceName = firstConfiguredValue(
    config.serviceName,
    options.readEnvironment,
    [],
    MAX_SERVICE_NAME_LENGTH,
  ) ||
    firstConfiguredValue(undefined, options.readEnvironment, [
      "SENTRY_SERVICE_NAME",
      "SENTRY_SERVICE",
      "OTEL_SERVICE_NAME",
      "npm_package_name",
    ], MAX_SERVICE_NAME_LENGTH) ||
    firstConfiguredValue(
      options.serviceName,
      options.readEnvironment,
      [],
      MAX_SERVICE_NAME_LENGTH,
    );
  if (!serviceName) {
    throw new TypeError("Sentry application-error reporting requires a service name");
  }

  return { dsn, environment, release, serviceName };
}

export function resolveSentryDisposeTimeout(timeoutMs: number | undefined): number {
  const resolved = timeoutMs ?? DEFAULT_SENTRY_DISPOSE_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(resolved) || resolved < 0 || resolved > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError("Sentry dispose timeout must be a non-negative safe timer delay");
  }
  return resolved;
}
