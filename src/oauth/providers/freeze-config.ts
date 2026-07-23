import type { OAuthServiceConfig } from "../types.ts";

/** Freeze built-in provider metadata so one consumer cannot alter global OAuth behavior. */
export function freezeOAuthServiceConfigs<T extends Record<string, OAuthServiceConfig>>(
  configs: T,
): T {
  for (const config of Object.values(configs)) {
    Object.freeze(config.defaultScopes);
    if (config.additionalAuthParams) Object.freeze(config.additionalAuthParams);
    if (config.additionalTokenParams) Object.freeze(config.additionalTokenParams);
    if (config.tokenResponseMapping) Object.freeze(config.tokenResponseMapping);
    Object.freeze(config);
  }
  return Object.freeze(configs);
}
