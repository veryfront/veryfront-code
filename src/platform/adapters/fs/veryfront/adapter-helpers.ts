import type { VeryfrontAPIConfig } from "../../veryfront-api-client/types.ts";
import type { FileCacheOptions } from "../cache/types.ts";
import type { ContentSource, FSAdapterConfig } from "./types.ts";
import {
  assertReadableConfigObject,
  invalidFSAdapterConfig,
  readConfigProperty,
} from "./config-boundary.ts";

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
export const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
export const DEFAULT_CACHE_TTL_MS = 60_000;
export const DEFAULT_CACHE_MAX_ENTRIES = 1_000;
export const DEFAULT_CACHE_MAX_MEMORY_BYTES = 100 * 1024 * 1024;

const MAX_RETRIES = 20;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

type VeryfrontConfigOverrides = NonNullable<FSAdapterConfig["veryfront"]>;
type RetryOverrides = VeryfrontConfigOverrides["retry"];
type CacheOverrides = VeryfrontConfigOverrides["cache"];

export function buildRetryConfig(
  retry?: RetryOverrides,
): NonNullable<VeryfrontAPIConfig["retry"]> {
  let maxRetries: unknown;
  let initialDelay: unknown;
  let maxDelay: unknown;
  let retryDelay: unknown;
  if (retry !== undefined) {
    assertReadableConfigObject(retry, "Veryfront filesystem retry configuration");
    maxRetries = readConfigProperty(
      retry,
      "maxRetries",
      "Veryfront filesystem retry configuration",
    );
    initialDelay = readConfigProperty(
      retry,
      "initialDelay",
      "Veryfront filesystem retry configuration",
    );
    maxDelay = readConfigProperty(
      retry,
      "maxDelay",
      "Veryfront filesystem retry configuration",
    );
    retryDelay = readConfigProperty(
      retry,
      "retryDelay",
      "Veryfront filesystem retry configuration",
    );
  }

  const resolvedMaxRetries = maxRetries === undefined ? DEFAULT_MAX_RETRIES : maxRetries;
  const resolvedInitialDelay = initialDelay !== undefined
    ? initialDelay
    : retryDelay !== undefined
    ? retryDelay
    : DEFAULT_INITIAL_RETRY_DELAY_MS;
  const resolvedMaxDelay = maxDelay === undefined ? DEFAULT_MAX_RETRY_DELAY_MS : maxDelay;

  if (
    !Number.isSafeInteger(resolvedMaxRetries) || (resolvedMaxRetries as number) < 0 ||
    (resolvedMaxRetries as number) > MAX_RETRIES
  ) {
    invalidFSAdapterConfig(
      `Veryfront filesystem retry.maxRetries must be an integer between 0 and ${MAX_RETRIES}`,
    );
  }
  for (
    const [field, value] of [
      ["initialDelay", resolvedInitialDelay],
      ["maxDelay", resolvedMaxDelay],
      ["retryDelay", retryDelay],
    ] as const
  ) {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || (value as number) < 0 ||
        (value as number) > MAX_TIMER_DELAY_MS)
    ) {
      invalidFSAdapterConfig(
        `Veryfront filesystem retry.${field} must be an integer between 0 and ${MAX_TIMER_DELAY_MS} milliseconds`,
      );
    }
  }

  return Object.freeze({
    maxRetries: resolvedMaxRetries as number,
    initialDelay: resolvedInitialDelay as number,
    maxDelay: resolvedMaxDelay as number,
  });
}

export function buildFileCacheOptions(
  cache?: CacheOverrides,
): FileCacheOptions {
  let enabled: unknown;
  let ttl: unknown;
  if (cache !== undefined) {
    assertReadableConfigObject(cache, "Veryfront filesystem cache configuration");
    enabled = readConfigProperty(cache, "enabled", "Veryfront filesystem cache configuration");
    ttl = readConfigProperty(cache, "ttl", "Veryfront filesystem cache configuration");
  }
  if (enabled !== undefined && typeof enabled !== "boolean") {
    invalidFSAdapterConfig("Veryfront filesystem cache.enabled must be a boolean");
  }
  if (ttl !== undefined && (typeof ttl !== "number" || !Number.isFinite(ttl) || ttl <= 0)) {
    invalidFSAdapterConfig("Veryfront filesystem cache.ttl must be a positive finite number");
  }

  return Object.freeze({
    enabled: true,
    ttl: DEFAULT_CACHE_TTL_MS,
    maxSize: DEFAULT_CACHE_MAX_ENTRIES,
    maxMemory: DEFAULT_CACHE_MAX_MEMORY_BYTES,
    ...(enabled === undefined ? {} : { enabled }),
    ...(ttl === undefined ? {} : { ttl }),
  }) as FileCacheOptions;
}

export function shouldBackgroundPregenerateStyles(
  contentContext: { sourceType: ContentSource["type"] } | null,
): boolean {
  return contentContext?.sourceType !== "branch";
}
