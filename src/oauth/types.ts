// Re-export schema-based types
export type {
  AuthorizationUrlOptions,
  OAuthProviderConfig,
  OAuthServiceConfig,
  OAuthState,
  OAuthTokens,
  TokenExchangeOptions,
  TokenExchangeResult,
} from "./schemas/index.ts";

// Import types used locally in this file
import type { OAuthState, OAuthTokens } from "./schemas/index.ts";

export interface TokenStore {
  getTokens(serviceId: string): Promise<OAuthTokens | null>;
  setTokens(serviceId: string, tokens: OAuthTokens): Promise<void>;
  clearTokens(serviceId: string): Promise<void>;
  getState(state: string): Promise<OAuthState | null>;
  setState(state: OAuthState): Promise<void>;
  clearState(state: string): Promise<void>;
}
