import type {
  AuthorizationUrlOptions,
  OAuthProviderConfig,
  OAuthServiceConfig,
  OAuthState,
  OAuthTokens,
  TokenExchangeOptions,
  TokenExchangeResult,
  TokenStore,
} from "../types.ts";
import { getEnv } from "#veryfront/platform/compat/process.ts";

export type EnvReader = (key: string) => string | undefined;

function generateRandomString(length: number): string {
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, length);
}

function generateCodeVerifier(): string {
  return generateRandomString(64);
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export class OAuthProvider {
  protected config: OAuthProviderConfig;
  protected envReader: EnvReader;

  constructor(config: OAuthProviderConfig, envReader: EnvReader = getEnv) {
    this.config = config;
    this.envReader = envReader;
  }

  getClientId(): string | null {
    return this.envReader(this.config.clientIdEnvVar) ?? null;
  }

  getClientSecret(): string | null {
    return this.envReader(this.config.clientSecretEnvVar) ?? null;
  }

  isConfigured(): boolean {
    return !!(this.getClientId() && this.getClientSecret());
  }

  async createAuthorizationUrl(
    options: AuthorizationUrlOptions & { defaultScopes?: string[] } = {},
  ): Promise<{ url: string; state: OAuthState }> {
    const clientId = this.getClientId();
    if (!clientId) throw new Error(`${this.config.clientIdEnvVar} not configured`);

    const state = options.state ?? generateRandomString(32);
    const scopes = options.scopes ?? options.defaultScopes ?? [];
    const redirectUri = options.redirectUri ?? "";
    const usePkce = options.usePkce !== false;

    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (usePkce) {
      codeVerifier = generateCodeVerifier();
      codeChallenge = await generateCodeChallenge(codeVerifier);
    }

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      state,
      ...(scopes.length > 0 ? { scope: scopes.join(" ") } : {}),
      ...(codeChallenge
        ? {
          code_challenge: codeChallenge,
          code_challenge_method: "S256",
        }
        : {}),
      ...this.config.additionalAuthParams,
      ...options.additionalParams,
    });

    return {
      url: `${this.config.authorizationUrl}?${params.toString()}`,
      state: {
        state,
        codeVerifier,
        redirectUri,
        scopes,
        createdAt: Date.now(),
      },
    };
  }

  private buildTokenHeaders(clientId: string, clientSecret: string): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };

    if (this.config.useBasicAuth) {
      headers.Authorization = `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
    }

    return headers;
  }

  private parseTokenResponse(
    data: Record<string, unknown>,
    fallbackRefreshToken?: string,
  ): OAuthTokens {
    const mapping = this.config.tokenResponseMapping ?? {};

    const accessToken = data[mapping.accessToken ?? "access_token"] as string;
    const refreshToken = (data[mapping.refreshToken ?? "refresh_token"] as string | undefined) ??
      fallbackRefreshToken;
    const tokenType = data[mapping.tokenType ?? "token_type"] as string;
    const scope = data[mapping.scope ?? "scope"] as string;
    const idToken = data.id_token as string | undefined;

    const tokens: OAuthTokens = {
      accessToken,
      refreshToken,
      tokenType,
      scope,
      idToken,
    };

    const expiresIn = data[mapping.expiresIn ?? "expires_in"] as number | undefined;
    if (expiresIn) tokens.expiresAt = Date.now() + expiresIn * 1000;

    return tokens;
  }

  private async postTokenRequest(
    body: URLSearchParams,
    clientId: string,
    clientSecret: string,
  ): Promise<{ response: Response; data: any }> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: this.buildTokenHeaders(clientId, clientSecret),
      body: body.toString(),
    });

    const data = await response.json();
    return { response, data };
  }

  async exchangeCode(options: TokenExchangeOptions): Promise<TokenExchangeResult> {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: "OAuth not configured",
        errorDescription:
          `Missing ${this.config.clientIdEnvVar} or ${this.config.clientSecretEnvVar}`,
      };
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
      ...(options.codeVerifier ? { code_verifier: options.codeVerifier } : {}),
      ...(!this.config.useBasicAuth
        ? {
          client_id: clientId,
          client_secret: clientSecret,
        }
        : {}),
      ...this.config.additionalTokenParams,
    });

    try {
      const { response, data } = await this.postTokenRequest(body, clientId, clientSecret);

      if (!response.ok) {
        return {
          success: false,
          error: data.error || "token_exchange_failed",
          errorDescription: data.error_description || `Status ${response.status}`,
        };
      }

      return { success: true, tokens: this.parseTokenResponse(data) };
    } catch (error) {
      return {
        success: false,
        error: "network_error",
        errorDescription: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async refreshTokens(refreshToken: string): Promise<TokenExchangeResult> {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      return { success: false, error: "OAuth not configured" };
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      ...(!this.config.useBasicAuth
        ? {
          client_id: clientId,
          client_secret: clientSecret,
        }
        : {}),
    });

    try {
      const { response, data } = await this.postTokenRequest(body, clientId, clientSecret);

      if (!response.ok) {
        return {
          success: false,
          error: data.error || "refresh_failed",
          errorDescription: data.error_description,
        };
      }

      return { success: true, tokens: this.parseTokenResponse(data, refreshToken) };
    } catch (error) {
      return {
        success: false,
        error: "network_error",
        errorDescription: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async revokeToken(token: string): Promise<boolean> {
    const revocationUrl = this.config.revocationUrl;
    if (!revocationUrl) return false;

    try {
      const response = await fetch(revocationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}

export class OAuthService extends OAuthProvider {
  protected serviceConfig: OAuthServiceConfig;
  protected tokenStore?: TokenStore;

  constructor(config: OAuthServiceConfig, tokenStore?: TokenStore, envReader?: EnvReader) {
    super(config, envReader);
    this.serviceConfig = config;
    this.tokenStore = tokenStore;
  }

  get serviceId(): string {
    return this.serviceConfig.serviceId;
  }

  get apiBaseUrl(): string {
    return this.serviceConfig.apiBaseUrl;
  }

  override createAuthorizationUrl(
    options: AuthorizationUrlOptions = {},
  ): Promise<{ url: string; state: OAuthState }> {
    return super.createAuthorizationUrl({
      ...options,
      defaultScopes: this.serviceConfig.defaultScopes,
    });
  }

  async getAccessToken(): Promise<string | null> {
    const tokens = await this.tokenStore?.getTokens(this.serviceId);
    if (!tokens) return null;

    const isExpired = tokens.expiresAt && Date.now() > tokens.expiresAt - 300000;
    if (!isExpired) return tokens.accessToken;

    if (!tokens.refreshToken) return null;

    const result = await this.refreshTokens(tokens.refreshToken);
    if (!result.success || !result.tokens) return null;

    await this.tokenStore!.setTokens(this.serviceId, result.tokens);
    return result.tokens.accessToken;
  }

  async fetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken();
    if (!token) throw new Error(`Not authenticated with ${this.serviceConfig.displayName}`);

    const url = endpoint.startsWith("http") ? endpoint : `${this.apiBaseUrl}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`${this.serviceConfig.displayName} API error: ${response.status} ${error}`);
    }

    return response.json();
  }
}
