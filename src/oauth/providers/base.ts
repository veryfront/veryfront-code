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
import { INVALID_ARGUMENT, NETWORK_ERROR, TOKEN_STORAGE_ERROR } from "#veryfront/errors";
import { base64urlEncodeBytes, logger as baseLogger } from "#veryfront/utils";
import { HTTP_FETCH_TIMEOUT_MS } from "#veryfront/utils/constants/index.ts";
import { readResponseTextPrefix } from "#veryfront/utils/response-body.ts";
import {
  isRefreshCapableTokenStore,
  normalizeOAuthTokenSnapshot,
  normalizeStoredOAuthTokens,
} from "../token-utils.ts";
import {
  MAX_OAUTH_API_RESPONSE_BYTES,
  MAX_OAUTH_AUTHORIZATION_CODE_LENGTH,
  MAX_OAUTH_CREDENTIAL_LENGTH,
  MAX_OAUTH_REQUEST_TIMEOUT_MS,
  MAX_OAUTH_SCOPE_WIRE_LENGTH,
  MAX_OAUTH_SERVICE_ID_LENGTH,
  MAX_OAUTH_TOKEN_RESPONSE_BYTES,
  MAX_OAUTH_TOKEN_TYPE_LENGTH,
  MAX_OAUTH_TOKEN_VALUE_LENGTH,
} from "../limits.ts";
import { isOAuthRedirectUrl, isSecureOAuthEndpointUrl } from "../url-validation.ts";
import { normalizeOAuthScopeSet } from "../scope-utils.ts";
import { normalizeOAuthUserId } from "../state-utils.ts";
import {
  getOAuthParameterRecordIssues,
  getOAuthStaticHeaderIssues,
  getOAuthTokenResponseMappingIssues,
  getReservedOAuthUrlParameterIssues,
  isValidOAuthDisplayName,
  isValidOAuthEnvironmentVariableName,
  isValidOAuthProviderId,
  RESERVED_API_HEADERS,
  RESERVED_AUTHORIZATION_PARAMETERS,
  RESERVED_TOKEN_PARAMETERS,
  RESERVED_TOKEN_REQUEST_HEADERS,
} from "../config-validation.ts";

const logger = baseLogger.component("o-auth");

/** Buffer before token expiry to trigger proactive refresh (5 minutes). */
const TOKEN_REFRESH_BUFFER_MS = 300_000;

/** Multiplier to convert `expires_in` (seconds) to milliseconds. */
const SECONDS_TO_MS = 1_000;
const DEFAULT_TOKEN_RESPONSE_MAX_BYTES = 64 * 1_024;
const DEFAULT_API_RESPONSE_MAX_BYTES = 1_048_576;

function assertBoundedPositiveInteger(value: number, name: string, maximum: number): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must be a positive integer no greater than ${maximum}`,
    });
  }
}

function assertTrimmedNonBlank(value: unknown, name: string): asserts value is string {
  if (typeof value !== "string" || !value || value.trim() !== value) {
    throw INVALID_ARGUMENT.create({ detail: `${name} must be trimmed and nonblank` });
  }
}

function assertHttpsUrl(value: unknown, name: string): asserts value is string {
  if (!isSecureOAuthEndpointUrl(value)) {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must be an absolute HTTPS URL without credentials or a fragment`,
    });
  }
}

function assertRedirectUrl(value: unknown, name: string): asserts value is string {
  if (!isOAuthRedirectUrl(value)) {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must use HTTPS (or HTTP on an explicit loopback host)`,
    });
  }
}

function assertNoReservedParameters(
  params: unknown,
  reserved: ReadonlySet<string>,
  kind: "authorization" | "token",
): void {
  const issue = getOAuthParameterRecordIssues(params, reserved)[0];
  if (issue) {
    throw INVALID_ARGUMENT.create({
      detail: issue.message.includes("reserved")
        ? `${issue.key} is a reserved OAuth ${kind} parameter`
        : `Invalid OAuth ${kind} parameter configuration: ${issue.message}`,
    });
  }
}

function cloneStaticHeaders(
  headers: unknown,
  reserved: ReadonlySet<string>,
  kind: "token request" | "API",
): Record<string, string> | undefined {
  if (headers === undefined) return undefined;
  const issue = getOAuthStaticHeaderIssues(headers, reserved)[0];
  if (issue) {
    throw INVALID_ARGUMENT.create({
      detail: issue.message.includes("reserved")
        ? `${issue.key} is a reserved OAuth ${kind} header`
        : `Invalid OAuth ${kind} header configuration: ${issue.message}`,
    });
  }
  const headerRecord = headers as Record<string, string>;
  const cloned: Record<string, string> = {};
  for (const [name, value] of Object.entries(headerRecord)) {
    cloned[name] = value;
  }
  return cloned;
}

function cloneProviderConfig(config: OAuthProviderConfig): OAuthProviderConfig {
  if (!isValidOAuthProviderId(config.providerId)) {
    throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth providerId" });
  }
  if (!isValidOAuthDisplayName(config.displayName)) {
    throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth displayName" });
  }
  if (!isValidOAuthEnvironmentVariableName(config.clientIdEnvVar)) {
    throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth clientIdEnvVar" });
  }
  if (!isValidOAuthEnvironmentVariableName(config.clientSecretEnvVar)) {
    throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth clientSecretEnvVar" });
  }
  assertHttpsUrl(config.authorizationUrl, "authorizationUrl");
  assertHttpsUrl(config.tokenUrl, "tokenUrl");
  if (config.userInfoUrl !== undefined) assertHttpsUrl(config.userInfoUrl, "userInfoUrl");
  if (config.revocationUrl !== undefined) assertHttpsUrl(config.revocationUrl, "revocationUrl");
  assertNoReservedParameters(
    config.additionalAuthParams,
    RESERVED_AUTHORIZATION_PARAMETERS,
    "authorization",
  );
  assertNoReservedParameters(config.additionalTokenParams, RESERVED_TOKEN_PARAMETERS, "token");
  if (
    config.scopeSeparator !== undefined && config.scopeSeparator !== " " &&
    config.scopeSeparator !== ","
  ) {
    throw INVALID_ARGUMENT.create({ detail: "scopeSeparator must be a space or comma" });
  }
  if (
    config.pkceMode !== undefined && config.pkceMode !== "required" &&
    config.pkceMode !== "supported" && config.pkceMode !== "unsupported"
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth PKCE capability mode" });
  }
  if (
    config.runtimeSupport !== undefined && config.runtimeSupport !== "generic" &&
    config.runtimeSupport !== "provider-adapter-required"
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth runtime support mode" });
  }
  if (
    config.tokenRequestFormat !== undefined && config.tokenRequestFormat !== "form" &&
    config.tokenRequestFormat !== "json"
  ) {
    throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth tokenRequestFormat" });
  }
  if (config.useBasicAuth !== undefined && typeof config.useBasicAuth !== "boolean") {
    throw INVALID_ARGUMENT.create({ detail: "OAuth useBasicAuth must be a boolean" });
  }
  const tokenRequestHeaders = cloneStaticHeaders(
    config.tokenRequestHeaders,
    RESERVED_TOKEN_REQUEST_HEADERS,
    "token request",
  );
  const apiHeaders = cloneStaticHeaders(config.apiHeaders, RESERVED_API_HEADERS, "API");
  const authorizationUrlIssue = getReservedOAuthUrlParameterIssues(
    config.authorizationUrl,
    RESERVED_AUTHORIZATION_PARAMETERS,
  )[0];
  if (authorizationUrlIssue) {
    throw INVALID_ARGUMENT.create({
      detail: `${authorizationUrlIssue.key} is a reserved OAuth authorization parameter`,
    });
  }
  const tokenUrlIssue = getReservedOAuthUrlParameterIssues(
    config.tokenUrl,
    RESERVED_TOKEN_PARAMETERS,
  )[0];
  if (tokenUrlIssue) {
    throw INVALID_ARGUMENT.create({
      detail: `${tokenUrlIssue.key} is a reserved OAuth token parameter`,
    });
  }
  const tokenMappingIssue = getOAuthTokenResponseMappingIssues(config.tokenResponseMapping)[0];
  if (tokenMappingIssue) {
    throw INVALID_ARGUMENT.create({
      detail: `Invalid OAuth tokenResponseMapping: ${tokenMappingIssue.message}`,
    });
  }
  if (config.requestTimeoutMs !== undefined) {
    assertBoundedPositiveInteger(
      config.requestTimeoutMs,
      "requestTimeoutMs",
      MAX_OAUTH_REQUEST_TIMEOUT_MS,
    );
  }
  if (config.maxTokenResponseBytes !== undefined) {
    assertBoundedPositiveInteger(
      config.maxTokenResponseBytes,
      "maxTokenResponseBytes",
      MAX_OAUTH_TOKEN_RESPONSE_BYTES,
    );
  }
  if (config.maxApiResponseBytes !== undefined) {
    assertBoundedPositiveInteger(
      config.maxApiResponseBytes,
      "maxApiResponseBytes",
      MAX_OAUTH_API_RESPONSE_BYTES,
    );
  }

  return {
    ...config,
    ...(config.additionalAuthParams
      ? { additionalAuthParams: { ...config.additionalAuthParams } }
      : {}),
    ...(config.additionalTokenParams
      ? { additionalTokenParams: { ...config.additionalTokenParams } }
      : {}),
    ...(config.tokenResponseMapping
      ? { tokenResponseMapping: { ...config.tokenResponseMapping } }
      : {}),
    ...(tokenRequestHeaders ? { tokenRequestHeaders } : {}),
    ...(apiHeaders ? { apiHeaders } : {}),
  };
}

function encodeBasicCredentials(clientId: string, clientSecret: string): string {
  const encodeFormComponent = (value: string): string =>
    new URLSearchParams({ value }).toString().slice("value=".length);
  const value = `${encodeFormComponent(clientId)}:${encodeFormComponent(clientSecret)}`;
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function ownValue(record: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

function normalizeOAuthError(value: unknown, fallback: string): string {
  return typeof value === "string" && /^[A-Za-z0-9._~-]{1,128}$/.test(value) ? value : fallback;
}

async function readBoundedResponseText(
  response: Response,
  maxBytes: number,
): Promise<{ text: string; oversized: boolean }> {
  const { text, truncated } = await readResponseTextPrefix(response, maxBytes + 1);
  return {
    text,
    oversized: truncated || new TextEncoder().encode(text).byteLength > maxBytes,
  };
}

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
  return base64urlEncodeBytes(new Uint8Array(await crypto.subtle.digest("SHA-256", data)));
}

/** Implement oauth provider. */
export class OAuthProvider {
  protected readonly config: OAuthProviderConfig;
  protected readonly envReader: EnvReader;

  constructor(config: OAuthProviderConfig, envReader: EnvReader = getEnv) {
    this.config = cloneProviderConfig(config);
    if (this.config.runtimeSupport === "provider-adapter-required") {
      throw INVALID_ARGUMENT.create({
        detail:
          `${this.config.displayName} requires a provider-specific adapter and cannot use the generic OAuth runtime`,
      });
    }
    this.envReader = envReader;
  }

  getClientId(): string | null {
    const value = this.envReader(this.config.clientIdEnvVar);
    return typeof value === "string" && value && value.trim() === value &&
        value.length <= MAX_OAUTH_CREDENTIAL_LENGTH
      ? value
      : null;
  }

  getClientSecret(): string | null {
    const value = this.envReader(this.config.clientSecretEnvVar);
    return typeof value === "string" && value && value.trim() === value &&
        value.length <= MAX_OAUTH_CREDENTIAL_LENGTH
      ? value
      : null;
  }

  isConfigured(): boolean {
    return !!(this.getClientId() && this.getClientSecret());
  }

  /** Declared PKCE behavior for this provider (`supported` by default). */
  get pkceMode(): "required" | "supported" | "unsupported" {
    return this.config.pkceMode === "required"
      ? "required"
      : this.config.pkceMode === "unsupported"
      ? "unsupported"
      : "supported";
  }

  async createAuthorizationUrl(
    options: AuthorizationUrlOptions & { defaultScopes?: string[] } = {},
  ): Promise<{ url: string; state: OAuthState }> {
    const clientId = this.getClientId();
    if (!clientId) {
      throw INVALID_ARGUMENT.create({ detail: `${this.config.clientIdEnvVar} not configured` });
    }

    const rawAdditionalParams = options.additionalParams;
    assertNoReservedParameters(
      rawAdditionalParams,
      RESERVED_AUTHORIZATION_PARAMETERS,
      "authorization",
    );
    const additionalParams = rawAdditionalParams === undefined
      ? undefined
      : { ...(rawAdditionalParams as Record<string, string>) };
    const state = options.state ?? generateRandomString(32);
    if (typeof state !== "string" || !state || state.length > 1_024) {
      throw INVALID_ARGUMENT.create({
        detail: "OAuth state must contain between 1 and 1024 characters",
      });
    }
    const scopeSeparator: " " | "," = this.config.scopeSeparator === "," ? "," : " ";
    const scopes = normalizeOAuthScopeSet(
      options.scopes ?? options.defaultScopes ?? [],
      scopeSeparator,
    );
    if (!scopes) {
      throw INVALID_ARGUMENT.create({
        detail: "OAuth scopes contain an invalid or ambiguous token",
      });
    }
    if (scopes.length === 0) {
      logger.warn(
        "createAuthorizationUrl: no scopes configured; OAuth request will have empty scope set",
        {
          clientIdEnvVar: this.config.clientIdEnvVar,
        },
      );
    }
    const redirectUri = options.redirectUri;
    if (!redirectUri) {
      throw INVALID_ARGUMENT.create({ detail: "redirectUri is required" });
    }
    assertRedirectUrl(redirectUri, "redirectUri");
    if (options.usePkce !== undefined && typeof options.usePkce !== "boolean") {
      throw INVALID_ARGUMENT.create({ detail: "OAuth usePkce must be a boolean" });
    }
    if (this.pkceMode === "required" && options.usePkce === false) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth provider requires PKCE" });
    }
    if (this.pkceMode === "unsupported" && options.usePkce === true) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth provider does not support PKCE" });
    }
    const usePkce = this.pkceMode === "required"
      ? true
      : this.pkceMode === "unsupported"
      ? false
      : options.usePkce !== false;

    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (usePkce) {
      codeVerifier = generateCodeVerifier();
      codeChallenge = await generateCodeChallenge(codeVerifier);
    }

    const authorizationUrl = new URL(this.config.authorizationUrl);
    const params = authorizationUrl.searchParams;
    for (const [key, value] of Object.entries(this.config.additionalAuthParams ?? {})) {
      params.set(key, value);
    }
    for (const [key, value] of Object.entries(additionalParams ?? {})) {
      params.set(key, value);
    }
    params.set("client_id", clientId);
    params.set("redirect_uri", redirectUri);
    params.set("response_type", "code");
    params.set("state", state);
    if (scopes.length) params.set("scope", scopes.join(scopeSeparator));
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }

    return {
      url: authorizationUrl.toString(),
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
      "Content-Type": this.config.tokenRequestFormat === "json"
        ? "application/json"
        : "application/x-www-form-urlencoded",
      Accept: "application/json",
      ...this.config.tokenRequestHeaders,
    };

    if (this.config.useBasicAuth) {
      headers.Authorization = `Basic ${encodeBasicCredentials(clientId, clientSecret)}`;
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

    type TokenStringField =
      | { present: false }
      | { present: true; valid: false }
      | { present: true; valid: true; value: string | null };
    const stringField = (
      key: string,
      allowNull = false,
      maxLength = MAX_OAUTH_TOKEN_VALUE_LENGTH,
    ): TokenStringField => {
      if (!Object.prototype.hasOwnProperty.call(data, key)) return { present: false };
      const value = ownValue(data, key);
      if (value === null && allowNull) return { present: true, valid: true, value: null };
      if (
        typeof value !== "string" || !value || value.length > maxLength ||
        value.trim() !== value
      ) {
        return { present: true, valid: false };
      }
      return { present: true, valid: true, value };
    };

    const accessTokenField = stringField(mapping.accessToken ?? "access_token");
    if (
      !accessTokenField.present || !accessTokenField.valid || accessTokenField.value === null
    ) return null;
    const refreshTokenField = stringField(mapping.refreshToken ?? "refresh_token", true);
    const tokenTypeField = stringField(
      mapping.tokenType ?? "token_type",
      false,
      MAX_OAUTH_TOKEN_TYPE_LENGTH,
    );
    const scopeField = stringField(
      mapping.scope ?? "scope",
      false,
      MAX_OAUTH_SCOPE_WIRE_LENGTH,
    );
    // SECURITY: the id_token is captured verbatim and persisted WITHOUT any
    // verification (no signature/aud/iss/exp/nonce validation). It MUST NOT be
    // used for any authentication or authorization decision unless fully
    // verified as a JWT first.
    const idTokenField = stringField("id_token");
    if (
      (refreshTokenField.present && !refreshTokenField.valid) ||
      (tokenTypeField.present && !tokenTypeField.valid) ||
      (scopeField.present && !scopeField.valid) ||
      (idTokenField.present && !idTokenField.valid)
    ) return null;

    const accessToken = accessTokenField.value;
    const refreshToken = !refreshTokenField.present
      ? fallbackRefreshToken
      : refreshTokenField.valid && refreshTokenField.value !== null
      ? refreshTokenField.value
      : undefined;
    const tokenType =
      tokenTypeField.present && tokenTypeField.valid && tokenTypeField.value !== null
        ? tokenTypeField.value
        : undefined;
    const scope = scopeField.present && scopeField.valid && scopeField.value !== null
      ? scopeField.value
      : undefined;
    const idToken = idTokenField.present && idTokenField.valid && idTokenField.value !== null
      ? idTokenField.value
      : undefined;

    const tokens: OAuthTokens = { accessToken };
    if (refreshToken !== undefined) tokens.refreshToken = refreshToken;
    if (tokenType !== undefined) tokens.tokenType = tokenType;
    if (scope !== undefined) tokens.scope = scope;
    if (idToken !== undefined) tokens.idToken = idToken;

    const rawExpiresIn = ownValue(data, mapping.expiresIn ?? "expires_in");
    if (rawExpiresIn !== undefined) {
      const expiresIn = typeof rawExpiresIn === "number"
        ? rawExpiresIn
        : typeof rawExpiresIn === "string" && /^\d+$/.test(rawExpiresIn)
        ? Number(rawExpiresIn)
        : Number.NaN;
      if (!Number.isSafeInteger(expiresIn) || expiresIn < 0) return null;
      const expiresAt = Date.now() + expiresIn * SECONDS_TO_MS;
      if (!Number.isSafeInteger(expiresAt)) return null;
      tokens.expiresAt = expiresAt;
    }

    return tokens;
  }

  private async postTokenRequest(
    body: URLSearchParams,
    clientId: string,
    clientSecret: string,
  ): Promise<{ response: Response; data: Record<string, unknown>; truncated: boolean }> {
    const requestTimeoutMs = this.config.requestTimeoutMs ?? HTTP_FETCH_TIMEOUT_MS;
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: this.buildTokenHeaders(clientId, clientSecret),
      body: this.config.tokenRequestFormat === "json"
        ? JSON.stringify(Object.fromEntries(body))
        : body.toString(),
      signal: AbortSignal.timeout(requestTimeoutMs),
      redirect: "error",
    });

    const maxBytes = this.config.maxTokenResponseBytes ?? DEFAULT_TOKEN_RESPONSE_MAX_BYTES;
    const { text, oversized } = await readBoundedResponseText(response, maxBytes);
    let parsed: unknown = {};
    if (!oversized && text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = {};
      }
    }
    return { response, data: isRecord(parsed) ? parsed : {}, truncated: oversized };
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
      const { response, data, truncated } = await this.postTokenRequest(
        body,
        clientId,
        clientSecret,
      );

      // Some providers signal errors with a 2xx status and a body-level
      // `ok: false` / `error` field (e.g. Slack oauth.v2.access). Treat those
      // as failures even when the HTTP status is "ok". See bug H12.
      const bodyError = ownValue(data, "error");
      if (!response.ok || ownValue(data, "ok") === false || bodyError !== undefined) {
        return {
          success: false,
          error: normalizeOAuthError(bodyError, errorFallback),
          errorDescription: errorDescriptionFallback
            ? errorDescriptionFallback(response.status)
            : undefined,
        };
      }

      // A 2xx without a usable access token is not a success. See bug H11.
      if (truncated) return { success: false, error: "invalid_token_response" };
      const tokens = this.parseTokenResponse(data, fallbackRefreshToken);
      if (!tokens) {
        return { success: false, error: "invalid_token_response" };
      }

      return { success: true, tokens };
    } catch (error) {
      return {
        success: false,
        error: "network_error",
        errorDescription: error instanceof DOMException && error.name === "TimeoutError"
          ? "OAuth token request timed out"
          : "OAuth token request failed",
      };
    }
  }

  async exchangeCode(options: TokenExchangeOptions): Promise<TokenExchangeResult> {
    assertTrimmedNonBlank(options.code, "OAuth authorization code");
    if (options.code.length > MAX_OAUTH_AUTHORIZATION_CODE_LENGTH) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth authorization code is too long" });
    }
    assertRedirectUrl(options.redirectUri, "redirectUri");
    if (this.pkceMode === "required" && options.codeVerifier === undefined) {
      throw INVALID_ARGUMENT.create({
        detail: "OAuth provider requires a PKCE code verifier",
      });
    }
    if (this.pkceMode === "unsupported" && options.codeVerifier !== undefined) {
      throw INVALID_ARGUMENT.create({
        detail: "OAuth provider does not support PKCE code verifiers",
      });
    }
    if (
      options.codeVerifier !== undefined &&
      !/^[A-Za-z0-9._~-]{43,128}$/.test(options.codeVerifier)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth PKCE code verifier" });
    }
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
    assertTrimmedNonBlank(refreshToken, "OAuth refresh token");
    if (refreshToken.length > MAX_OAUTH_TOKEN_VALUE_LENGTH) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth refresh token is too long" });
    }
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      return { success: false, error: "OAuth not configured" };
    }

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      ...this.buildClientCredentialsParams(clientId, clientSecret),
      ...this.config.additionalTokenParams,
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
    assertTrimmedNonBlank(token, "OAuth token");
    if (token.length > MAX_OAUTH_TOKEN_VALUE_LENGTH) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth token is too long" });
    }
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
        signal: AbortSignal.timeout(this.config.requestTimeoutMs ?? HTTP_FETCH_TIMEOUT_MS),
        redirect: "error",
      });
      await response.body?.cancel().catch(() => {});

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
  protected readonly serviceConfig: OAuthServiceConfig;
  protected tokenStore?: TokenStore;

  constructor(config: OAuthServiceConfig, tokenStore?: TokenStore, envReader?: EnvReader) {
    super(config, envReader);
    if (
      typeof config.serviceId !== "string" ||
      config.serviceId.length > MAX_OAUTH_SERVICE_ID_LENGTH ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(config.serviceId)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth serviceId" });
    }
    assertHttpsUrl(config.apiBaseUrl, "apiBaseUrl");
    const defaultScopes = normalizeOAuthScopeSet(
      config.defaultScopes,
      config.scopeSeparator === "," ? "," : " ",
    );
    if (!defaultScopes) {
      throw INVALID_ARGUMENT.create({
        detail: "defaultScopes must contain trimmed nonblank values",
      });
    }
    this.serviceConfig = {
      ...(this.config as OAuthServiceConfig),
      defaultScopes,
    };
    this.tokenStore = tokenStore;
  }

  get serviceId(): string {
    return this.serviceConfig.serviceId;
  }

  get displayName(): string {
    return this.serviceConfig.displayName;
  }

  /** Detached credential variable names for operator-only diagnostics. */
  get credentialEnvironmentVariables(): readonly [string, string] {
    return [this.serviceConfig.clientIdEnvVar, this.serviceConfig.clientSecretEnvVar];
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
    if (normalizeOAuthUserId(userId) !== userId) {
      throw INVALID_ARGUMENT.create({
        detail: "OAuth userId must be trimmed, nonblank, and within the supported length",
      });
    }
    const stored = await this.readTokenSnapshot(userId);
    if (!stored) return null;
    const { tokens } = stored;

    const refreshToken = tokens.refreshToken;
    if (tokens.expiresAt === undefined) return tokens.accessToken;

    const now = Date.now();
    const isExpired = now >= tokens.expiresAt;
    if (!refreshToken) return isExpired ? null : tokens.accessToken;

    const shouldRefresh = now >= tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS;
    if (!shouldRefresh) return tokens.accessToken;

    if (!this.tokenStore) {
      throw TOKEN_STORAGE_ERROR.create({ detail: "TokenStore not configured" });
    }
    if (
      !stored.revision || !isRefreshCapableTokenStore(this.tokenStore)
    ) {
      throw TOKEN_STORAGE_ERROR.create({
        detail:
          "TokenStore must implement revisioned CAS and a distributed refresh lock for atomic token refresh",
      });
    }

    const key = JSON.stringify([this.serviceId, userId]);
    const existingRefresh = getRefreshInFlight(this.tokenStore, key);
    if (existingRefresh) return existingRefresh;

    const tokenStore = this.tokenStore;
    const refreshPromise = this.refreshAndStoreAccessToken(userId);
    setRefreshInFlight(tokenStore, key, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      clearRefreshInFlight(tokenStore, key, refreshPromise);
    }
  }

  private async refreshAndStoreAccessToken(
    userId: string,
  ): Promise<string | null> {
    if (!this.tokenStore) {
      throw TOKEN_STORAGE_ERROR.create({ detail: "TokenStore not configured" });
    }
    const tokenStore = this.tokenStore;
    if (typeof tokenStore.withTokenRefreshLock !== "function") {
      throw TOKEN_STORAGE_ERROR.create({
        detail: "Distributed refresh-lock capability disappeared",
      });
    }

    return await tokenStore.withTokenRefreshLock<string | null>(
      this.serviceId,
      userId,
      async () => {
        // Re-read after acquiring the distributed lock. Another worker may have
        // refreshed this slot while this worker waited for the lease.
        const current = await this.readTokenSnapshot(userId);
        if (!current) return null;
        const { tokens, revision } = current;
        const now = Date.now();
        if (tokens.expiresAt === undefined) return tokens.accessToken;
        if (!tokens.refreshToken) return now < tokens.expiresAt ? tokens.accessToken : null;
        if (now < tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS) return tokens.accessToken;
        if (!revision) {
          throw TOKEN_STORAGE_ERROR.create({ detail: "TokenStore omitted the refresh revision" });
        }

        const result = await this.refreshTokens(tokens.refreshToken);
        if (!result.success || !result.tokens) {
          logger.warn("OAuth token refresh failed", {
            serviceId: this.serviceId,
            error: normalizeOAuthError(result.error, "refresh_failed"),
          });
          return await this.readCurrentUnexpiredAccessToken(userId);
        }

        const compareAndSetTokens = tokenStore.compareAndSetTokens;
        if (typeof compareAndSetTokens !== "function") {
          throw TOKEN_STORAGE_ERROR.create({
            detail: "Atomic token refresh capability disappeared",
          });
        }
        const replaced = await compareAndSetTokens.call(
          tokenStore,
          this.serviceId,
          userId,
          revision,
          result.tokens,
        );
        if (typeof replaced !== "boolean") {
          throw TOKEN_STORAGE_ERROR.create({
            detail: "TokenStore compareAndSetTokens returned a non-boolean result",
          });
        }
        return replaced
          ? result.tokens.accessToken
          : await this.readCurrentUnexpiredAccessToken(userId);
      },
    );
  }

  private async readTokenSnapshot(
    userId: string,
  ): Promise<{ tokens: OAuthTokens; revision?: string } | null> {
    if (!this.tokenStore) return null;
    if (typeof this.tokenStore.getTokenSnapshot === "function") {
      const rawSnapshot = await this.tokenStore.getTokenSnapshot(this.serviceId, userId);
      if (rawSnapshot === null) return null;
      const snapshot = normalizeOAuthTokenSnapshot(rawSnapshot);
      if (!snapshot) {
        throw TOKEN_STORAGE_ERROR.create({
          detail: "TokenStore returned an invalid OAuth token snapshot",
        });
      }
      return snapshot;
    }

    const rawTokens = await this.tokenStore.getTokens(this.serviceId, userId);
    if (rawTokens === null) return null;
    const tokens = normalizeStoredOAuthTokens(rawTokens);
    if (!tokens) {
      throw TOKEN_STORAGE_ERROR.create({
        detail: "TokenStore returned an invalid OAuth token row",
      });
    }
    return { tokens };
  }

  private async readCurrentUnexpiredAccessToken(userId: string): Promise<string | null> {
    const current = await this.readTokenSnapshot(userId);
    if (!current) return null;
    const expiresAt = current.tokens.expiresAt;
    return expiresAt === undefined || Date.now() < expiresAt ? current.tokens.accessToken : null;
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
    let target: URL;
    const allowed = new URL(this.apiBaseUrl);
    try {
      target = new URL(endpoint);
    } catch {
      const base = new URL(allowed);
      if (!base.pathname.endsWith("/")) base.pathname += "/";
      const relativeEndpoint = endpoint.startsWith("/") ? endpoint.slice(1) : endpoint;
      target = new URL(relativeEndpoint, base);
    }
    if (target.origin !== allowed.origin) {
      throw INVALID_ARGUMENT.create({
        detail:
          `OAuth endpoint origin ${target.origin} does not match configured ${allowed.origin}`,
      });
    }
    if (target.username || target.password || target.hash) {
      throw INVALID_ARGUMENT.create({
        detail: "OAuth endpoint must not contain credentials or a fragment",
      });
    }
    return target.toString();
  }

  async fetch<T>(userId: string, endpoint: string, options: RequestInit = {}): Promise<T> {
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw TOKEN_STORAGE_ERROR.create({
        detail: `Not authenticated with ${this.serviceConfig.displayName}`,
      });
    }

    const url = this.resolveEndpointUrl(endpoint);

    const headers = new Headers(this.serviceConfig.apiHeaders);
    for (const [name, value] of new Headers(options.headers)) headers.set(name, value);
    headers.set("Authorization", `Bearer ${token}`);
    const timeoutSignal = AbortSignal.timeout(
      this.config.requestTimeoutMs ?? HTTP_FETCH_TIMEOUT_MS,
    );
    const signal = options.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    let response: Response;
    try {
      response = await fetch(url, { ...options, headers, signal, redirect: "error" });
    } catch (error) {
      throw NETWORK_ERROR.create({
        detail: `${this.serviceConfig.displayName} API request failed`,
        cause: error,
        context: { serviceId: this.serviceConfig.serviceId },
      });
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      logger.error("OAuth provider API error", {
        serviceId: this.serviceConfig.serviceId,
        status: response.status,
      });
      throw NETWORK_ERROR.create({
        detail: `${this.serviceConfig.displayName} API error: ${response.status}`,
        context: {
          serviceId: this.serviceConfig.serviceId,
          upstreamStatus: response.status,
        },
      });
    }

    if (response.status === 204 || response.status === 205) {
      await response.body?.cancel().catch(() => {});
      return undefined as T;
    }

    const maxBytes = this.serviceConfig.maxApiResponseBytes ?? DEFAULT_API_RESPONSE_MAX_BYTES;
    const { text, oversized } = await readBoundedResponseText(response, maxBytes);
    if (oversized) {
      throw NETWORK_ERROR.create({
        detail: `${this.serviceConfig.displayName} API response exceeded configured byte limit`,
        context: { serviceId: this.serviceConfig.serviceId, maxBytes },
      });
    }
    try {
      return JSON.parse(text) as T;
    } catch (error) {
      throw NETWORK_ERROR.create({
        detail: `${this.serviceConfig.displayName} API returned invalid JSON`,
        cause: error,
        context: { serviceId: this.serviceConfig.serviceId },
      });
    }
  }
}
