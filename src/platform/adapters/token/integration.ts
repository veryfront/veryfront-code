import { logger as baseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { getEnv, getHostEnv } from "#veryfront/platform/compat/process/env.ts";
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
  return Boolean(getApiToken() && getEnvVar("VERYFRONT_PROJECT_SLUG"));
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
  const apiToken = getApiToken();
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

/**
 * Resolve the Veryfront API token for the storage adapter.
 *
 * A stored `veryfront login` token is registered host-privately by the CLI
 * rather than exported into the process environment, so it never reaches
 * `getEnv()`. Falling back to `getHostEnv()` keeps a CLI-authenticated linked
 * session on `veryfront-api` storage, exactly as when the token was exported.
 * The credential stays inside the adapter config, which project code cannot
 * reach: `getHostEnv` is absent from the public platform exports.
 * An exported token wins when it is a usable (non-blank) value.
 */
function getApiToken(): string | undefined {
  const exported = getEnvVar("VERYFRONT_API_TOKEN");
  if (exported !== undefined && exported.trim() !== "") return exported;
  return getHostEnv("VERYFRONT_API_TOKEN");
}
