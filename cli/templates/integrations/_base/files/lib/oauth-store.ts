import { MemoryTokenStore } from "veryfront/oauth";
import {
  type ApplicationOAuthTokenStore,
  getInstalledOAuthTokenStore,
  type OAuthStorageStatus,
  readOAuthStorageStatus,
} from "./oauth-store-registry.ts";
import {
  ATLASSIAN_OAUTH_TOKEN_SERVICE_ALIASES,
  createOAuthTokenStoreWithServiceAliases,
} from "./oauth-token-service-aliases.ts";
import { readEnvironmentVariable } from "./environment.ts";

function isExplicitDevelopmentMemoryMode(): boolean {
  const runtime = readEnvironmentVariable("NODE_ENV");
  return (runtime === "development" || runtime === "test") &&
    readEnvironmentVariable("VERYFRONT_OAUTH_STORE_MODE") === "memory";
}

function resolveApplicationOAuthTokenStore(): ApplicationOAuthTokenStore {
  const installed = getInstalledOAuthTokenStore();
  if (installed) return installed;

  if (isExplicitDevelopmentMemoryMode()) {
    return Object.assign(new MemoryTokenStore("generated-application"), {
      getStorageStatus(): OAuthStorageStatus {
        return { mode: "memory", durable: false, encrypted: false };
      },
    });
  }

  throw new Error(
    "OAuth TokenStore is not configured. Install one durable " +
      "ApplicationOAuthTokenStore from lib/oauth-store-registry.ts during application " +
      "startup. For local development only, set NODE_ENV=development and " +
      "VERYFRONT_OAUTH_STORE_MODE=memory.",
  );
}

/**
 * One shared store for OAuth state, tokens, revisioned refresh, and API access.
 * Resolution is deliberately eager: production startup fails if application
 * instrumentation did not install a durable store before route modules load.
 */
export const oauthTokenStore: ApplicationOAuthTokenStore =
  createOAuthTokenStoreWithServiceAliases(
    resolveApplicationOAuthTokenStore(),
    ATLASSIAN_OAUTH_TOKEN_SERVICE_ALIASES,
  );

/** Return capabilities reported by the selected adapter after validation. */
export function getOAuthStorageStatus(): OAuthStorageStatus {
  return readOAuthStorageStatus(oauthTokenStore);
}

export type { ApplicationOAuthTokenStore, OAuthStorageStatus };
