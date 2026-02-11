import { logger as baseLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { createTokenStorageAdapter } from "./factory.ts";
import type { TokenStorageAdapter, TokenStorageAdapterConfig } from "./veryfront/types.ts";

const logger = baseLogger.component("token-adapter-integration");

let tokenStorageAdapter: TokenStorageAdapter | null = null;

export function getTokenStorageAdapter(): Promise<TokenStorageAdapter> {
  if (tokenStorageAdapter) return Promise.resolve(tokenStorageAdapter);

  return withSpan(
    "platform.token.getTokenStorageAdapter",
    async () => {
      const adapterConfig = buildAdapterConfigFromEnv();
      tokenStorageAdapter = await createTokenStorageAdapter(adapterConfig);
      return tokenStorageAdapter;
    },
    { "token.storage.type": getTokenStorageType() },
  );
}

export function isTokenStorageConfigured(): boolean {
  return Boolean(getEnvVar("VERYFRONT_API_TOKEN") && getEnvVar("VERYFRONT_PROJECT_SLUG"));
}

export function getTokenStorageType(): string {
  return isTokenStorageConfigured() ? "veryfront-api" : "memory";
}

export function resetTokenStorageAdapter(): void {
  tokenStorageAdapter?.dispose?.();
  tokenStorageAdapter = null;
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
  return globalThis.Deno?.env?.get(name) ??
    (typeof process !== "undefined" ? process.env?.[name] : undefined);
}
