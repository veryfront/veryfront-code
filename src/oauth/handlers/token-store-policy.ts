import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { memoryTokenStore } from "../token-store/memory.ts";
import type { TokenStore } from "../types.ts";
import { isExplicitLocalOAuthEnvironment } from "../url-utils.ts";

/** Resolve the handler store without silently using process-local state in deployments. */
export function resolveOAuthHandlerTokenStore(
  tokenStore: TokenStore | undefined,
  env: EnvironmentConfig,
): TokenStore {
  if (tokenStore) return tokenStore;
  if (isExplicitLocalOAuthEnvironment(env)) return memoryTokenStore;
  throw new Error(
    "OAuth handlers require an explicit shared TokenStore outside development/test",
  );
}
