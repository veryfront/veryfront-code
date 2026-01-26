export interface OAuthProviderConfig {
  providerId: string;
  displayName: string;
  authorizationUrl: string;
  tokenUrl: string;
  userInfoUrl?: string;
  revocationUrl?: string;
  clientIdEnvVar: string;
  clientSecretEnvVar: string;
  additionalAuthParams?: Record<string, string>;
  additionalTokenParams?: Record<string, string>;
  useBasicAuth?: boolean;
  tokenResponseMapping?: {
    accessToken?: string;
    refreshToken?: string;
    expiresIn?: string;
    tokenType?: string;
    scope?: string;
  };
}

export interface OAuthServiceConfig extends OAuthProviderConfig {
  serviceId: string;
  defaultScopes: string[];
  apiBaseUrl: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType?: string;
  scope?: string;
  idToken?: string;
}

export interface OAuthState {
  state: string;
  codeVerifier?: string;
  redirectUri: string;
  scopes: string[];
  createdAt: number;
  metadata?: Record<string, unknown>;
}

export interface TokenExchangeResult {
  success: boolean;
  tokens?: OAuthTokens;
  error?: string;
  errorDescription?: string;
}

export interface AuthorizationUrlOptions {
  scopes?: string[];
  state?: string;
  usePkce?: boolean;
  additionalParams?: Record<string, string>;
  redirectUri?: string;
}

export interface TokenExchangeOptions {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface TokenStore {
  getTokens(serviceId: string): Promise<OAuthTokens | null>;
  setTokens(serviceId: string, tokens: OAuthTokens): Promise<void>;
  clearTokens(serviceId: string): Promise<void>;
  getState(state: string): Promise<OAuthState | null>;
  setState(state: OAuthState): Promise<void>;
  clearState(state: string): Promise<void>;
}
