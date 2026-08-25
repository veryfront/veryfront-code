import { isRequestFromLoopbackPeer } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import {
  primordialArrayJoin,
  primordialArraySort,
} from "#veryfront/platform/compat/primordials/array.ts";
import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";
import {
  createOriginBoundOutboundFetch,
  guardedExactHttpLoopbackOutboundFetch,
} from "#veryfront/security/http/outbound-fetch.ts";
import {
  hasProxyForwardingHeaders,
  hasTrustedLocalControlAuthority,
} from "#veryfront/security/http/local-control-request.ts";
import type { OidcAuthConfig } from "#veryfront/security/http/middleware/types.ts";
import { encodeAuthBase64Url } from "./base64url.ts";
import {
  clearSessionCookie,
  clearTransactionCookie,
  createSessionCookie,
  createTransactionCookie,
  readSessionCookie,
  readTransactionCookie,
} from "./cookies.ts";
import { createApplicationIdentity, snapshotApplicationIdentity } from "./identity.ts";
import { validateOidcAudienceClaims, verifyOidcIdToken } from "./id-token.ts";
import { createJwksCache, type JwksCache } from "./jwks-cache.ts";
import {
  createOidcMetadataCache,
  isPlainObject,
  type OidcMetadataCache,
  parseStrictJsonObject,
} from "./oidc-metadata.ts";
import { parseApplicationAuthReturnPath } from "./return-path.ts";
import type { ApplicationIdentity, AuthClaimValue } from "./types.ts";
import { type AuthCookiePayload, AuthCookieSizeLimitError } from "./crypto.ts";
import { MAX_APPLICATION_AUTH_SCOPE_COUNT, MAX_APPLICATION_AUTH_SCOPE_LENGTH } from "./policy.ts";

const AUTH_ROUTE_ROOT = "/_veryfront/auth";
const LOGIN_PATH = `${AUTH_ROUTE_ROOT}/login`;
const CALLBACK_PATH = `${AUTH_ROUTE_ROOT}/callback`;
const LOGOUT_PATH = `${AUTH_ROUTE_ROOT}/logout`;
const APP_URL_ENV = "APP_URL";
const RANDOM_BYTES = 32;
const RANDOM_BASE64URL_LENGTH = 43;
const TRANSACTION_TTL_SECONDS = 600;
const DEFAULT_SESSION_TTL_SECONDS = 28_800;
const MAX_SESSION_TTL_SECONDS = 2_592_000;
const MAX_ENV_VALUE_LENGTH = 4_096;
const MAX_CALLBACK_QUERY_LENGTH = 4_096;
const MAX_CALLBACK_VALUE_LENGTH = 2_048;
const MAX_CALLBACK_SESSION_STATE_LENGTH = 512;
const MAX_ID_TOKEN_LENGTH = 16_384;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const TOKEN_TIMEOUT_MS = 5_000;
const arrayIsArray = Array.isArray;
const NativePromise = Promise;
const objectFreeze = Object.freeze;
const textEncoder = new TextEncoder();
const apply = Reflect.apply;
const WebCrypto = crypto;
const cryptoGetRandomValues = WebCrypto.getRandomValues;
const cryptoSubtle = WebCrypto.subtle;
const promiseReject = NativePromise.reject;
const promiseThen = NativePromise.prototype.then;
const stringCharCodeAt = String.prototype.charCodeAt;
const subtleDigest = cryptoSubtle.digest;
const textDecoderDecode = TextDecoder.prototype.decode;
const textEncoderEncode = TextEncoder.prototype.encode;
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const NativeWeakSet = WeakSet;
const weakSetAdd = NativeWeakSet.prototype.add;
const weakSetHas = NativeWeakSet.prototype.has;

export interface ApplicationAuthEnvironmentReader {
  get(name: string): string | undefined;
}

export interface OidcApplicationAuthRuntimeOptions {
  readonly config: OidcAuthConfig;
  readonly env: ApplicationAuthEnvironmentReader;
  /** Browser-visible origin already resolved at the trusted request boundary. */
  readonly trustedRequestOrigin?: string | null;
  readonly now?: () => number;
  readonly randomBytes?: (length: number) => Uint8Array;
  readonly metadataCache?: OidcMetadataCache;
  readonly jwksCache?: JwksCache;
}

export interface OidcApplicationAuthRuntime {
  handleAuthRoute(request: Request): Promise<Response | null>;
  admitRequest(request: Request): Promise<ApplicationIdentity | Response>;
}

interface RuntimeConfig {
  readonly issuer: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly sessionSecret: string;
  readonly appOrigin: string;
  readonly scopes: readonly string[];
  readonly sessionTtlSeconds: number;
  readonly cookieName: string | undefined;
  readonly allowInsecureLoopback: boolean;
}

interface CallbackParams {
  readonly state: string;
  readonly code?: string;
  readonly error?: string;
  readonly iss?: string;
}

type JsonObject = { readonly [key: string]: unknown };

const admittedRequests = new NativeWeakSet<Request>();

export function markApplicationAuthAdmittedRequest(request: Request): void {
  apply(weakSetAdd, admittedRequests, [request]);
}

export function isApplicationAuthAdmittedRequest(request: Request): boolean {
  return apply(weakSetHas, admittedRequests, [request]) as boolean;
}

export function createOidcApplicationAuthRuntime(
  options: OidcApplicationAuthRuntimeOptions,
): OidcApplicationAuthRuntime {
  const metadataCache = options.metadataCache ?? createOidcMetadataCache({
    ttlSeconds: options.config.discoveryCacheTtlSeconds,
    now: () => (options.now?.() ?? Date.now() / 1_000) * 1_000,
  });
  const jwksCache = options.jwksCache ?? createJwksCache();
  const now = () => Math.floor(options.now?.() ?? Date.now() / 1_000);
  const randomBytes = options.randomBytes;

  async function resolve(request: Request): Promise<RuntimeConfig> {
    return await resolveRuntimeConfig(options.config, options.env, request);
  }

  return objectFreeze({
    async handleAuthRoute(request: Request): Promise<Response | null> {
      const url = new URL(request.url);
      if (
        url.pathname !== LOGIN_PATH && url.pathname !== CALLBACK_PATH &&
        url.pathname !== LOGOUT_PATH
      ) {
        return null;
      }
      const allowedMethod = allowedMethodForAuthPath(url.pathname);
      if (request.method !== allowedMethod) return methodNotAllowed(allowedMethod);

      let runtime: RuntimeConfig;
      try {
        runtime = await resolve(request);
        requireTrustedRequestOrigin(request, runtime.appOrigin, options.trustedRequestOrigin);
      } catch {
        return hardenedText("Authentication unavailable", 500);
      }

      if (url.pathname === LOGIN_PATH) {
        try {
          return await startLogin(request, runtime);
        } catch {
          return hardenedText("Authentication unavailable", 500);
        }
      }
      if (url.pathname === CALLBACK_PATH) {
        return await finishCallback(request, runtime);
      }
      return logout(request, runtime);
    },

    async admitRequest(request: Request): Promise<ApplicationIdentity | Response> {
      let runtime: RuntimeConfig;
      try {
        runtime = await resolve(request);
        requireTrustedRequestOrigin(request, runtime.appOrigin, options.trustedRequestOrigin);
      } catch {
        return unauthorized(request);
      }
      const payload = await readSessionCookie({
        secret: runtime.sessionSecret,
        cookieHeader: request.headers.get("cookie"),
        now: now(),
        maxLifetimeSeconds: runtime.sessionTtlSeconds,
        cookieName: runtime.cookieName,
      });
      if (payload === null) {
        return admissionFailure(request, runtime, true);
      }
      try {
        const expectedBinding = await sessionConfigurationBinding(runtime, options.config);
        const identity = identityFromSessionPayload(
          payload,
          runtime,
          options.config.claims,
          expectedBinding,
        );
        markApplicationAuthAdmittedRequest(request);
        return identity;
      } catch {
        return admissionFailure(request, runtime, true);
      }
    },
  });

  async function startLogin(request: Request, runtime: RuntimeConfig): Promise<Response> {
    const url = new URL(request.url);
    let returnTo = "/";
    try {
      const values = url.searchParams.getAll("returnTo");
      if (values.length > 1) return hardenedText("Bad request", 400);
      if (values.length === 1) returnTo = parseApplicationAuthReturnPath(values[0]);
    } catch {
      return hardenedText("Bad request", 400);
    }

    const metadata = await metadataCache.get(
      {
        issuer: runtime.issuer,
        trustedEndpointOrigins: options.config.trustedEndpointOrigins,
        allowInsecureLoopback: runtime.allowInsecureLoopback,
      },
      options.config.discoveryCacheTtlSeconds,
    );
    const state = randomBase64Url(randomBytes);
    const nonce = randomBase64Url(randomBytes);
    const verifier = randomBase64Url(randomBytes);
    const redirectUri = callbackUri(runtime);
    const challenge = await codeChallenge(verifier);
    const binding = await configurationBinding(runtime.issuer, runtime.clientId, redirectUri);
    const authorizationUrl = new URL(metadata.authorizationEndpoint);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", runtime.clientId);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("scope", primordialArrayJoin(runtime.scopes, " "));
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("nonce", nonce);
    authorizationUrl.searchParams.set("code_challenge", challenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    const response = redirectResponse(authorizationUrl.href, 302);
    response.headers.append(
      "Set-Cookie",
      await createTransactionCookie({
        secret: runtime.sessionSecret,
        payload: { v: 1, nonce, verifier, returnTo, binding },
        maxAgeSeconds: TRANSACTION_TTL_SECONDS,
        now: now(),
        state,
        randomBytes,
      }),
    );
    return response;
  }

  async function finishCallback(request: Request, runtime: RuntimeConfig): Promise<Response> {
    const url = new URL(request.url);
    let params: CallbackParams;
    try {
      params = parseCallbackParams(url, runtime.issuer);
    } catch {
      const response = hardenedText("Bad request", 400);
      const state = parseSyntacticState(url);
      if (state !== null) response.headers.append("Set-Cookie", clearTransactionCookie(state));
      return response;
    }
    const clearTransaction = () => clearTransactionCookie(params.state);
    const transaction = await readTransactionCookie({
      secret: runtime.sessionSecret,
      cookieHeader: request.headers.get("cookie"),
      now: now(),
      maxLifetimeSeconds: TRANSACTION_TTL_SECONDS,
      state: params.state,
    });
    if (transaction === null) {
      const response = hardenedText("Bad request", 400);
      response.headers.append("Set-Cookie", clearTransaction());
      return response;
    }
    let sessionCookie: string;
    let returnTo: string;
    try {
      const tx = parseTransactionPayload(transaction);
      const redirectUri = callbackUri(runtime);
      const expectedBinding = await configurationBinding(
        runtime.issuer,
        runtime.clientId,
        redirectUri,
      );
      if (tx.binding !== expectedBinding) throw new TypeError("transaction binding mismatch");
      if (params.error !== undefined || params.code === undefined) {
        throw new TypeError("provider returned an error");
      }
      const metadata = await metadataCache.get(
        {
          issuer: runtime.issuer,
          trustedEndpointOrigins: options.config.trustedEndpointOrigins,
          allowInsecureLoopback: runtime.allowInsecureLoopback,
        },
        options.config.discoveryCacheTtlSeconds,
      );
      const tokenResponse = await exchangeCode({
        tokenEndpoint: metadata.tokenEndpoint,
        clientId: runtime.clientId,
        clientSecret: runtime.clientSecret,
        code: params.code,
        redirectUri,
        verifier: tx.verifier,
        trustedEndpointOrigins: options.config.trustedEndpointOrigins,
        issuer: runtime.issuer,
        allowInsecureLoopback: runtime.allowInsecureLoopback,
      });
      const idToken = parseIdToken(tokenResponse);
      const identity = await verifyOidcIdToken({
        token: idToken,
        issuer: runtime.issuer,
        clientId: runtime.clientId,
        nonce: tx.nonce,
        jwksUri: metadata.jwksUri,
        jwksCache,
        allowedAlgorithms: options.config.signingAlgorithms,
        now,
        claimNames: options.config.claims,
        allowInsecureLoopback: runtime.allowInsecureLoopback,
      });
      const binding = await sessionConfigurationBinding(runtime, options.config);
      const cookieOptions = {
        secret: runtime.sessionSecret,
        maxAgeSeconds: runtime.sessionTtlSeconds,
        now: now(),
        cookieName: runtime.cookieName,
        randomBytes,
      } as const;
      try {
        sessionCookie = await createSessionCookie({
          ...cookieOptions,
          payload: sessionPayload(identity, binding),
        });
      } catch (error) {
        if (!(error instanceof AuthCookieSizeLimitError)) throw error;
        try {
          sessionCookie = await createSessionCookie({
            ...cookieOptions,
            payload: compactSessionPayload(identity, binding, true),
          });
        } catch (compactError) {
          if (!(compactError instanceof AuthCookieSizeLimitError)) throw compactError;
          sessionCookie = await createSessionCookie({
            ...cookieOptions,
            payload: compactSessionPayload(identity, binding, false),
          });
        }
      }
      returnTo = tx.returnTo;
    } catch {
      const response = hardenedText("Bad request", 400);
      response.headers.append("Set-Cookie", clearTransaction());
      return response;
    }
    const response = redirectResponse(returnTo, 303);
    response.headers.append("Set-Cookie", clearTransaction());
    response.headers.append("Set-Cookie", sessionCookie);
    return response;
  }
}

function logout(request: Request, runtime: RuntimeConfig): Response {
  const origins = request.headers.get("origin");
  if (origins === null || origins !== runtime.appOrigin) {
    return hardenedText("Forbidden", 403);
  }
  const response = redirectResponse("/", 303);
  response.headers.append("Set-Cookie", clearSessionCookie(runtime.cookieName));
  return response;
}

function admissionFailure(
  request: Request,
  runtime: RuntimeConfig,
  clearCookie: boolean,
): Response {
  const response = isHtmlNavigation(request)
    ? redirectResponse(
      `${LOGIN_PATH}?returnTo=${encodeURIComponent(currentReturnPath(request))}`,
      302,
    )
    : unauthorized(request);
  if (clearCookie) response.headers.append("Set-Cookie", clearSessionCookie(runtime.cookieName));
  return response;
}

function unauthorized(request: Request): Response {
  return hardenedText(request.method === "HEAD" ? "" : "Unauthorized", 401);
}

function isHtmlNavigation(request: Request): boolean {
  const method = request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return false;
  const accept = request.headers.get("accept") ?? "";
  return accept.includes("text/html");
}

function currentReturnPath(request: Request): string {
  const url = new URL(request.url);
  try {
    return parseApplicationAuthReturnPath(`${url.pathname}${url.search}`);
  } catch {
    return "/";
  }
}

function parseCallbackParams(url: URL, issuer: string): CallbackParams {
  if (url.search.length > MAX_CALLBACK_QUERY_LENGTH) {
    throw new TypeError("OIDC callback query exceeds the size limit");
  }
  for (const key of url.searchParams.keys()) {
    if (!isAllowedCallbackParameter(key)) {
      throw new TypeError("OIDC callback contains an unsupported parameter");
    }
  }
  const state = parseRandomValue(readSingleParam(url, "state", true));
  const code = readSingleParam(url, "code", false);
  const error = readSingleParam(url, "error", false);
  const iss = readSingleParam(url, "iss", false);
  readSingleParam(url, "error_description", false);
  validateCallbackScope(readSingleParam(url, "scope", false));
  validateCallbackSessionState(readSingleParam(url, "session_state", false));
  if ((code === undefined) === (error === undefined)) {
    throw new TypeError("OIDC callback must contain exactly one result");
  }
  if (iss !== undefined && iss !== issuer) {
    throw new TypeError("OIDC callback issuer does not match");
  }
  return { state, code, error, iss };
}

function isAllowedCallbackParameter(value: string): boolean {
  return value === "state" || value === "code" || value === "error" ||
    value === "error_description" || value === "iss" || value === "scope" ||
    value === "session_state";
}

function validateCallbackScope(value: string | undefined): void {
  if (value === undefined) return;
  if (!/^[\x21\x23-\x5B\x5D-\x7E]+(?: [\x21\x23-\x5B\x5D-\x7E]+)*$/u.test(value)) {
    throw new TypeError("OIDC callback scope is invalid");
  }
}

function validateCallbackSessionState(value: string | undefined): void {
  if (value === undefined) return;
  if (value.length > MAX_CALLBACK_SESSION_STATE_LENGTH) {
    throw new TypeError("OIDC callback session_state exceeds the size limit");
  }
  for (let index = 0; index < value.length; index += 1) {
    const code = apply(stringCharCodeAt, value, [index]) as number;
    if (code <= 0x1f || code === 0x7f) {
      throw new TypeError("OIDC callback session_state contains a control character");
    }
  }
}

function readSingleParam(url: URL, name: string, required: true): string;
function readSingleParam(url: URL, name: string, required: false): string | undefined;
function readSingleParam(url: URL, name: string, required: boolean): string | undefined {
  const values = url.searchParams.getAll(name);
  if (values.length === 0) {
    if (required) throw new TypeError("OIDC callback parameter is missing");
    return undefined;
  }
  if (values.length !== 1) throw new TypeError("OIDC callback parameter is duplicated");
  const value = values[0] ?? "";
  if (value.length === 0 || value.length > MAX_CALLBACK_VALUE_LENGTH) {
    throw new TypeError("OIDC callback parameter is outside the size limit");
  }
  return value;
}

async function exchangeCode(options: {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly code: string;
  readonly redirectUri: string;
  readonly verifier: string;
  readonly issuer: string;
  readonly trustedEndpointOrigins?: readonly string[];
  readonly allowInsecureLoopback: boolean;
}): Promise<JsonObject> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  try {
    const body = new URLSearchParams();
    body.set("grant_type", "authorization_code");
    body.set("code", options.code);
    body.set("redirect_uri", options.redirectUri);
    body.set("code_verifier", options.verifier);
    const tokenEndpoint = new URL(options.tokenEndpoint);
    const init: RequestInit = {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Basic ${
          btoa(`${formComponent(options.clientId)}:${formComponent(options.clientSecret)}`)
        }`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
      redirect: "error",
      credentials: "omit",
      signal: controller.signal,
    };
    let response: Response;
    if (options.allowInsecureLoopback && isLoopbackHttpUrl(tokenEndpoint)) {
      response = await guardedExactHttpLoopbackOutboundFetch(tokenEndpoint, init, {
        authorizeUrl(url) {
          authorizeProviderEndpoint(url, options);
        },
      });
    } else {
      authorizeProviderEndpoint(tokenEndpoint, options);
      response = await createOriginBoundOutboundFetch(tokenEndpoint.origin)(tokenEndpoint, init);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TypeError("OIDC token request failed");
    }
    if (!isJsonContentType(response.headers.get("content-type"))) {
      await response.body?.cancel();
      throw new TypeError("OIDC token response must be JSON");
    }
    const text = await readBoundedText(response, MAX_TOKEN_RESPONSE_BYTES, controller.signal);
    return parseStrictJsonObject(text, "OIDC token response");
  } finally {
    clearTimeout(timeout);
  }
}

function authorizeProviderEndpoint(
  url: URL,
  options: {
    readonly issuer: string;
    readonly trustedEndpointOrigins?: readonly string[];
    readonly allowInsecureLoopback: boolean;
  },
): void {
  const issuer = new URL(options.issuer);
  if (url.origin === issuer.origin) {
    if (
      url.protocol === "https:" ||
      (options.allowInsecureLoopback && url.protocol === "http:" && isLoopbackHost(url.hostname))
    ) {
      return;
    }
  }
  const trusted = options.trustedEndpointOrigins ?? [];
  for (let index = 0; index < trusted.length; index += 1) {
    if (url.protocol === "https:" && trusted[index] === url.origin) return;
  }
  throw new TypeError("OIDC provider endpoint is not trusted");
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
  signal: AbortSignal,
): Promise<string> {
  const body = response.body;
  if (body === null) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw new DOMException("aborted", "AbortError");
      const result = await readStreamChunk(reader, signal);
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new TypeError("OIDC token response exceeds the size limit");
      }
      chunks[chunks.length] = result.value;
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex += 1) {
    const chunk = chunks[chunkIndex]!;
    for (let index = 0; index < chunk.byteLength; index += 1) {
      output[offset + index] = chunk[index]!;
    }
    offset += chunk.byteLength;
  }
  return apply(textDecoderDecode, utf8Decoder, [output]) as string;
}

function readStreamChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  if (signal.aborted) {
    void reader.cancel();
    return apply(promiseReject, NativePromise, [
      new DOMException("aborted", "AbortError"),
    ]) as Promise<ReadableStreamReadResult<Uint8Array>>;
  }
  return new NativePromise((resolve, reject) => {
    const abort = () => {
      void reader.cancel();
      reject(new DOMException("aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    apply(promiseThen, reader.read(), [
      (result: ReadableStreamReadResult<Uint8Array>) => {
        signal.removeEventListener("abort", abort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    ]);
  });
}

function parseIdToken(response: JsonObject): string {
  const idToken = response.id_token;
  if (typeof idToken !== "string" || idToken.length === 0 || idToken.length > MAX_ID_TOKEN_LENGTH) {
    throw new TypeError("OIDC token response must contain a bounded ID token");
  }
  return idToken;
}

function formComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/g, "+");
}

function isJsonContentType(value: string | null): boolean {
  if (value === null) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return mediaType === "application/json" ||
    (mediaType.startsWith("application/") && mediaType.endsWith("+json"));
}

function parseTransactionPayload(value: JsonObject): {
  readonly nonce: string;
  readonly verifier: string;
  readonly returnTo: string;
  readonly binding: string;
} {
  if (value.v !== 1) throw new TypeError("transaction version mismatch");
  return {
    nonce: parseRandomValue(value.nonce),
    verifier: parseRandomValue(value.verifier),
    returnTo: parseApplicationAuthReturnPath(value.returnTo),
    binding: parseRandomValue(value.binding),
  };
}

function sessionPayload(identity: ApplicationIdentity, binding: string): AuthCookiePayload {
  return {
    v: 2,
    binding,
    issuer: identity.issuer,
    subject: identity.subject,
    claims: identity.claims,
  };
}

function compactSessionPayload(
  identity: ApplicationIdentity,
  binding: string,
  preserveAuthorizationClaims: boolean,
): AuthCookiePayload {
  const audience = identity.claims.aud;
  if (audience === undefined) throw new TypeError("OIDC audience claim is missing");
  const claims: { [key: string]: AuthClaimValue } = {
    iss: identity.issuer,
    sub: identity.subject,
    aud: audience,
  };
  const authorizedParty = identity.claims.azp;
  if (authorizedParty !== undefined) claims.azp = authorizedParty;

  return {
    v: 3,
    binding,
    issuer: identity.issuer,
    subject: identity.subject,
    truncated: true,
    claims,
    groups: preserveAuthorizationClaims ? identity.groups : [],
    roles: preserveAuthorizationClaims ? identity.roles : [],
    groupsComplete: preserveAuthorizationClaims ? identity.groupsComplete : false,
    ...(identity.email === undefined ? {} : { email: identity.email }),
    ...(identity.name === undefined ? {} : { name: identity.name }),
  };
}

function identityFromSessionPayload(
  value: JsonObject,
  runtime: RuntimeConfig,
  claimNames: OidcAuthConfig["claims"],
  expectedBinding: string,
): ApplicationIdentity {
  if (value.v !== 2 && value.v !== 3) throw new TypeError("session version mismatch");
  if (value.binding !== expectedBinding) throw new TypeError("session binding mismatch");
  if (!isPlainObject(value.claims)) throw new TypeError("session claims must be an object");
  validateOidcAudienceClaims(value.claims.aud, value.claims.azp, runtime.clientId);
  const identity = createApplicationIdentity({
    issuer: value.issuer,
    expectedIssuer: runtime.issuer,
    subject: value.subject,
    claims: value.claims,
    claimNames: value.v === 2 ? canonicalClaimNames(claimNames) : undefined,
  });
  if (value.v === 2) return identity;
  if (value.truncated !== true) throw new TypeError("compacted session marker is invalid");
  return snapshotApplicationIdentity({
    issuer: identity.issuer,
    subject: identity.subject,
    ...(value.email === undefined ? {} : { email: value.email }),
    ...(value.name === undefined ? {} : { name: value.name }),
    groups: value.groups,
    roles: value.roles,
    groupsComplete: value.groupsComplete,
    claims: identity.claims,
  });
}

function parseSyntacticState(url: URL): string | null {
  const values = url.searchParams.getAll("state");
  if (values.length !== 1) return null;
  const state = values[0] ?? "";
  return /^[A-Za-z0-9_-]{43}$/.test(state) ? state : null;
}

function parseRandomValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length !== RANDOM_BASE64URL_LENGTH ||
    !/^[A-Za-z0-9_-]{43}$/.test(value)
  ) {
    throw new TypeError("OIDC random value is invalid");
  }
  return value;
}

function requireTrustedRequestOrigin(
  request: Request,
  appOrigin: string,
  trustedRequestOrigin: string | null | undefined,
): void {
  const origin = trustedRequestOrigin === undefined
    ? new URL(request.url).origin
    : trustedRequestOrigin;
  if (origin !== appOrigin) throw new TypeError("request origin is not trusted");
}

async function resolveRuntimeConfig(
  config: OidcAuthConfig,
  env: ApplicationAuthEnvironmentReader,
  request: Request,
): Promise<RuntimeConfig> {
  const appOrigin = resolveAppOrigin(env, request);
  const issuer = readRequiredEnv(env, config.issuerEnvVar);
  const clientId = readRequiredEnv(env, config.clientIdEnvVar);
  const clientSecret = readRequiredEnv(env, config.clientSecretEnvVar);
  const sessionSecret = readRequiredEnv(env, config.sessionSecretEnvVar);
  return objectFreeze({
    issuer,
    clientId,
    clientSecret,
    sessionSecret,
    appOrigin,
    scopes: parseScopes(config.scopes),
    sessionTtlSeconds: parseSessionTtl(config.sessionTtlSeconds),
    cookieName: config.cookieName,
    allowInsecureLoopback: appOrigin.startsWith("http://") && isTrustedOidcLoopbackRequest(request),
  });
}

function readRequiredEnv(env: ApplicationAuthEnvironmentReader, name: string): string {
  if (typeof name !== "string" || name.length === 0 || name.length > 128) {
    throw new TypeError("OIDC environment variable name is invalid");
  }
  const value = env.get(name);
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_ENV_VALUE_LENGTH) {
    throw new TypeError("OIDC environment variable is missing");
  }
  return value;
}

function resolveAppOrigin(env: ApplicationAuthEnvironmentReader, request: Request): string {
  const value = env.get(APP_URL_ENV);
  if (value !== undefined) return parseAppUrl(value);
  if (isTrustedOidcLoopbackRequest(request)) {
    const url = new URL(request.url);
    if ((url.protocol === "http:" || url.protocol === "https:") && isLoopbackHost(url.hostname)) {
      return url.origin;
    }
  }
  throw new TypeError("APP_URL is required");
}

function parseAppUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("APP_URL must be a canonical HTTPS origin");
  }
  if (
    url.protocol !== "https:" ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.pathname !== "/" ||
    url.search.length > 0 ||
    url.hash.length > 0 ||
    value !== url.origin
  ) {
    throw new TypeError("APP_URL must be a canonical HTTPS origin");
  }
  return url.origin;
}

function parseScopes(value: readonly string[]): readonly string[] {
  if (
    !arrayIsArray(value) || value.length < 1 || value.length > MAX_APPLICATION_AUTH_SCOPE_COUNT
  ) {
    throw new TypeError("OIDC scopes must include openid");
  }
  const scopes: string[] = [];
  let includesOpenid = false;
  for (let index = 0; index < value.length; index += 1) {
    const scope = value[index];
    if (
      typeof scope !== "string" ||
      scope.length === 0 ||
      scope.length > MAX_APPLICATION_AUTH_SCOPE_LENGTH ||
      /\s/.test(scope)
    ) {
      throw new TypeError("OIDC scopes must be bounded unique strings");
    }
    for (let seenIndex = 0; seenIndex < scopes.length; seenIndex += 1) {
      if (scopes[seenIndex] === scope) {
        throw new TypeError("OIDC scopes must be bounded unique strings");
      }
    }
    if (scope === "openid") includesOpenid = true;
    scopes[index] = scope;
  }
  if (!includesOpenid) throw new TypeError("OIDC scopes must include openid");
  return objectFreeze(scopes);
}

function parseSessionTtl(value: number | undefined): number {
  const ttl = value ?? DEFAULT_SESSION_TTL_SECONDS;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > MAX_SESSION_TTL_SECONDS) {
    throw new TypeError("OIDC session TTL is outside the supported range");
  }
  return ttl;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" ||
    hostname === "[::1]";
}

function isLoopbackHttpUrl(url: URL): boolean {
  return url.protocol === "http:" && isLoopbackHost(url.hostname);
}

function isTrustedOidcLoopbackRequest(request: Request): boolean {
  if (isProxyTopologyTrusted() || hasProxyForwardingHeaders(request)) return false;
  if (!isRequestFromLoopbackPeer(request) || !hasTrustedLocalControlAuthority(request)) {
    return false;
  }
  const url = new URL(request.url);
  return (url.protocol === "http:" || url.protocol === "https:") &&
    isLoopbackHost(url.hostname);
}

function randomBase64Url(randomBytes: ((length: number) => Uint8Array) | undefined): string {
  const bytes = randomBytes === undefined
    ? apply(cryptoGetRandomValues, WebCrypto, [new Uint8Array(RANDOM_BYTES)]) as Uint8Array
    : randomBytes(RANDOM_BYTES);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== RANDOM_BYTES) {
    throw new TypeError("OIDC random byte source returned an invalid value");
  }
  const encoded = encodeAuthBase64Url(bytes);
  if (encoded.length !== RANDOM_BASE64URL_LENGTH) {
    throw new TypeError("OIDC random byte source returned an invalid value");
  }
  return encoded;
}

async function codeChallenge(verifier: string): Promise<string> {
  return encodeAuthBase64Url(
    new Uint8Array(await digestSha256(toArrayBuffer(encodeUtf8(verifier)))),
  );
}

async function configurationBinding(
  issuer: string,
  clientId: string,
  redirectUri: string,
): Promise<string> {
  const bytes = lengthPrefixedUtf8([issuer, clientId, redirectUri]);
  return encodeAuthBase64Url(
    new Uint8Array(await digestSha256(toArrayBuffer(bytes))),
  );
}

async function sessionConfigurationBinding(
  runtime: RuntimeConfig,
  config: OidcAuthConfig,
): Promise<string> {
  const claims = canonicalClaimNames(config.claims);
  const scopes = canonicalStrings(runtime.scopes);
  const signingAlgorithms = canonicalStrings(config.signingAlgorithms ?? ["RS256"]);
  const trustedEndpointOrigins = canonicalStrings(config.trustedEndpointOrigins ?? []);
  const fields = [
    "oidc-session-v5",
    runtime.issuer,
    runtime.clientId,
    callbackUri(runtime),
    "claims",
    claims.email,
    claims.name,
    claims.groups,
    claims.roles,
    "scopes",
    `${scopes.length}`,
  ];
  for (let index = 0; index < scopes.length; index += 1) {
    fields[fields.length] = scopes[index]!;
  }
  fields[fields.length] = "signing-algorithms";
  fields[fields.length] = `${signingAlgorithms.length}`;
  for (let index = 0; index < signingAlgorithms.length; index += 1) {
    fields[fields.length] = signingAlgorithms[index]!;
  }
  fields[fields.length] = "trusted-endpoint-origins";
  fields[fields.length] = `${trustedEndpointOrigins.length}`;
  for (let index = 0; index < trustedEndpointOrigins.length; index += 1) {
    fields[fields.length] = trustedEndpointOrigins[index]!;
  }
  const bytes = lengthPrefixedUtf16CodeUnits(fields);
  return encodeAuthBase64Url(
    new Uint8Array(await digestSha256(toArrayBuffer(bytes))),
  );
}

function digestSha256(bytes: BufferSource): Promise<ArrayBuffer> {
  return apply(subtleDigest, cryptoSubtle, ["SHA-256", bytes]) as Promise<ArrayBuffer>;
}

function encodeUtf8(value: string): Uint8Array {
  return apply(textEncoderEncode, textEncoder, [value]) as Uint8Array;
}

function canonicalStrings(values: readonly string[]): string[] {
  const canonical: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    canonical[index] = values[index]!;
  }
  return primordialArraySort(canonical, (left, right) => left < right ? -1 : left > right ? 1 : 0);
}

function canonicalClaimNames(claimNames: OidcAuthConfig["claims"]): {
  readonly email: string;
  readonly name: string;
  readonly groups: string;
  readonly roles: string;
} {
  return {
    email: claimNames?.email ?? "email",
    name: claimNames?.name ?? "name",
    groups: claimNames?.groups ?? "groups",
    roles: claimNames?.roles ?? "roles",
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  for (let index = 0; index < bytes.byteLength; index += 1) {
    copy[index] = bytes[index]!;
  }
  return copy.buffer;
}

function lengthPrefixedUtf8(values: readonly string[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    const part = encodeUtf8(values[index]!);
    parts[index] = part;
    total += 4 + part.byteLength;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    output[offset] = part.byteLength >>> 24;
    output[offset + 1] = part.byteLength >>> 16;
    output[offset + 2] = part.byteLength >>> 8;
    output[offset + 3] = part.byteLength;
    offset += 4;
    for (let byteIndex = 0; byteIndex < part.byteLength; byteIndex += 1) {
      output[offset + byteIndex] = part[byteIndex]!;
    }
    offset += part.byteLength;
  }
  return output;
}

function lengthPrefixedUtf16CodeUnits(values: readonly string[]): Uint8Array {
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += 4 + values[index]!.length * 2;
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (let valueIndex = 0; valueIndex < values.length; valueIndex += 1) {
    const value = values[valueIndex]!;
    const byteLength = value.length * 2;
    output[offset] = byteLength >>> 24;
    output[offset + 1] = byteLength >>> 16;
    output[offset + 2] = byteLength >>> 8;
    output[offset + 3] = byteLength;
    offset += 4;
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = apply(stringCharCodeAt, value, [index]) as number;
      output[offset] = codeUnit >>> 8;
      output[offset + 1] = codeUnit;
      offset += 2;
    }
  }
  return output;
}

function callbackUri(runtime: RuntimeConfig): string {
  return `${runtime.appOrigin}${CALLBACK_PATH}`;
}

function methodNotAllowed(allow: string): Response {
  return hardenedText("Method not allowed", 405, { Allow: allow });
}

function allowedMethodForAuthPath(pathname: string): "GET" | "POST" {
  if (pathname === LOGOUT_PATH) return "POST";
  return "GET";
}

function redirectResponse(location: string, status: 302 | 303): Response {
  return new Response(null, {
    status,
    headers: hardenedHeaders({ Location: location }),
  });
}

function hardenedText(body: string, status: number, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status,
    headers: hardenedHeaders({
      "Content-Type": "text/plain; charset=utf-8",
      ...headers,
    }),
  });
}

function hardenedHeaders(headers: HeadersInit = {}): Headers {
  const output = new Headers(headers);
  output.set("Cache-Control", "no-store");
  output.set("Pragma", "no-cache");
  output.set("Referrer-Policy", "no-referrer");
  output.set("X-Content-Type-Options", "nosniff");
  return output;
}
