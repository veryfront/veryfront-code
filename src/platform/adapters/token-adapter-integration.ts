
import { logger } from "@veryfront/utils";
import { createTokenStorageAdapter } from "./token-adapter-factory.ts";
import type {
  TokenStorageAdapter,
  TokenStorageAdapterConfig,
} from "./veryfront-token-adapter/types.ts";

let tokenStorageAdapter: TokenStorageAdapter | null = null;

export async function getTokenStorageAdapter(): Promise<TokenStorageAdapter> {
  if (tokenStorageAdapter) {
    return tokenStorageAdapter;
  }

  const adapterConfig = buildAdapterConfigFromEnv();
  tokenStorageAdapter = await createTokenStorageAdapter(adapterConfig);

  return tokenStorageAdapter;
}

export function isTokenStorageConfigured(): boolean {
  const apiToken = getEnvVar("VERYFRONT_API_TOKEN");
  const projectSlug = getEnvVar("VERYFRONT_PROJECT_SLUG");

  return !!(apiToken && projectSlug);
}

export function getTokenStorageType(): string {
  if (isTokenStorageConfigured()) {
    return "veryfront-api";
  }
  return "memory";
}

export function resetTokenStorageAdapter(): void {
  if (tokenStorageAdapter?.dispose) {
    tokenStorageAdapter.dispose();
  }
  tokenStorageAdapter = null;
}

function buildAdapterConfigFromEnv(): TokenStorageAdapterConfig {
  const apiToken = getEnvVar("VERYFRONT_API_TOKEN");
  const projectSlug = getEnvVar("VERYFRONT_PROJECT_SLUG");
  const baseUrl = getEnvVar("VERYFRONT_API_URL");

  if (apiToken && projectSlug) {
    logger.debug("[TokenAdapterIntegration] Using Veryfront Cloud storage", {
      projectSlug,
    });

    return {
      type: "veryfront-api",
      veryfront: {
        apiToken,
        projectSlug,
        baseUrl,
      },
    };
  }

  logger.debug("[TokenAdapterIntegration] Using in-memory storage (development)");

  return { type: "memory" };
}

function getEnvVar(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  return (globalThis as any).Deno?.env?.get(name) ||
    (typeof process !== "undefined" ? process.env?.[name] : undefined);
}
