import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { encodeAuthBase64Url } from "./base64url.ts";

const DEFAULT_ISSUER = "https://mock-oidc.example.test";
const DEFAULT_CLIENT_ID = "mock-client";
const DEFAULT_CLIENT_SECRET = "mock-client-secret";
const DEFAULT_NOW = 1_900_000_000;
const MAX_AUTHORIZATION_URL_LENGTH = 8_192;
const MAX_AUTHORIZATION_VALUE_LENGTH = 2_048;
const MAX_CLAIMS_BYTES = 16_384;
const MAX_CLAIM_FIELDS = 64;
const REDACTED = "<redacted>";
const textEncoder = new TextEncoder();

export type MockOidcKeyName = "key-a" | "key-b" | "key-c";
export type MockOidcRoute = "discovery" | "jwks" | "token";

export type MockOidcResponseFixture =
  | { readonly kind: "normal" }
  | { readonly kind: "redirect" }
  | { readonly kind: "wrong-content-type" }
  | { readonly kind: "duplicate-json-keys" }
  | { readonly kind: "oversized-body"; readonly bytes?: number }
  | { readonly kind: "slow-body"; readonly delayMs: number }
  | { readonly kind: "status"; readonly status: number };

export interface MockOidcAuthorizationRequest {
  readonly state: string;
  readonly nonce: string;
  readonly redirectUri: string;
  readonly codeChallenge: string;
  readonly codeChallengeMethod: string;
  readonly clientId: string;
  readonly scope: string;
  readonly responseType: string;
}

export interface MockOidcCallCounts {
  readonly authorization: number;
  readonly discovery: number;
  readonly jwks: number;
  readonly token: number;
  readonly unexpected: number;
}

export interface MockOidcRequestSnapshot {
  readonly route: MockOidcRoute;
  readonly method: string;
  readonly url: string;
  readonly contentType?: string;
  readonly authorization?: string;
  readonly form?: Readonly<{
    readonly grantType: string | undefined;
    readonly code: string;
    readonly redirectUri: string | undefined;
    readonly codeVerifier: string;
  }>;
}

export interface CreateMockOidcProviderOptions {
  readonly issuer?: string;
  readonly clientId?: string;
  readonly clientSecret?: string;
  readonly now?: number;
  readonly authorizationUrl?: string;
  readonly tokenUrl?: string;
  readonly jwksUrl?: string;
}

export interface MintAuthorizationCodeOptions {
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly key?: MockOidcKeyName;
  readonly callbackParams?: Readonly<Record<string, string>>;
}

export interface IssueIdTokenOptions {
  readonly nonce: string;
  readonly claims?: Readonly<Record<string, unknown>>;
  readonly key?: MockOidcKeyName;
}

export interface MockOidcProvider {
  readonly urls: Readonly<{
    readonly issuer: string;
    readonly discovery: string;
    readonly authorization: string;
    readonly token: string;
    readonly jwks: string;
  }>;
  readonly fetch: typeof globalThis.fetch;
  parseAuthorizationRedirect(url: string): MockOidcAuthorizationRequest;
  mintAuthorizationCode(
    authorization: MockOidcAuthorizationRequest,
    options?: MintAuthorizationCodeOptions,
  ): string;
  authorize(url: string, options?: MintAuthorizationCodeOptions): string;
  issueIdToken(options: IssueIdTokenOptions): Promise<string>;
  publishKeys(keys: readonly MockOidcKeyName[]): void;
  setKeyId(key: MockOidcKeyName, kid: string): void;
  addPublishedJwksKeyForTesting(key: Readonly<Record<string, unknown>>): void;
  setFixture(route: MockOidcRoute, fixture: MockOidcResponseFixture): void;
  getCallCounts(): MockOidcCallCounts;
  getRequestSnapshots(): readonly MockOidcRequestSnapshot[];
  getAuthorizationRequests(): readonly MockOidcAuthorizationRequest[];
  run<T>(operation: () => Promise<T>): Promise<T>;
  reset(): void;
}

interface MockKey {
  readonly name: MockOidcKeyName;
  readonly pair: CryptoKeyPair;
  readonly publicJwk: JsonWebKey;
  kid: string;
}

interface AuthorizationCodeRecord {
  readonly authorization: MockOidcAuthorizationRequest;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly key: MockOidcKeyName;
}

interface MutableCallCounts {
  authorization: number;
  discovery: number;
  jwks: number;
  token: number;
  unexpected: number;
}

export async function createMockOidcProvider(
  options: CreateMockOidcProviderOptions = {},
): Promise<MockOidcProvider> {
  const issuer = canonicalUrl(options.issuer ?? DEFAULT_ISSUER, "issuer").replace(/\/$/u, "");
  const clientId = boundedString(options.clientId ?? DEFAULT_CLIENT_ID);
  const clientSecret = boundedString(options.clientSecret ?? DEFAULT_CLIENT_SECRET);
  const now = options.now ?? DEFAULT_NOW;
  if (!Number.isSafeInteger(now) || now < 0) {
    throw new TypeError("Mock OIDC provider received an invalid clock");
  }
  const urls = Object.freeze({
    issuer,
    discovery: `${issuer}/.well-known/openid-configuration`,
    authorization: canonicalUrl(options.authorizationUrl ?? `${issuer}/authorize`, "endpoint"),
    token: canonicalUrl(options.tokenUrl ?? `${issuer}/token`, "endpoint"),
    jwks: canonicalUrl(options.jwksUrl ?? `${issuer}/jwks`, "endpoint"),
  });
  const keys = new Map<MockOidcKeyName, MockKey>();
  for (const name of ["key-a", "key-b", "key-c"] as const) {
    const pair = await generateKeyPair();
    keys.set(name, {
      name,
      pair,
      publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
      kid: name,
    });
  }

  const calls: MutableCallCounts = {
    authorization: 0,
    discovery: 0,
    jwks: 0,
    token: 0,
    unexpected: 0,
  };
  const authorizations: MockOidcAuthorizationRequest[] = [];
  const requestSnapshots: MockOidcRequestSnapshot[] = [];
  const codes = new Map<string, AuthorizationCodeRecord>();
  const fixtures = new Map<MockOidcRoute, MockOidcResponseFixture>();
  let publishedKeys: readonly MockOidcKeyName[] = Object.freeze(["key-a"]);
  let extraPublishedJwksKeys: readonly Readonly<Record<string, unknown>>[] = Object.freeze([]);

  const mockFetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    const route = routeFor(request.url, urls);
    if (route === null || !isRegisteredMethod(route, request.method)) {
      calls.unexpected += 1;
      throw new TypeError("Mock OIDC provider rejected an unregistered request");
    }
    calls[route] += 1;

    if (route === "token") {
      return await handleTokenRequest(request);
    }
    requestSnapshots.push(Object.freeze({
      route,
      method: request.method,
      url: request.url,
    }));
    const fixture = fixtures.get(route);
    if (fixture !== undefined && fixture.kind !== "normal") {
      return fixtureResponse(route, fixture, issuer);
    }
    if (route === "discovery") {
      return jsonResponse({
        issuer,
        authorization_endpoint: urls.authorization,
        token_endpoint: urls.token,
        jwks_uri: urls.jwks,
      });
    }
    return jsonResponse({
      keys: [
        ...extraPublishedJwksKeys,
        ...publishedKeys.map((name) => publicJwk(requireKey(keys, name))),
      ],
    });
  };

  async function handleTokenRequest(request: Request): Promise<Response> {
    const fixture = fixtures.get("token");
    if (fixture !== undefined && fixture.kind !== "normal") {
      requestSnapshots.push(Object.freeze({
        route: "token",
        method: request.method,
        url: request.url,
        contentType: request.headers.get("content-type") ?? undefined,
        authorization: request.headers.has("authorization") ? `Basic ${REDACTED}` : undefined,
      }));
      return fixtureResponse("token", fixture, issuer);
    }

    const contentType = request.headers.get("content-type") ?? "";
    const authorization = request.headers.get("authorization");
    const body = await request.text();
    if (body.length > MAX_AUTHORIZATION_URL_LENGTH) return protocolFailure();
    const form = new URLSearchParams(body);
    const snapshot: MockOidcRequestSnapshot = Object.freeze({
      route: "token",
      method: request.method,
      url: request.url,
      contentType,
      authorization: authorization === null ? undefined : `Basic ${REDACTED}`,
      form: Object.freeze({
        grantType: singleFormValue(form, "grant_type"),
        code: REDACTED,
        redirectUri: singleFormValue(form, "redirect_uri"),
        codeVerifier: REDACTED,
      }),
    });
    requestSnapshots.push(snapshot);

    if (
      contentType.toLowerCase() !== "application/x-www-form-urlencoded" ||
      authorization !== expectedBasicAuthorization(clientId, clientSecret) ||
      !hasExactFormFields(form)
    ) {
      return protocolFailure();
    }
    const code = singleFormValue(form, "code");
    if (code === undefined) return protocolFailure();
    const record = codes.get(code);
    if (record === undefined) return protocolFailure();
    codes.delete(code);

    const verifier = singleFormValue(form, "code_verifier");
    const redirectUri = singleFormValue(form, "redirect_uri");
    if (
      singleFormValue(form, "grant_type") !== "authorization_code" ||
      record.authorization.clientId !== clientId ||
      redirectUri !== record.authorization.redirectUri ||
      verifier === undefined ||
      await pkceChallenge(verifier) !== record.authorization.codeChallenge
    ) {
      return protocolFailure();
    }
    const idToken = await signIdToken({
      issuer,
      clientId,
      now,
      nonce: record.authorization.nonce,
      claims: record.claims,
      key: requireKey(keys, record.key),
    });
    return jsonResponse({ id_token: idToken, token_type: "Bearer" });
  }

  const provider: MockOidcProvider = {
    urls,
    fetch: mockFetch,
    parseAuthorizationRedirect(url: string): MockOidcAuthorizationRequest {
      const parsed = parseAuthorizationRedirect(url, urls.authorization);
      calls.authorization += 1;
      authorizations.push(parsed);
      return parsed;
    },
    mintAuthorizationCode(
      authorization: MockOidcAuthorizationRequest,
      mintOptions: MintAuthorizationCodeOptions = {},
    ): string {
      if (!authorizations.includes(authorization)) {
        throw new TypeError("Mock OIDC provider rejected an unknown authorization request");
      }
      if (authorization.clientId !== clientId) {
        throw new TypeError("Mock OIDC provider rejected an invalid authorization request");
      }
      const claims = boundedClaims(mintOptions.claims ?? {});
      const key = mintOptions.key ?? "key-a";
      requireKey(keys, key);
      const code = randomValue();
      codes.set(code, { authorization, claims, key });
      const callback = new URL(authorization.redirectUri);
      callback.searchParams.set("state", authorization.state);
      callback.searchParams.set("code", code);
      if (mintOptions.callbackParams !== undefined) {
        for (const [key, value] of Object.entries(mintOptions.callbackParams)) {
          callback.searchParams.set(key, boundedString(value));
        }
      }
      return callback.href;
    },
    authorize(url: string, mintOptions: MintAuthorizationCodeOptions = {}): string {
      const authorization = provider.parseAuthorizationRedirect(url);
      return provider.mintAuthorizationCode(authorization, mintOptions);
    },
    async issueIdToken(issueOptions: IssueIdTokenOptions): Promise<string> {
      return await signIdToken({
        issuer,
        clientId,
        now,
        nonce: boundedString(issueOptions.nonce),
        claims: boundedClaims(issueOptions.claims ?? {}),
        key: requireKey(keys, issueOptions.key ?? "key-a"),
      });
    },
    publishKeys(names: readonly MockOidcKeyName[]): void {
      if (names.length < 1 || names.length > 100) {
        throw new TypeError("Mock OIDC provider requires a bounded published key list");
      }
      for (const name of names) requireKey(keys, name);
      publishedKeys = Object.freeze([...names]);
    },
    setKeyId(name: MockOidcKeyName, kid: string): void {
      requireKey(keys, name).kid = boundedString(kid);
    },
    addPublishedJwksKeyForTesting(key: Readonly<Record<string, unknown>>): void {
      extraPublishedJwksKeys = Object.freeze([
        ...extraPublishedJwksKeys,
        Object.freeze({ ...key }),
      ]);
    },
    setFixture(route: MockOidcRoute, fixture: MockOidcResponseFixture): void {
      validateFixture(fixture);
      if (fixture.kind === "normal") fixtures.delete(route);
      else fixtures.set(route, fixture);
    },
    getCallCounts(): MockOidcCallCounts {
      return Object.freeze({ ...calls });
    },
    getRequestSnapshots(): readonly MockOidcRequestSnapshot[] {
      return Object.freeze([...requestSnapshots]);
    },
    getAuthorizationRequests(): readonly MockOidcAuthorizationRequest[] {
      return Object.freeze([...authorizations]);
    },
    run<T>(operation: () => Promise<T>): Promise<T> {
      return withMockFetch(mockFetch, operation);
    },
    reset(): void {
      calls.authorization = 0;
      calls.discovery = 0;
      calls.jwks = 0;
      calls.token = 0;
      calls.unexpected = 0;
      authorizations.length = 0;
      requestSnapshots.length = 0;
      codes.clear();
      fixtures.clear();
      publishedKeys = Object.freeze(["key-a"]);
      extraPublishedJwksKeys = Object.freeze([]);
      for (const name of ["key-a", "key-b", "key-c"] as const) {
        requireKey(keys, name).kid = name;
      }
    },
  };
  return Object.freeze(provider);
}

async function generateKeyPair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
}

function canonicalUrl(value: string, kind: "issuer" | "endpoint"): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError(`Mock OIDC provider received an invalid ${kind} URL`);
  }
  if (
    url.protocol !== "https:" || url.username.length > 0 || url.password.length > 0 ||
    url.search.length > 0 || url.hash.length > 0
  ) {
    throw new TypeError(`Mock OIDC provider received an invalid ${kind} URL`);
  }
  return url.href;
}

function boundedString(value: string): string {
  if (
    typeof value !== "string" || value.length < 1 || value.length > MAX_AUTHORIZATION_VALUE_LENGTH
  ) {
    throw new TypeError("Mock OIDC provider received an invalid bounded string");
  }
  return value;
}

function boundedClaims(
  value: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Mock OIDC provider claims must be a plain object");
  }
  if (Object.keys(value).length > MAX_CLAIM_FIELDS) {
    throw new TypeError("Mock OIDC provider claims exceed the field limit");
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new TypeError("Mock OIDC provider claims must be JSON serializable");
  }
  if (textEncoder.encode(serialized).byteLength > MAX_CLAIMS_BYTES) {
    throw new TypeError("Mock OIDC provider claims exceed the size limit");
  }
  const parsed: unknown = JSON.parse(serialized);
  if (!isJsonObject(parsed)) {
    throw new TypeError("Mock OIDC provider claims must be a JSON object");
  }
  return Object.freeze(parsed);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseAuthorizationRedirect(
  value: string,
  authorizationEndpoint: string,
): MockOidcAuthorizationRequest {
  if (value.length > MAX_AUTHORIZATION_URL_LENGTH) {
    throw new TypeError("Mock OIDC provider rejected an invalid authorization request");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("Mock OIDC provider rejected an invalid authorization request");
  }
  const expected = new URL(authorizationEndpoint);
  if (url.origin !== expected.origin || url.pathname !== expected.pathname || url.hash.length > 0) {
    throw new TypeError("Mock OIDC provider rejected an invalid authorization request");
  }
  const allowed = new Set([
    "response_type",
    "client_id",
    "redirect_uri",
    "scope",
    "state",
    "nonce",
    "code_challenge",
    "code_challenge_method",
  ]);
  for (const name of url.searchParams.keys()) {
    if (!allowed.has(name)) {
      throw new TypeError("Mock OIDC provider rejected an invalid authorization request");
    }
  }
  const parsed = Object.freeze({
    state: requiredSearchParam(url, "state"),
    nonce: requiredSearchParam(url, "nonce"),
    redirectUri: requiredSearchParam(url, "redirect_uri"),
    codeChallenge: requiredSearchParam(url, "code_challenge"),
    codeChallengeMethod: requiredSearchParam(url, "code_challenge_method"),
    clientId: requiredSearchParam(url, "client_id"),
    scope: requiredSearchParam(url, "scope"),
    responseType: requiredSearchParam(url, "response_type"),
  });
  if (
    parsed.responseType !== "code" || parsed.codeChallengeMethod !== "S256" ||
    parsed.state.length !== 43 || parsed.nonce.length !== 43 ||
    parsed.codeChallenge.length !== 43
  ) {
    throw new TypeError("Mock OIDC provider rejected an invalid authorization request");
  }
  return parsed;
}

function requiredSearchParam(url: URL, name: string): string {
  const values = url.searchParams.getAll(name);
  if (
    values.length !== 1 || values[0] === undefined || values[0].length < 1 ||
    values[0].length > MAX_AUTHORIZATION_VALUE_LENGTH
  ) {
    throw new TypeError("Mock OIDC provider rejected an invalid authorization request");
  }
  return values[0];
}

function routeFor(
  url: string,
  urls: MockOidcProvider["urls"],
): MockOidcRoute | null {
  if (url === urls.discovery) return "discovery";
  if (url === urls.jwks) return "jwks";
  if (url === urls.token) return "token";
  return null;
}

function isRegisteredMethod(route: MockOidcRoute, method: string): boolean {
  return route === "token" ? method === "POST" : method === "GET";
}

function requireKey(
  keys: ReadonlyMap<MockOidcKeyName, MockKey>,
  name: MockOidcKeyName,
): MockKey {
  const key = keys.get(name);
  if (key === undefined) throw new TypeError("Mock OIDC provider rejected an unknown key");
  return key;
}

function publicJwk(key: MockKey): JsonWebKey {
  return Object.freeze({
    kty: key.publicJwk.kty,
    kid: key.kid,
    use: "sig",
    alg: "RS256",
    n: key.publicJwk.n,
    e: key.publicJwk.e,
  });
}

async function signIdToken(options: {
  readonly issuer: string;
  readonly clientId: string;
  readonly now: number;
  readonly nonce: string;
  readonly claims: Readonly<Record<string, unknown>>;
  readonly key: MockKey;
}): Promise<string> {
  const claims = boundedClaims({
    iss: options.issuer,
    sub: "mock-subject",
    aud: options.clientId,
    iat: options.now,
    exp: options.now + 300,
    nonce: options.nonce,
    ...options.claims,
  });
  const headerSegment = encodeJson({ alg: "RS256", kid: options.key.kid, typ: "JWT" });
  const claimsSegment = encodeJson(claims);
  const signingInput = `${headerSegment}.${claimsSegment}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    options.key.pair.privateKey,
    textEncoder.encode(signingInput),
  );
  return `${signingInput}.${encodeAuthBase64Url(new Uint8Array(signature))}`;
}

function encodeJson(value: unknown): string {
  return encodeAuthBase64Url(textEncoder.encode(JSON.stringify(value)));
}

function randomValue(): string {
  return encodeAuthBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

async function pkceChallenge(verifier: string): Promise<string> {
  if (verifier.length < 43 || verifier.length > 128) return "";
  return encodeAuthBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(verifier))),
  );
}

function expectedBasicAuthorization(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${formComponent(clientId)}:${formComponent(clientSecret)}`)}`;
}

function formComponent(value: string): string {
  return encodeURIComponent(value).replace(/%20/gu, "+");
}

function hasExactFormFields(form: URLSearchParams): boolean {
  const expected = new Set(["grant_type", "code", "redirect_uri", "code_verifier"]);
  for (const key of form.keys()) {
    if (!expected.delete(key)) return false;
  }
  return expected.size === 0;
}

function singleFormValue(form: URLSearchParams, name: string): string | undefined {
  const values = form.getAll(name);
  if (values.length !== 1) return undefined;
  const value = values[0];
  return value !== undefined && value.length <= MAX_AUTHORIZATION_VALUE_LENGTH ? value : undefined;
}

function protocolFailure(): Response {
  return jsonResponse({ error: "invalid_grant" }, 400);
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fixtureResponse(
  route: MockOidcRoute,
  fixture: Exclude<MockOidcResponseFixture, { readonly kind: "normal" }>,
  issuer: string,
): Response {
  switch (fixture.kind) {
    case "redirect":
      return new Response(null, {
        status: 302,
        headers: { location: `${issuer}/blocked-redirect` },
      });
    case "wrong-content-type":
      return new Response("{}", { headers: { "content-type": "text/plain" } });
    case "duplicate-json-keys":
      return new Response(duplicateJsonFor(route, issuer), {
        headers: { "content-type": "application/json" },
      });
    case "oversized-body":
      return new Response("x".repeat(fixture.bytes ?? 600 * 1024), {
        headers: { "content-type": "application/json" },
      });
    case "slow-body":
      return slowResponse(fixture.delayMs);
    case "status":
      return jsonResponse({ error: "provider_error" }, fixture.status);
  }
}

function duplicateJsonFor(route: MockOidcRoute, issuer: string): string {
  if (route === "discovery") return `{"issuer":${JSON.stringify(issuer)},"issuer":"duplicate"}`;
  if (route === "jwks") return '{"keys":[],"keys":[]}';
  return '{"id_token":"first","id_token":"duplicate"}';
}

function slowResponse(delayMs: number): Response {
  let timer: number | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      timer = setTimeout(() => {
        controller.enqueue(textEncoder.encode("{}"));
        controller.close();
      }, delayMs);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
    },
  });
  return new Response(body, { headers: { "content-type": "application/json" } });
}

function validateFixture(fixture: MockOidcResponseFixture): void {
  if (fixture.kind === "slow-body") {
    if (!Number.isInteger(fixture.delayMs) || fixture.delayMs < 0 || fixture.delayMs > 10_000) {
      throw new TypeError("Mock OIDC provider fixture delay is invalid");
    }
  }
  if (fixture.kind === "oversized-body" && fixture.bytes !== undefined) {
    if (!Number.isInteger(fixture.bytes) || fixture.bytes < 1 || fixture.bytes > 2 * 1024 * 1024) {
      throw new TypeError("Mock OIDC provider fixture body size is invalid");
    }
  }
  if (fixture.kind === "status" && (fixture.status < 400 || fixture.status > 599)) {
    throw new TypeError("Mock OIDC provider fixture status is invalid");
  }
}
