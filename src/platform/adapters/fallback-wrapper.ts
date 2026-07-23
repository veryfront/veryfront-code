import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { FALLBACK_EXHAUSTED, INVALID_ARGUMENT } from "#veryfront/errors/error-registry.ts";

const logger = baseLogger.component("fallback-wrapper");

export { FALLBACK_EXHAUSTED } from "#veryfront/errors/error-registry.ts";

export interface FallbackOptions {
  operationName: string;
  logError?: boolean;
  rethrowOnFallbackFailure?: boolean;
}

const OPERATION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/;

function invalidFallbackArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function assertOperation(
  operation: unknown,
  label: "primary" | "fallback",
): asserts operation is () => unknown {
  if (typeof operation !== "function") {
    invalidFallbackArgument(`Fallback ${label} operation must be a function`);
  }
}

function assertOptionsObject(options: unknown): asserts options is object {
  if (typeof options !== "object" || options === null) {
    invalidFallbackArgument("Fallback options must be an object");
  }

  let isArray: boolean;
  try {
    isArray = Array.isArray(options);
  } catch {
    invalidFallbackArgument("Fallback options are not readable");
  }
  if (isArray) invalidFallbackArgument("Fallback options must be an object");
}

function readOption(options: object, property: keyof FallbackOptions): unknown {
  try {
    return Reflect.get(options, property);
  } catch {
    invalidFallbackArgument("Fallback options are not readable");
  }
}

function normalizeFallbackConfig(options: unknown): Readonly<Required<FallbackOptions>> {
  assertOptionsObject(options);

  const operationName = readOption(options, "operationName");
  const logError = readOption(options, "logError");
  const rethrowOnFallbackFailure = readOption(options, "rethrowOnFallbackFailure");

  if (typeof operationName !== "string" || !OPERATION_NAME_PATTERN.test(operationName)) {
    invalidFallbackArgument(
      "Fallback operation name must be a stable identifier with at most 64 characters",
    );
  }
  if (logError !== undefined && typeof logError !== "boolean") {
    invalidFallbackArgument("Fallback logError option must be a boolean");
  }
  if (rethrowOnFallbackFailure !== undefined && typeof rethrowOnFallbackFailure !== "boolean") {
    invalidFallbackArgument("Fallback rethrowOnFallbackFailure option must be a boolean");
  }

  return Object.freeze({
    operationName,
    logError: logError ?? true,
    rethrowOnFallbackFailure: rethrowOnFallbackFailure ?? true,
  });
}

function normalizeFactoryConfig(
  operationName: unknown,
  options: unknown,
): Readonly<Required<FallbackOptions>> {
  if (options === undefined) return normalizeFallbackConfig({ operationName });
  assertOptionsObject(options);

  return normalizeFallbackConfig({
    operationName,
    logError: readOption(options, "logError"),
    rethrowOnFallbackFailure: readOption(options, "rethrowOnFallbackFailure"),
  });
}

type FailureKind =
  | "error"
  | "object"
  | "function"
  | "string"
  | "number"
  | "boolean"
  | "bigint"
  | "symbol"
  | "undefined"
  | "null"
  | "uninspectable";

interface FailureClassification {
  readonly kind: FailureKind;
}

function classifyFailure(error: unknown): FailureClassification {
  if (error === null) return Object.freeze({ kind: "null" });

  const valueType = typeof error;
  if (valueType === "object" || valueType === "function") {
    try {
      return Object.freeze({ kind: error instanceof Error ? "error" : valueType });
    } catch {
      return Object.freeze({ kind: "uninspectable" });
    }
  }

  return Object.freeze({ kind: valueType as Exclude<FailureKind, "error" | "uninspectable"> });
}

function logPrimaryFailure(
  operationName: string,
  failure: FailureClassification,
): void {
  logger.debug(
    `[fallback-wrapper] Primary operation failed for ${operationName}, attempting fallback`,
    { failure },
  );
}

function logFallbackSuccess(operationName: string): void {
  logger.debug(`Fallback succeeded for ${operationName}`);
}

function handleFallbackFailure(
  operationName: string,
  primaryFailure: FailureClassification,
  fallbackError: unknown,
  fallbackFailure: FailureClassification,
  logError: boolean,
  rethrowOnFallbackFailure: boolean,
): never {
  if (logError) {
    logger.error(
      `[fallback-wrapper] Both primary and fallback failed for ${operationName}`,
      { primaryError: primaryFailure, fallbackError: fallbackFailure },
    );
  }

  if (rethrowOnFallbackFailure) {
    const context = Object.freeze({
      operationName,
      primaryError: primaryFailure,
      fallbackError: fallbackFailure,
    });
    throw FALLBACK_EXHAUSTED.create({
      detail: `Both primary and fallback operations failed for ${operationName}`,
      cause: primaryFailure,
      context,
    });
  }

  throw fallbackError;
}

export async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  options: FallbackOptions,
): Promise<T> {
  assertOperation(primary, "primary");
  assertOperation(fallback, "fallback");
  const { operationName, logError, rethrowOnFallbackFailure } = normalizeFallbackConfig(options);

  try {
    return await primary();
  } catch (primaryError) {
    const primaryFailure = classifyFailure(primaryError);
    if (logError) logPrimaryFailure(operationName, primaryFailure);

    try {
      const result = await fallback();
      if (logError) logFallbackSuccess(operationName);
      return result;
    } catch (fallbackError) {
      handleFallbackFailure(
        operationName,
        primaryFailure,
        fallbackError,
        classifyFailure(fallbackError),
        logError,
        rethrowOnFallbackFailure,
      );
    }
  }
}

export function withFallbackSync<T>(
  primary: () => T,
  fallback: () => T,
  options: FallbackOptions,
): T {
  assertOperation(primary, "primary");
  assertOperation(fallback, "fallback");
  const { operationName, logError, rethrowOnFallbackFailure } = normalizeFallbackConfig(options);

  try {
    return primary();
  } catch (primaryError) {
    const primaryFailure = classifyFailure(primaryError);
    if (logError) logPrimaryFailure(operationName, primaryFailure);

    try {
      const result = fallback();
      if (logError) logFallbackSuccess(operationName);
      return result;
    } catch (fallbackError) {
      handleFallbackFailure(
        operationName,
        primaryFailure,
        fallbackError,
        classifyFailure(fallbackError),
        logError,
        rethrowOnFallbackFailure,
      );
    }
  }
}

export interface AsyncAdapterFallback<T> {
  execute: () => Promise<T>;
}

export interface SyncAdapterFallback<T> {
  executeSync: () => T;
}

export function createAdapterFallback<T>(
  adapterOperation: () => Promise<T>,
  directOperation: () => Promise<T>,
  operationName: string,
  options?: Partial<Omit<FallbackOptions, "operationName">>,
): AsyncAdapterFallback<T> {
  assertOperation(adapterOperation, "primary");
  assertOperation(directOperation, "fallback");
  const config = normalizeFactoryConfig(operationName, options);

  return {
    execute(): Promise<T> {
      return withFallback(adapterOperation, directOperation, config);
    },
  };
}

export function createAdapterFallbackSync<T>(
  adapterOperation: () => T,
  directOperation: () => T,
  operationName: string,
  options?: Partial<Omit<FallbackOptions, "operationName">>,
): SyncAdapterFallback<T> {
  assertOperation(adapterOperation, "primary");
  assertOperation(directOperation, "fallback");
  const config = normalizeFactoryConfig(operationName, options);

  return {
    executeSync(): T {
      return withFallbackSync(adapterOperation, directOperation, config);
    },
  };
}
