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
import { INVALID_ARGUMENT, TOKEN_STORAGE_ERROR } from "#veryfront/errors";
import { logger as baseLogger } from "#veryfront/utils";

const logger = baseLogger.component("o-auth");

/** Buffer before token expiry to trigger proactive refresh (5 minutes). */
const TOKEN_REFRESH_BUFFER_MS = 300_000;

/** Multiplier to convert `expires_in` (seconds) to milliseconds. */
const SECONDS_TO_MS = 1_000;

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

/** Implement oauth provider. */
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
    if (!clientId) {
      throw INVALID_ARGUMENT.create({ detail: `${this.config.clientIdEnvVar} not configured` });
    }

    const state = options.state ?? generateRandomString(32);
    const scopes = options.scopes ?? options.defaultScopes ?? [];
    if (scopes.length === 0) {
      logger.warn(
        "createAuthorizationUrl: no scopes configured; OAuth request will have empty scope set",
        {
          clientIdEnvVar: this.config.clientIdEnvVar,
        },
      );
    }
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
      ...(scopes.length ? { scope: scopes.join(" ") } : {}),
      ...(codeChallenge ? { code_challenge: codeChallenge, code_challenge_method: "S256" } : {}),
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

  /**
   * Parse a successful token-endpoint body into {@link OAuthTokens}.
   *
   * Returns `null` when the response carries no usable access token. A 2xx
   * status alone is NOT sufficient evidence of success: some providers (e.g.
   * Slack) signal errors with `200 {"ok": false, "error": ...}`, and a missing
   * `access_token` must never be persisted as an empty-but-"connected" token.
   * See bugs H11/H12.
   */
  private parseTokenResponse(
    data: Record<string, unknown>,
    fallbackRefreshToken?: string,
  ): OAuthTokens | null {
    const mapping = this.config.tokenResponseMapping ?? {};

    const str = (key: string): string => {
      const v = data[key];
      return typeof v === "string" ? v : "";
    };
    const optStr = (key: string): string | undefined => {
      const v = data[key];
      return typeof v === "string" ? v : undefined;
    };

    const accessToken = str(mapping.accessToken ?? "access_token");
    if (!accessToken) return null;
    const refreshToken = optStr(mapping.refreshToken ?? "refresh_token") ??
      fallbackRefreshToken;
    const tokenType = str(mapping.tokenType ?? "token_type");
    const scope = str(mapping.scope ?? "scope");
    // SECURITY: the id_token is captured verbatim and persisted WITHOUT any
    // verification (no signature/aud/iss/exp/nonce validation). It MUST NOT be
    // used for any authentication or authorization decision unless fully
    // verified as a JWT first.
    const idToken = optStr("id_token");

    const tokens: OAuthTokens = {
      accessToken,
      refreshToken,
      tokenType,
      scope,
      idToken,
    };

    const rawExpiresIn = data[mapping.expiresIn ?? "expires_in"];
    const expiresIn = typeof rawExpiresIn === "number"
      ? rawExpiresIn
      : typeof rawExpiresIn === "string"
      ? Number(rawExpiresIn) || undefined
      : undefined;
    if (expiresIn) tokens.expiresAt = Date.now() + expiresIn * SECONDS_TO_MS;

    return tokens;
  }

  private async postTokenRequest(
    body: URLSearchParams,
    clientId: string,
    clientSecret: string,
  ): Promise<{ response: Response; data: Record<string, unknown> }> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: this.buildTokenHeaders(clientId, clientSecret),
      body: body.toString(),
    });

    const data = await response.json();
    return { response, data };
  }

  private buildClientCredentialsParams(
    clientId: string,
    clientSecret: string,
  ): Record<string, string> {
    if (this.config.useBasicAuth) return {};
    return { client_id: clientId, client_secret: clientSecret };
  }

  private async exchangeToken(
    body: URLSearchParams,
    clientId: string,
    clientSecret: string,
    errorFallback: string,
    errorDescriptionFallback?: (status: number) => string,
    fallbackRefreshToken?: string,
  ): Promise<TokenExchangeResult> {
    try {
      const { response, data } = await this.postTokenRequest(body, clientId, clientSecret);

      // Some providers signal errors with a 2xx status and a body-level
      // `ok: false` / `error` field (e.g. Slack oauth.v2.access). Treat those
      // as failures even when the HTTP status is "ok". See bug H12.
      const bodyError = typeof data.error === "string" ? data.error : "";
      if (!response.ok || data.ok === false || bodyError) {
        return {
          success: false,
          error: bodyError || errorFallback,
          errorDescription:
            (typeof data.error_description === "string" ? data.error_description : "") ||
            (errorDescriptionFallback ? errorDescriptionFallback(response.status) : undefined),
        };
      }

      // A 2xx without a usable access token is not a success. See bug H11.
      const tokens = this.parseTokenResponse(data, fallbackRefreshToken);
      if (!tokens) {
        return { success: false, error: "invalid_token_response" };
      }

      return { success: true, tokens };
    } catch (error) {
      return {
        success: false,
        error: "network_error",
        errorDescription: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  async exchangeCode(options: TokenExchangeOptions): Promise<TokenExchangeResult> {
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: "OAuth not configured",
        // Don't leak internal env var names to the caller; this result can
        // propagate to HTTP responses via OAuthService.
        errorDescription: "OAuth provider credentials are not configured",
      };
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: options.code,
      redirect_uri: options.redirectUri,
      ...(options.codeVerifier ? { code_verifier: options.codeVerifier } : {}),
      ...this.buildClientCredentialsParams(clientId, clientSecret),
      ...this.config.additionalTokenParams,
    });

    return this.exchangeToken(
      body,
      clientId,
      clientSecret,
      "token_exchange_failed",
      (status) => `Status ${status}`,
    );
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
      ...this.buildClientCredentialsParams(clientId, clientSecret),
    });

    return this.exchangeToken(
      body,
      clientId,
      clientSecret,
      "refresh_failed",
      undefined,
      refreshToken,
    );
  }

  async revokeToken(token: string): Promise<boolean> {
    const { revocationUrl } = this.config;
    if (!revocationUrl) {
      // No revocation endpoint configured — nothing was ever sent to the
      // provider. Logged at debug so a false return is distinguishable from an
      // attempted-but-failed revocation.
      logger.debug("Token revocation skipped: no revocationUrl configured");
      return false;
    }

    try {
      const response = await fetch(revocationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
      });

      if (!response.ok) {
        logger.warn("Token revocation request rejected by provider", {
          status: response.status,
        });
      }
      return response.ok;
    } catch (error) {
      // Network failure: the request may never have reached the provider, so
      // the token could still be live. Surface it rather than swallowing it, so
      // security-critical disconnect flows don't report success on a no-op.
      logger.warn("Token revocation request failed to reach provider", {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

/**
 * Module-level singleflight for token refreshes, scoped by TokenStore instance
 * and then `(serviceId, userId)`. This dedupes separate OAuthService instances
 * that share the same scoped store without making different project stores
 * share refresh promises.
 */
const refreshInFlightByStore = new WeakMap<TokenStore, Map<string, Promise<string | null>>>();

function getRefreshInFlight(
  tokenStore: TokenStore,
  key: string,
): Promise<string | null> | undefined {
  return refreshInFlightByStore.get(tokenStore)?.get(key);
}

function setRefreshInFlight(
  tokenStore: TokenStore,
  key: string,
  promise: Promise<string | null>,
): void {
  let storeInflight = refreshInFlightByStore.get(tokenStore);
  if (!storeInflight) {
    storeInflight = new Map();
    refreshInFlightByStore.set(tokenStore, storeInflight);
  }
  storeInflight.set(key, promise);
}

function clearRefreshInFlight(
  tokenStore: TokenStore,
  key: string,
  promise: Promise<string | null>,
): void {
  const storeInflight = refreshInFlightByStore.get(tokenStore);
  if (!storeInflight || storeInflight.get(key) !== promise) return;
  storeInflight.delete(key);
  if (storeInflight.size === 0) {
    refreshInFlightByStore.delete(tokenStore);
  }
}

/** Implement oauth service. */
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

  /**
   * Get a valid access token for the given user, refreshing if needed.
   *
   * `userId` is required — this store is keyed by `(serviceId, userId)` to
   * prevent one user's OAuth completion from overwriting another user's
   * tokens. See VULN-AUTH-2.
   */
  async getAccessToken(userId: string): Promise<string | null> {
    const tokens = await this.tokenStore?.getTokens(this.serviceId, userId);
    if (!tokens) return null;

    const isExpired = tokens.expiresAt && Date.now() > tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS;
    if (!isExpired) return tokens.accessToken;

    if (!tokens.refreshToken) return null;

    if (!this.tokenStore) {
      throw TOKEN_STORAGE_ERROR.create({ detail: "TokenStore not configured" });
    }

    const key = JSON.stringify([this.serviceId, userId]);
    const existingRefresh = getRefreshInFlight(this.tokenStore, key);
    if (existingRefresh) return existingRefresh;

    const tokenStore = this.tokenStore;
    const refreshPromise = this.refreshAndStoreAccessToken(userId, tokens.refreshToken);
    setRefreshInFlight(tokenStore, key, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      clearRefreshInFlight(tokenStore, key, refreshPromise);
    }
  }

  private async refreshAndStoreAccessToken(
    userId: string,
    refreshToken: string,
  ): Promise<string | null> {
    const result = await this.refreshTokens(refreshToken);
    if (!result.success || !result.tokens) return null;

    if (!this.tokenStore) {
      throw TOKEN_STORAGE_ERROR.create({ detail: "TokenStore not configured" });
    }
    await this.tokenStore.setTokens(this.serviceId, userId, result.tokens);
    return result.tokens.accessToken;
  }

  /**
   * Resolve `endpoint` against `apiBaseUrl`, validating that absolute URLs
   * share the configured origin.
   *
   * Without this check, a caller that forwards user-controlled data as
   * `endpoint` could cause `fetch()` to issue requests to arbitrary hosts
   * (including cloud metadata services and internal infrastructure). See
   * SEC-003 in the security audit.
   */
  private resolveEndpointUrl(endpoint: string): string {
    if (!endpoint.startsWith("http")) {
      return `${this.apiBaseUrl}${endpoint}`;
    }
    let target: URL;
    let allowed: URL;
    try {
      target = new URL(endpoint);
      allowed = new URL(this.apiBaseUrl);
    } catch {
      throw INVALID_ARGUMENT.create({
        detail: `Invalid OAuth endpoint URL`,
      });
    }
    if (target.origin !== allowed.origin) {
      throw INVALID_ARGUMENT.create({
        detail:
          `OAuth endpoint origin ${target.origin} does not match configured ${allowed.origin}`,
      });
    }
    return endpoint;
  }

  async fetch<T>(userId: string, endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw TOKEN_STORAGE_ERROR.create({
        detail: `Not authenticated with ${this.serviceConfig.displayName}`,
      });
    }

    const url = this.resolveEndpointUrl(endpoint);

    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });

    if (!response.ok) {
      logger.error("OAuth provider API error", {
        serviceId: this.serviceConfig.serviceId,
        status: response.status,
      });
      throw INVALID_ARGUMENT.create({
        detail: `${this.serviceConfig.displayName} API error: ${response.status}`,
      });
    }

    return response.json();
  }
}
