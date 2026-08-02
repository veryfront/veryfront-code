import { logger as baseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getEnv } from "#veryfront/platform/compat/process/env.ts";
import { createTokenStorageAdapter } from "./factory.ts";
import type { TokenStorageAdapter, TokenStorageAdapterConfig } from "./veryfront/types.ts";

const logger = baseLogger.component("token-adapter-integration");

let tokenStorageAdapter: TokenStorageAdapter | null = null;
let tokenStorageAdapterCreation: Promise<TokenStorageAdapter> | null = null;
let tokenStorageGeneration = 0;

export function getTokenStorageAdapter(): Promise<TokenStorageAdapter> {
  if (tokenStorageAdapter) return Promise.resolve(tokenStorageAdapter);
  if (tokenStorageAdapterCreation) return tokenStorageAdapterCreation;

  const generation = tokenStorageGeneration;
  const rawCreation = withSpan(
    "platform.token.getTokenStorageAdapter",
    async () => {
      const adapterConfig = buildAdapterConfigFromEnv();
      const candidate = await createTokenStorageAdapter(adapterConfig);
      if (generation !== tokenStorageGeneration) {
        candidate.dispose?.();
        throw new Error("Token storage adapter creation was invalidated by reset");
      }
      tokenStorageAdapter = candidate;
      return candidate;
    },
    { "token.storage.type": getTokenStorageType() },
  );
  const trackedCreation = rawCreation.finally(() => {
    if (tokenStorageAdapterCreation === trackedCreation) {
      tokenStorageAdapterCreation = null;
    }
  });
  tokenStorageAdapterCreation = trackedCreation;
  return trackedCreation;
}

export function isTokenStorageConfigured(): boolean {
  return Boolean(getEnvVar("VERYFRONT_API_TOKEN") && getEnvVar("VERYFRONT_PROJECT_SLUG"));
}

export function getTokenStorageType(): string {
  return isTokenStorageConfigured() ? "veryfront-api" : "memory";
}

export function resetTokenStorageAdapter(): void {
  tokenStorageGeneration++;
  tokenStorageAdapter?.dispose?.();
  tokenStorageAdapter = null;
  tokenStorageAdapterCreation = null;
}

function buildAdapterConfigFromEnv(): TokenStorageAdapterConfig {
  const apiToken = getEnvVar("VERYFRONT_API_TOKEN");
  const projectSlug = getEnvVar("VERYFRONT_PROJECT_SLUG");
  const apiBaseUrl = getEnvVar("VERYFRONT_API_URL");

  if (!apiToken || !projectSlug) {
    logger.debug("Using in-memory storage (development)");
    return { type: "memory" };
  }

  logger.debug("Using Veryfront Cloud storage", { projectSlug });

  return {
    type: "veryfront-api",
    veryfront: { apiToken, projectSlug, apiBaseUrl },
  };
}

function getEnvVar(name: string): string | undefined {
  return getEnv(name);
}
