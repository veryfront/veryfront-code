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
import { API_CLIENT_ERROR, INVALID_ARGUMENT, TOKEN_STORAGE_ERROR } from "#veryfront/errors";
import { logger as baseLogger } from "#veryfront/utils";
import {
  isLoopbackHostname,
  isOAuthScopeToken,
  isValidOAuthTokens,
  OAUTH_MAX_TOKEN_LENGTH,
} from "../validation.ts";

const logger = baseLogger.component("o-auth");

/** Buffer before token expiry to trigger proactive refresh (5 minutes). */
const TOKEN_REFRESH_BUFFER_MS = 300_000;

/** Multiplier to convert `expires_in` (seconds) to milliseconds. */
const SECONDS_TO_MS = 1_000;

/** Default upper bound for provider network requests. */
const DEFAULT_OAUTH_REQUEST_TIMEOUT_MS = 30_000;

/** Prevent a misconfigured timeout from retaining requests indefinitely. */
const MAX_OAUTH_REQUEST_TIMEOUT_MS = 5 * 60_000;

/** Token endpoint responses are small credential documents, not bulk data. */
const MAX_TOKEN_RESPONSE_BYTES = OAUTH_MAX_TOKEN_LENGTH;

/** Default upper bound for JSON returned by provider API helpers. */
const DEFAULT_API_RESPONSE_BYTES = 16 * 1_048_576;

/** Hard ceiling for an explicitly enlarged provider API JSON response. */
const MAX_API_RESPONSE_BYTES = 64 * 1_048_576;

/** Stops non-conforming streams from spinning forever without making progress. */
const MAX_EMPTY_RESPONSE_CHUNKS = 100;

const MAX_OAUTH_STATE_LENGTH = 4_096;
const MAX_AUTHORIZATION_CODE_LENGTH = 16_384;
const MAX_REDIRECT_URI_LENGTH = 4_096;
const MAX_SCOPE_ENTRIES = 256;
const MAX_SCOPE_LENGTH = 1_024;
const MAX_OAUTH_PARAMETER_ENTRIES = 128;
const MAX_OAUTH_PARAMETER_LENGTH = 4_096;
const MAX_OAUTH_ERROR_LENGTH = 2_048;
const MAX_CLIENT_CREDENTIAL_LENGTH = 65_536;
const MAX_USER_ID_LENGTH = 4_096;
const MAX_PROVIDER_URL_LENGTH = 4_096;
const MAX_API_ENDPOINT_LENGTH = 16_384;
const MAX_CONFIG_IDENTIFIER_LENGTH = 256;
const MAX_DISPLAY_NAME_LENGTH = 512;
const MAX_ENV_NAME_LENGTH = 128;

class InvalidTokenResponseError extends Error {
  constructor() {
    super("Invalid OAuth token response");
    this.name = "InvalidTokenResponseError";
  }
}

export type EnvReader = (key: string) => string | undefined;

/** Request options for {@link OAuthService.fetch}. */
export interface OAuthFetchOptions extends RequestInit {
  /**
   * Maximum accepted JSON response size in bytes. Defaults to 16 MiB and
   * cannot exceed 64 MiB. Use a direct streaming request for larger payloads.
   */
  maxResponseBytes?: number;
}

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

function encodeFormComponent(value: string): string {
  return new URLSearchParams({ value }).toString().slice("value=".length);
}

function encodeUtf8Base64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function parseHttpUrl(value: unknown, name: string): URL {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > MAX_PROVIDER_URL_LENGTH || value.trim() !== value
  ) {
    throw INVALID_ARGUMENT.create({ detail: `${name} must be a valid HTTP or HTTPS URL` });
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw INVALID_ARGUMENT.create({ detail: `${name} must be a valid HTTP or HTTPS URL` });
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username || url.password || url.hash
  ) {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must be an HTTP or HTTPS URL without credentials or a fragment`,
    });
  }
  if (url.protocol !== "https:" && !isLoopbackHostname(url.hostname)) {
    throw INVALID_ARGUMENT.create({
      detail: `${name} must use HTTPS unless it targets a loopback host`,
    });
  }
  return url;
}

function snapshotProviderConfig(config: OAuthProviderConfig): OAuthProviderConfig {
  return Object.freeze({
    ...config,
    additionalAuthParams: config.additionalAuthParams
      ? Object.freeze({ ...config.additionalAuthParams })
      : undefined,
    additionalTokenParams: config.additionalTokenParams
      ? Object.freeze({ ...config.additionalTokenParams })
      : undefined,
    tokenResponseMapping: config.tokenResponseMapping
      ? Object.freeze({ ...config.tokenResponseMapping })
      : undefined,
  });
}

function snapshotServiceConfig(config: OAuthServiceConfig): OAuthServiceConfig {
  const defaultScopes = [...config.defaultScopes];
  Object.freeze(defaultScopes);
  return Object.freeze({
    ...snapshotProviderConfig(config),
    serviceId: config.serviceId,
    defaultScopes,
    apiBaseUrl: config.apiBaseUrl,
  });
}

function hasBoundedParameters(
  parameters: unknown,
): parameters is Record<string, string> | undefined {
  if (parameters === undefined) return true;
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) return false;
  const entries = Object.entries(parameters);
  return entries.length <= MAX_OAUTH_PARAMETER_ENTRIES &&
    entries.every(([key, value]) =>
      typeof value === "string" &&
      key.length > 0 && key.length <= MAX_OAUTH_PARAMETER_LENGTH &&
      value.length <= MAX_OAUTH_PARAMETER_LENGTH
    );
}

function hasValidScopes(scopes: unknown): scopes is string[] {
  return Array.isArray(scopes) && scopes.length <= MAX_SCOPE_ENTRIES &&
    new Set(scopes).size === scopes.length &&
    scopes.every((scope) =>
      typeof scope === "string" && scope.length <= MAX_SCOPE_LENGTH && isOAuthScopeToken(scope)
    );
}

function isValidCodeVerifier(value: unknown): value is string | undefined {
  return value === undefined ||
    (typeof value === "string" && value.length >= 43 && value.length <= 128 &&
      /^[A-Za-z0-9._~-]+$/.test(value));
}

function isBoundedConfigText(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function validateProviderIdentity(config: OAuthProviderConfig): void {
  if (!isBoundedConfigText(config.providerId, MAX_CONFIG_IDENTIFIER_LENGTH)) {
    throw INVALID_ARGUMENT.create({ detail: "OAuth providerId is invalid" });
  }
  if (!isBoundedConfigText(config.displayName, MAX_DISPLAY_NAME_LENGTH)) {
    throw INVALID_ARGUMENT.create({ detail: "OAuth displayName is invalid" });
  }
  for (
    const [name, value] of [
      ["clientIdEnvVar", config.clientIdEnvVar],
      ["clientSecretEnvVar", config.clientSecretEnvVar],
    ] as const
  ) {
    if (
      !isBoundedConfigText(value, MAX_ENV_NAME_LENGTH) ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
    ) {
      throw INVALID_ARGUMENT.create({ detail: `OAuth ${name} is invalid` });
    }
  }
  if (
    config.tokenRequestFormat !== undefined && config.tokenRequestFormat !== "form" &&
    config.tokenRequestFormat !== "json"
  ) {
    throw INVALID_ARGUMENT.create({ detail: "OAuth tokenRequestFormat is invalid" });
  }
  if (config.useBasicAuth !== undefined && typeof config.useBasicAuth !== "boolean") {
    throw INVALID_ARGUMENT.create({ detail: "OAuth useBasicAuth is invalid" });
  }
}

function normalizeTokenError(value: string): string {
  return /^[A-Za-z0-9._~-]{1,128}$/.test(value) ? value : "provider_error";
}

function normalizeErrorDescription(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  return Array.from(value.slice(0, MAX_OAUTH_ERROR_LENGTH), (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
}

function requestTimeoutMs(envReader: EnvReader): number {
  const configured = Number(envReader("VF_HTTP_FETCH_TIMEOUT"));
  return Number.isSafeInteger(configured) && configured > 0 &&
      configured <= MAX_OAUTH_REQUEST_TIMEOUT_MS
    ? configured
    : DEFAULT_OAUTH_REQUEST_TIMEOUT_MS;
}

function combineAbortSignals(
  primary: AbortSignal | null | undefined,
  timeout: AbortSignal,
): { signal: AbortSignal; cleanup: () => void } {
  if (!primary) return { signal: timeout, cleanup: () => {} };

  const controller = new AbortController();
  const abortFrom = (signal: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(signal.reason);
  };
  const onPrimaryAbort = () => abortFrom(primary);
  const onTimeoutAbort = () => abortFrom(timeout);

  if (primary.aborted) abortFrom(primary);
  else primary.addEventListener("abort", onPrimaryAbort, { once: true });
  if (timeout.aborted) abortFrom(timeout);
  else timeout.addEventListener("abort", onTimeoutAbort, { once: true });

  return {
    signal: controller.signal,
    cleanup: () => {
      primary.removeEventListener("abort", onPrimaryAbort);
      timeout.removeEventListener("abort", onTimeoutAbort);
    },
  };
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Releasing a response body is best effort and must not mask the result.
  }
}

async function readBoundedResponse(
  response: Response,
  maximumBytes: number,
  createError: () => Error,
): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await cancelResponseBody(response);
    throw createError();
  }

  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  let emptyChunks = 0;
  let complete = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (value.byteLength === 0) {
        emptyChunks++;
        if (emptyChunks >= MAX_EMPTY_RESPONSE_CHUNKS) {
          throw createError();
        }
        continue;
      }
      emptyChunks = 0;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        throw createError();
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return decoder.decode(bytes);
  } finally {
    if (!complete) {
      try {
        await reader.cancel();
      } catch {
        // Cancellation is best effort and must not mask the protocol error.
      }
    }
    try {
      reader.releaseLock();
    } catch {
      // A non-conforming stream must not mask the protocol error.
    }
  }
}

function readBoundedTokenResponse(response: Response): Promise<string> {
  return readBoundedResponse(
    response,
    MAX_TOKEN_RESPONSE_BYTES,
    () => new InvalidTokenResponseError(),
  );
}

function requireApiResponseLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_API_RESPONSE_BYTES) {
    throw INVALID_ARGUMENT.create({
      detail: `maxResponseBytes must be between 1 and ${MAX_API_RESPONSE_BYTES}`,
    });
  }
  return value;
}

function parseTokenResponseText(response: Response, text: string): Record<string, unknown> {
  if (text.trim().length === 0) return {};

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(text));
  }
  if (contentType && !contentType.includes("json")) {
    throw new InvalidTokenResponseError();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new InvalidTokenResponseError();
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new InvalidTokenResponseError();
  }
  return parsed as Record<string, unknown>;
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** OAuth 2.0 authorization, code exchange, refresh, and revocation client. */
export class OAuthProvider {
  protected config: OAuthProviderConfig;
  protected envReader: EnvReader;

  constructor(config: OAuthProviderConfig, envReader: EnvReader = getEnv) {
    if (!config || typeof config !== "object") {
      throw INVALID_ARGUMENT.create({ detail: "OAuth provider config is invalid" });
    }
    if (typeof envReader !== "function") {
      throw INVALID_ARGUMENT.create({ detail: "OAuth envReader must be a function" });
    }
    validateProviderIdentity(config);
    parseHttpUrl(config.authorizationUrl, "OAuth authorizationUrl");
    parseHttpUrl(config.tokenUrl, "OAuth tokenUrl");
    if (config.userInfoUrl) parseHttpUrl(config.userInfoUrl, "OAuth userInfoUrl");
    if (config.revocationUrl) parseHttpUrl(config.revocationUrl, "OAuth revocationUrl");
    if (
      !hasBoundedParameters(config.additionalAuthParams) ||
      !hasBoundedParameters(config.additionalTokenParams)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth provider parameters exceed the limit" });
    }
    this.config = snapshotProviderConfig(config);
    this.envReader = envReader;
  }

  getClientId(): string | null {
    const value = this.envReader(this.config.clientIdEnvVar);
    return typeof value === "string" && value.trim().length > 0 &&
        value.length <= MAX_CLIENT_CREDENTIAL_LENGTH
      ? value
      : null;
  }

  getClientSecret(): string | null {
    const value = this.envReader(this.config.clientSecretEnvVar);
    return typeof value === "string" && value.trim().length > 0 &&
        value.length <= MAX_CLIENT_CREDENTIAL_LENGTH
      ? value
      : null;
  }

  isConfigured(): boolean {
    return !!(this.getClientId() && this.getClientSecret());
  }

  async createAuthorizationUrl(
    options: AuthorizationUrlOptions & { defaultScopes?: string[] } = {},
  ): Promise<{ url: string; state: OAuthState }> {
    if (!options || typeof options !== "object") {
      throw INVALID_ARGUMENT.create({ detail: "OAuth authorization options are invalid" });
    }
    if (options.usePkce !== undefined && typeof options.usePkce !== "boolean") {
      throw INVALID_ARGUMENT.create({ detail: "OAuth usePkce option is invalid" });
    }
    const clientId = this.getClientId();
    if (!clientId) {
      throw INVALID_ARGUMENT.create({ detail: `${this.config.clientIdEnvVar} not configured` });
    }

    const state: unknown = options.state ?? generateRandomString(32);
    const scopes = options.scopes ?? options.defaultScopes ?? [];
    if (typeof state !== "string" || state.length === 0 || state.length > MAX_OAUTH_STATE_LENGTH) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth state has an invalid length" });
    }
    if (!hasValidScopes(scopes)) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth scopes are invalid or exceed the limit" });
    }
    if (
      !hasBoundedParameters(this.config.additionalAuthParams) ||
      !hasBoundedParameters(options.additionalParams)
    ) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth authorization parameters exceed the limit" });
    }
    if (scopes.length === 0) {
      logger.warn(
        "createAuthorizationUrl: no scopes configured; OAuth request will have empty scope set",
        {
          clientIdEnvVar: this.config.clientIdEnvVar,
        },
      );
    }
    const redirectUri: unknown = options.redirectUri ?? "";
    if (typeof redirectUri !== "string" || redirectUri.length > MAX_REDIRECT_URI_LENGTH) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth redirectUri exceeds the limit" });
    }
    if (redirectUri) parseHttpUrl(redirectUri, "OAuth redirectUri");
    const usePkce = options.usePkce !== false;

    let codeVerifier: string | undefined;
    let codeChallenge: string | undefined;

    if (usePkce) {
      codeVerifier = generateCodeVerifier();
      codeChallenge = await generateCodeChallenge(codeVerifier);
    }

    const authorizationUrl = parseHttpUrl(
      this.config.authorizationUrl,
      "OAuth authorizationUrl",
    );
    const params = authorizationUrl.searchParams;
    for (const [key, value] of Object.entries(this.config.additionalAuthParams ?? {})) {
      params.set(key, value);
    }
    for (const [key, value] of Object.entries(options.additionalParams ?? {})) {
      params.set(key, value);
    }

    // Protocol-critical parameters are authoritative. Extension parameters
    // must never be able to downgrade PKCE, replace state, switch response
    // type, or redirect the authorization code to a different client URI.
    params.set("client_id", clientId);
    params.set("redirect_uri", redirectUri);
    params.set("response_type", "code");
    params.set("state", state);
    if (scopes.length) params.set("scope", scopes.join(" "));
    else params.delete("scope");
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    } else {
      params.delete("code_challenge");
      params.delete("code_challenge_method");
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
    };

    if (this.config.useBasicAuth) {
      const credentials = `${encodeFormComponent(clientId)}:${encodeFormComponent(clientSecret)}`;
      headers.Authorization = `Basic ${encodeUtf8Base64(credentials)}`;
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
    if (!accessToken || accessToken.trim().length === 0) return null;
    const returnedRefreshToken = optStr(mapping.refreshToken ?? "refresh_token");
    const refreshToken = returnedRefreshToken?.trim() ? returnedRefreshToken : fallbackRefreshToken;
    const tokenType = str(mapping.tokenType ?? "token_type");
    const scope = str(mapping.scope ?? "scope");
    // SECURITY: the id_token is captured verbatim and persisted WITHOUT any
    // verification (no signature/aud/iss/exp/nonce validation). It MUST NOT be
    // used for any authentication or authorization decision unless fully
    // verified as a JWT first.
    const idToken = optStr("id_token");

    const tokens: OAuthTokens = { accessToken };
    if (refreshToken) tokens.refreshToken = refreshToken;
    if (tokenType) tokens.tokenType = tokenType;
    if (scope) tokens.scope = scope;
    if (idToken) tokens.idToken = idToken;

    const rawExpiresIn = data[mapping.expiresIn ?? "expires_in"];
    if (rawExpiresIn !== undefined) {
      const expiresIn = typeof rawExpiresIn === "number"
        ? rawExpiresIn
        : typeof rawExpiresIn === "string" && rawExpiresIn.trim().length > 0
        ? Number(rawExpiresIn)
        : Number.NaN;
      const expiresAt = Date.now() + expiresIn * SECONDS_TO_MS;
      if (!Number.isFinite(expiresIn) || expiresIn < 0 || !Number.isSafeInteger(expiresAt)) {
        return null;
      }
      tokens.expiresAt = expiresAt;
    }

    return isValidOAuthTokens(tokens) ? tokens : null;
  }

  private async postTokenRequest(
    body: URLSearchParams,
    clientId: string,
    clientSecret: string,
  ): Promise<{ response: Response; data: Record<string, unknown> }> {
    const response = await fetch(this.config.tokenUrl, {
      method: "POST",
      headers: this.buildTokenHeaders(clientId, clientSecret),
      body: this.config.tokenRequestFormat === "json"
        ? JSON.stringify(Object.fromEntries(body))
        : body.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(requestTimeoutMs(this.envReader)),
    });

    let data: Record<string, unknown>;
    try {
      data = parseTokenResponseText(response, await readBoundedTokenResponse(response));
    } catch (error) {
      if (!response.ok && error instanceof InvalidTokenResponseError) data = {};
      else throw error;
    }
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
      const rawBodyError = typeof data.error === "string" ? data.error : "";
      const bodyError = rawBodyError ? normalizeTokenError(rawBodyError) : "";
      if (!response.ok || data.ok === false || rawBodyError) {
        return {
          success: false,
          error: bodyError || errorFallback,
          errorDescription: normalizeErrorDescription(data.error_description) ||
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
      if (error instanceof InvalidTokenResponseError) {
        return { success: false, error: "invalid_token_response" };
      }
      return {
        success: false,
        error: "network_error",
        errorDescription: "OAuth provider request failed",
      };
    }
  }

  async exchangeCode(options: TokenExchangeOptions): Promise<TokenExchangeResult> {
    if (
      !options || typeof options !== "object" || typeof options.code !== "string" ||
      options.code.length === 0 || options.code.length > MAX_AUTHORIZATION_CODE_LENGTH ||
      typeof options.redirectUri !== "string" ||
      options.redirectUri.length > MAX_REDIRECT_URI_LENGTH ||
      !isValidCodeVerifier(options.codeVerifier)
    ) {
      return { success: false, error: "invalid_request" };
    }
    try {
      parseHttpUrl(options.redirectUri, "OAuth redirectUri");
    } catch {
      return { success: false, error: "invalid_request" };
    }

    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      return {
        success: false,
        error: "oauth_not_configured",
        // Don't leak internal env var names to the caller; this result can
        // propagate to HTTP responses via OAuthService.
        errorDescription: "OAuth provider credentials are not configured",
      };
    }

    const body = new URLSearchParams(this.config.additionalTokenParams);
    body.set("grant_type", "authorization_code");
    body.set("code", options.code);
    body.set("redirect_uri", options.redirectUri);
    body.delete("refresh_token");
    if (options.codeVerifier) body.set("code_verifier", options.codeVerifier);
    else body.delete("code_verifier");
    for (
      const [key, value] of Object.entries(
        this.buildClientCredentialsParams(clientId, clientSecret),
      )
    ) {
      body.set(key, value);
    }
    if (this.config.useBasicAuth) {
      body.delete("client_id");
      body.delete("client_secret");
    }

    return this.exchangeToken(
      body,
      clientId,
      clientSecret,
      "token_exchange_failed",
      (status) => `Status ${status}`,
    );
  }

  async refreshTokens(refreshToken: string): Promise<TokenExchangeResult> {
    if (
      typeof refreshToken !== "string" || refreshToken.trim().length === 0 ||
      refreshToken.length > MAX_TOKEN_RESPONSE_BYTES
    ) {
      return { success: false, error: "invalid_request" };
    }
    const clientId = this.getClientId();
    const clientSecret = this.getClientSecret();

    if (!clientId || !clientSecret) {
      return { success: false, error: "oauth_not_configured" };
    }

    const body = new URLSearchParams(this.config.additionalTokenParams);
    body.set("grant_type", "refresh_token");
    body.set("refresh_token", refreshToken);
    body.delete("code");
    body.delete("redirect_uri");
    body.delete("code_verifier");
    for (
      const [key, value] of Object.entries(
        this.buildClientCredentialsParams(clientId, clientSecret),
      )
    ) {
      body.set(key, value);
    }
    if (this.config.useBasicAuth) {
      body.delete("client_id");
      body.delete("client_secret");
    }

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
      // No revocation endpoint configured. Nothing was sent to the
      // provider. Logged at debug so a false return is distinguishable from an
      // attempted-but-failed revocation.
      logger.debug("Token revocation skipped: no revocationUrl configured");
      return false;
    }
    if (
      typeof token !== "string" || token.trim().length === 0 ||
      token.length > MAX_TOKEN_RESPONSE_BYTES
    ) return false;

    try {
      const response = await fetch(revocationUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token }).toString(),
        redirect: "error",
        signal: AbortSignal.timeout(requestTimeoutMs(this.envReader)),
      });
      await cancelResponseBody(response);

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
        errorName: error instanceof Error ? error.name : typeof error,
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

/** Per-user OAuth token manager and authenticated provider API client. */
export class OAuthService extends OAuthProvider {
  protected serviceConfig: OAuthServiceConfig;
  protected tokenStore?: TokenStore;

  constructor(config: OAuthServiceConfig, tokenStore?: TokenStore, envReader?: EnvReader) {
    super(config, envReader);
    if (!isBoundedConfigText(config.serviceId, MAX_CONFIG_IDENTIFIER_LENGTH)) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth serviceId is invalid" });
    }
    if (!hasValidScopes(config.defaultScopes)) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth defaultScopes are invalid" });
    }
    parseHttpUrl(config.apiBaseUrl, "OAuth apiBaseUrl");
    this.serviceConfig = snapshotServiceConfig(config);
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
   * `userId` is required. This store is keyed by `(serviceId, userId)` to
   * prevent one user's OAuth completion from overwriting another user's
   * tokens. See VULN-AUTH-2.
   */
  async getAccessToken(userId: string): Promise<string | null> {
    if (
      typeof userId !== "string" || userId.trim().length === 0 ||
      userId.length > MAX_USER_ID_LENGTH
    ) return null;
    const tokens = await this.tokenStore?.getTokens(this.serviceId, userId);
    if (!tokens) return null;
    if (!isValidOAuthTokens(tokens)) {
      throw TOKEN_STORAGE_ERROR.create({ detail: "Stored OAuth tokens are invalid" });
    }

    const now = Date.now();
    const isExpired = tokens.expiresAt !== undefined && now >= tokens.expiresAt;
    const shouldRefresh = tokens.expiresAt !== undefined &&
      now >= tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS;
    if (!shouldRefresh) return tokens.accessToken;

    // The refresh buffer is an optimization, not an early expiry. A provider
    // that did not issue a refresh token can still use its access token until
    // the actual expiry instant.
    if (!tokens.refreshToken) return isExpired ? null : tokens.accessToken;

    if (!this.tokenStore) {
      throw TOKEN_STORAGE_ERROR.create({ detail: "TokenStore not configured" });
    }

    const key = JSON.stringify([this.serviceId, userId]);
    const existingRefresh = getRefreshInFlight(this.tokenStore, key);
    if (existingRefresh) return existingRefresh;

    const tokenStore = this.tokenStore;
    const refreshPromise = this.refreshAndStoreAccessToken(userId, tokens);
    setRefreshInFlight(tokenStore, key, refreshPromise);

    try {
      return await refreshPromise;
    } finally {
      clearRefreshInFlight(tokenStore, key, refreshPromise);
    }
  }

  private async refreshAndStoreAccessToken(
    userId: string,
    expectedTokens: OAuthTokens,
  ): Promise<string | null> {
    const refreshToken = expectedTokens.refreshToken;
    if (!refreshToken) return null;

    const result = await this.refreshTokens(refreshToken);
    if (!result.success || !result.tokens) return null;

    if (!this.tokenStore) {
      throw TOKEN_STORAGE_ERROR.create({ detail: "TokenStore not configured" });
    }
    // Re-read after the network request. A disconnect or a newer OAuth flow
    // may have replaced this slot while refresh was in flight. Persisting the
    // stale result would resurrect a disconnected account or overwrite newer
    // credentials.
    const currentTokens = await this.tokenStore.getTokens(this.serviceId, userId);
    if (currentTokens && !isValidOAuthTokens(currentTokens)) {
      throw TOKEN_STORAGE_ERROR.create({ detail: "Stored OAuth tokens are invalid" });
    }
    if (
      !currentTokens ||
      currentTokens.accessToken !== expectedTokens.accessToken ||
      currentTokens.refreshToken !== expectedTokens.refreshToken
    ) {
      return currentTokens?.accessToken ?? null;
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
    const allowed = parseHttpUrl(this.apiBaseUrl, "OAuth apiBaseUrl");
    let target: URL;
    try {
      target = new URL(endpoint);
    } catch {
      if (endpoint.startsWith("//") || endpoint.includes("\\")) {
        throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth endpoint path" });
      }
      const relativeBase = new URL(allowed);
      relativeBase.pathname = `${relativeBase.pathname.replace(/\/+$/, "")}/`;
      relativeBase.search = "";
      relativeBase.hash = "";
      target = new URL(endpoint.replace(/^\/+/, ""), relativeBase);
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      throw INVALID_ARGUMENT.create({ detail: "Invalid OAuth endpoint URL" });
    }
    if (target.username || target.password || target.hash) {
      throw INVALID_ARGUMENT.create({
        detail: "OAuth endpoint must not contain credentials or a fragment",
      });
    }
    if (target.origin !== allowed.origin) {
      throw INVALID_ARGUMENT.create({
        detail:
          `OAuth endpoint origin ${target.origin} does not match configured ${allowed.origin}`,
      });
    }
    return target.toString();
  }

  async fetch<T>(userId: string, endpoint: string, options: OAuthFetchOptions = {}): Promise<T> {
    if (
      typeof endpoint !== "string" || endpoint.length === 0 ||
      endpoint.length > MAX_API_ENDPOINT_LENGTH
    ) {
      throw INVALID_ARGUMENT.create({ detail: "OAuth endpoint is invalid or exceeds the limit" });
    }
    if (!options || typeof options !== "object") {
      throw INVALID_ARGUMENT.create({ detail: "OAuth fetch options are invalid" });
    }
    const url = this.resolveEndpointUrl(endpoint);
    const {
      maxResponseBytes: requestedResponseLimit = DEFAULT_API_RESPONSE_BYTES,
      ...requestOptions
    } = options;
    const maxResponseBytes = requireApiResponseLimit(requestedResponseLimit);
    const token = await this.getAccessToken(userId);
    if (!token) {
      throw TOKEN_STORAGE_ERROR.create({
        detail: `Not authenticated with ${this.serviceConfig.displayName}`,
      });
    }

    const headers = new Headers(requestOptions.headers);
    headers.set("Authorization", `Bearer ${token}`);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    if (
      requestOptions.body !== undefined && requestOptions.body !== null &&
      !headers.has("Content-Type")
    ) {
      headers.set("Content-Type", "application/json");
    }

    const timeoutSignal = AbortSignal.timeout(requestTimeoutMs(this.envReader));
    const { signal, cleanup } = combineAbortSignals(requestOptions.signal, timeoutSignal);
    try {
      const response = await fetch(url, {
        ...requestOptions,
        // Authenticated requests must not follow provider redirects. Keeping
        // this authoritative prevents a redirect from forwarding the request
        // into an unintended endpoint or changing method semantics.
        redirect: "error",
        headers,
        signal,
      });

      if (!response.ok) {
        await cancelResponseBody(response);
        logger.error("OAuth provider API error", {
          serviceId: this.serviceConfig.serviceId,
          status: response.status,
        });
        throw API_CLIENT_ERROR.create({
          detail: `${this.serviceConfig.displayName} API error: ${response.status}`,
        });
      }

      const text = await readBoundedResponse(
        response,
        maxResponseBytes,
        () =>
          API_CLIENT_ERROR.create({
            detail: `${this.serviceConfig.displayName} API response exceeded the configured limit`,
          }),
      );
      try {
        return JSON.parse(text) as T;
      } catch {
        throw API_CLIENT_ERROR.create({
          detail: `${this.serviceConfig.displayName} API returned invalid JSON`,
        });
      }
    } finally {
      cleanup();
    }
  }
}
