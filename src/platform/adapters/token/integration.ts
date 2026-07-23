import { logger as baseLogger } from "#veryfront/utils/logger/logger.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { CONFIG_INVALID } from "#veryfront/errors/error-registry/config.ts";
import { INITIALIZATION_ERROR } from "#veryfront/errors/error-registry/general.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { createTokenStorageAdapter } from "./factory.ts";
import type { TokenStorageAdapter, TokenStorageAdapterConfig } from "./veryfront/types.ts";

const logger = baseLogger.component("token-adapter-integration");

let tokenStorageAdapter: TokenStorageAdapter | null = null;
let initializationGeneration = 0;
let pendingInitialization:
  | { generation: number; promise: Promise<TokenStorageAdapter> }
  | null = null;

export function getTokenStorageAdapter(): Promise<TokenStorageAdapter> {
  if (tokenStorageAdapter) return Promise.resolve(tokenStorageAdapter);
  const generation = initializationGeneration;
  if (pendingInitialization?.generation === generation) {
    return pendingInitialization.promise;
  }

  const promise = withSpan(
    "platform.token.getTokenStorageAdapter",
    async () => {
      const adapterConfig = buildAdapterConfigFromEnv();
      const adapter = await createTokenStorageAdapter(adapterConfig);
      if (generation !== initializationGeneration) {
        disposeAdapter(adapter);
        throw INITIALIZATION_ERROR.create({
          message: "Token storage initialization was reset before it completed",
        });
      }
      tokenStorageAdapter = adapter;
      return adapter;
    },
    { "token.storage.type": getTokenStorageType() },
  );
  const trackedPromise = promise.finally(() => {
    if (pendingInitialization?.generation === generation) {
      pendingInitialization = null;
    }
  });
  pendingInitialization = { generation, promise: trackedPromise };
  return trackedPromise;
}

export function isTokenStorageConfigured(): boolean {
  return Boolean(
    getHostEnv("VERYFRONT_API_TOKEN") && getHostEnv("VERYFRONT_PROJECT_SLUG"),
  );
}

export function getTokenStorageType(): string {
  return isTokenStorageConfigured() ? "veryfront-api" : "memory";
}

export function resetTokenStorageAdapter(): void {
  initializationGeneration++;
  const adapter = tokenStorageAdapter;
  tokenStorageAdapter = null;
  pendingInitialization = null;
  if (adapter) disposeAdapter(adapter);
}

function buildAdapterConfigFromEnv(): TokenStorageAdapterConfig {
  const apiToken = getHostEnv("VERYFRONT_API_TOKEN");
  const projectSlug = getHostEnv("VERYFRONT_PROJECT_SLUG");
  const apiBaseUrl = getHostEnv("VERYFRONT_API_BASE_URL") ??
    getHostEnv("VERYFRONT_API_URL");

  if (!apiToken && !projectSlug) {
    logger.debug("Using in-memory storage (development)");
    return { type: "memory" };
  }
  if (!apiToken || !projectSlug) {
    throw CONFIG_INVALID.create({
      message:
        "Veryfront token storage requires both VERYFRONT_API_TOKEN and VERYFRONT_PROJECT_SLUG",
    });
  }

  logger.debug("Using Veryfront Cloud token storage");

  return {
    type: "veryfront-api",
    veryfront: { apiToken, projectSlug, apiBaseUrl },
  };
}

function disposeAdapter(adapter: TokenStorageAdapter): void {
  try {
    adapter.dispose?.();
  } catch {
    logger.error("Token storage adapter disposal failed");
  }
}
