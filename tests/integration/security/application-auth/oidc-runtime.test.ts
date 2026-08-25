import "#veryfront/schemas/_test-setup.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV } from "#veryfront/security/http/outbound-fetch.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createSessionCookie } from "../../../../src/security/application-auth/cookies.ts";
import { createOidcApplicationAuthRuntime } from "../../../../src/security/application-auth/oidc-runtime.ts";
import type { PublicJwk } from "../../../../src/security/application-auth/jwks-cache.ts";

const TestArrayPrototypeSort = Array.prototype.sort;
const TestObjectDefineProperty = Object.defineProperty;
const TestObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const TestReflectApply = Reflect.apply;
const TestTextEncoderPrototypeEncode = TextEncoder.prototype.encode;
const TestUint8ArrayPrototypeSet = Uint8Array.prototype.set;
const TestTypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);

const NOW = 1_900_000_000;
const APP_ORIGIN = "https://app.example.test";
const ISSUER = "https://issuer.example.test";
const SESSION_SECRET = "s".repeat(32);
const CLIENT_SECRET = "client-secret-value";

function replacePropertyForTest(target: object, key: PropertyKey, value: unknown): () => void {
  const descriptor = TestReflectApply(
    TestObjectGetOwnPropertyDescriptor,
    undefined,
    [target, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined) throw new Error(`Expected ${String(key)} descriptor`);
  TestReflectApply(TestObjectDefineProperty, undefined, [
    target,
    key,
    { ...descriptor, value },
  ]);
  return () => {
    TestReflectApply(TestObjectDefineProperty, undefined, [target, key, descriptor]);
  };
}

function env(values: Readonly<Record<string, string | undefined>>) {
  return {
    get(name: string): string | undefined {
      return values[name];
    },
  };
}

function fixedRandom(): (length: number) => Uint8Array {
  let seed = 1;
  return (length: number) => {
    const bytes = new Uint8Array(length);
    for (let index = 0; index < length; index += 1) {
      bytes[index] = seed;
      seed = (seed + 1) & 255;
    }
    return bytes;
  };
}

function createRuntime() {
  return createOidcApplicationAuthRuntime({
    config: {
      issuerEnvVar: "OIDC_ISSUER",
      clientIdEnvVar: "OIDC_CLIENT_ID",
      clientSecretEnvVar: "OIDC_CLIENT_SECRET",
      sessionSecretEnvVar: "OIDC_SESSION_SECRET",
      scopes: ["openid", "email", "profile"],
    },
    env: env({
      APP_URL: APP_ORIGIN,
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
      OIDC_SESSION_SECRET: SESSION_SECRET,
    }),
    now: () => NOW,
    randomBytes: fixedRandom(),
  });
}

function createRuntimeWith(values: Readonly<Record<string, string | undefined>>) {
  return createRuntimeAt(NOW, values);
}

function createRuntimeAt(
  currentTime: number,
  values: Readonly<Record<string, string | undefined>> = {
    APP_URL: APP_ORIGIN,
    OIDC_ISSUER: ISSUER,
    OIDC_CLIENT_ID: "client-id",
    OIDC_CLIENT_SECRET: CLIENT_SECRET,
    OIDC_SESSION_SECRET: SESSION_SECRET,
  },
  configOverrides: Partial<Parameters<typeof createOidcApplicationAuthRuntime>[0]["config"]> = {},
) {
  return createOidcApplicationAuthRuntime({
    config: {
      issuerEnvVar: "OIDC_ISSUER",
      clientIdEnvVar: "OIDC_CLIENT_ID",
      clientSecretEnvVar: "OIDC_CLIENT_SECRET",
      sessionSecretEnvVar: "OIDC_SESSION_SECRET",
      scopes: ["openid"],
      ...configOverrides,
    },
    env: env(values),
    now: () => currentTime,
    randomBytes: fixedRandom(),
  });
}

function cookiePair(setCookie: string, name: string): string {
  const match = new RegExp(`(?:^|, )(${name}=[^;,]+)`).exec(setCookie);
  assert(match?.[1]);
  return match[1];
}

function transactionCookie(response: Response, state: string): string {
  return cookiePair(response.headers.get("Set-Cookie") ?? "", `__Host-vf_oidc_tx_${state}`);
}

function sessionCookie(response: Response): string {
  return cookiePair(response.headers.get("Set-Cookie") ?? "", "__Host-vf_session");
}

function encodeJsonSegment(value: unknown): string {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function encodeBase64Url(bytes: Uint8Array): string {
  let output = "";
  for (const byte of bytes) output += String.fromCharCode(byte);
  return btoa(output).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function createSignedIdToken(
  claims: Readonly<Record<string, unknown>>,
  kid = "test-key",
): Promise<{ readonly token: string; readonly jwk: PublicJwk }> {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = encodeJsonSegment({ alg: "RS256", kid });
  const payload = encodeJsonSegment(claims);
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return {
    token: `${signingInput}.${encodeBase64Url(new Uint8Array(signature))}`,
    jwk: {
      kty: "RSA",
      kid,
      alg: "RS256",
      use: "sig",
      n: String(jwk.n),
      e: String(jwk.e),
    },
  };
}

function oidcMetadata(overrides: Readonly<Record<string, unknown>> = {}): Response {
  return Response.json({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks`,
    ...overrides,
  });
}

async function startTransaction(runtime = createRuntime()): Promise<{
  readonly runtime: ReturnType<typeof createRuntime>;
  readonly state: string;
  readonly nonce: string;
  readonly cookie: string;
}> {
  const login = await withMockFetch(
    () => Promise.resolve(oidcMetadata()),
    () => runtime.handleAuthRoute(new Request(`${APP_ORIGIN}/_veryfront/auth/login`)),
  );
  assert(login);
  const location = login.headers.get("Location");
  assert(location);
  const redirect = new URL(location);
  const state = redirect.searchParams.get("state");
  const nonce = redirect.searchParams.get("nonce");
  assert(state);
  assert(nonce);
  return { runtime, state, nonce, cookie: transactionCookie(login, state) };
}

async function successfulCallback(
  runtime: ReturnType<typeof createRuntime>,
  state: string,
  nonce: string,
  cookie: string,
  code = "ok",
  callbackSuffix = "",
): Promise<Response> {
  const signed = await createSignedIdToken({
    iss: ISSUER,
    sub: "subject-123",
    aud: "client-id",
    nonce,
    iat: NOW,
    exp: NOW + 300,
  });
  const response = await withMockFetch(
    (input) => {
      const url = String(input);
      if (url.endsWith("/.well-known/openid-configuration")) return Promise.resolve(oidcMetadata());
      if (url === `${ISSUER}/token`) {
        return Promise.resolve(Response.json({ id_token: signed.token }));
      }
      if (url === `${ISSUER}/jwks`) {
        return Promise.resolve(Response.json({ keys: [signed.jwk] }));
      }
      return Promise.reject(new Error("unexpected OIDC fetch"));
    },
    () =>
      runtime.handleAuthRoute(
        new Request(
          `${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=${code}${callbackSuffix}`,
          {
            headers: { cookie },
          },
        ),
      ),
  );
  assert(response);
  return response;
}

async function assertGenericFailure(response: Response, forbidden: readonly string[] = []) {
  const body = await response.text();
  assertEquals(response.status >= 400, true);
  for (const value of forbidden) {
    assertEquals(body.includes(value), false);
    assertEquals((response.headers.get("Location") ?? "").includes(value), false);
    assertEquals((response.headers.get("Set-Cookie") ?? "").includes(value), false);
  }
}

function loopbackRequest(path: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("host", "127.0.0.1:8787");
  const request = new Request(`http://127.0.0.1:8787${path}`, {
    ...init,
    headers,
  });
  recordRequestPeerFromTransport(request, {
    runtime: "deno",
    transport: "tcp",
    hostname: "127.0.0.1",
  });
  return request;
}

describe("security/application-auth OIDC runtime", () => {
  it("starts login with independent transaction values, S256 PKCE, and hardened redirect headers", async () => {
    const requests: string[] = [];
    const runtime = createRuntime();

    const response = await withMockFetch(
      (input) => {
        requests.push(String(input));
        return Promise.resolve(
          Response.json({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: `${ISSUER}/jwks`,
          }),
        );
      },
      () =>
        runtime.handleAuthRoute(
          new Request(`${APP_ORIGIN}/_veryfront/auth/login?returnTo=%2Fdashboard%3Ftab%3Dhome`),
        ),
    );

    assert(response);
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("Cache-Control"), "no-store");
    assertEquals(response.headers.get("Pragma"), "no-cache");
    assertEquals(response.headers.get("Referrer-Policy"), "no-referrer");
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(requests, [`${ISSUER}/.well-known/openid-configuration`]);

    const location = response.headers.get("Location");
    assert(location);
    const redirect = new URL(location);
    assertEquals(redirect.origin + redirect.pathname, `${ISSUER}/authorize`);
    assertEquals(redirect.searchParams.get("response_type"), "code");
    assertEquals(redirect.searchParams.get("client_id"), "client-id");
    assertEquals(
      redirect.searchParams.get("redirect_uri"),
      `${APP_ORIGIN}/_veryfront/auth/callback`,
    );
    assertEquals(redirect.searchParams.get("scope"), "openid email profile");
    assertEquals(redirect.searchParams.get("code_challenge_method"), "S256");

    const state = redirect.searchParams.get("state");
    const nonce = redirect.searchParams.get("nonce");
    const challenge = redirect.searchParams.get("code_challenge");
    assert(state);
    assert(nonce);
    assert(challenge);
    assertEquals(state.length, 43);
    assertEquals(nonce.length, 43);
    assertEquals(challenge.length, 43);
    assertEquals(state === nonce, false);
    assertEquals(state === challenge, false);
    assertEquals(nonce === challenge, false);

    const setCookie = response.headers.get("Set-Cookie") ?? "";
    assertEquals(setCookie.startsWith(`__Host-vf_oidc_tx_${state}=`), true);
    assertEquals(setCookie.includes("; HttpOnly; Secure; SameSite=Lax; Max-Age=600"), true);
    assertEquals(setCookie.includes("/dashboard"), false);
  });

  it("fails closed when required runtime environment values are missing", async () => {
    const runtime = createRuntimeWith({
      APP_URL: APP_ORIGIN,
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
    });

    const response = await runtime.handleAuthRoute(
      new Request(`${APP_ORIGIN}/_veryfront/auth/login`),
    );

    assert(response);
    assertEquals(response.status, 500);
    assertEquals(await response.text(), "Authentication unavailable");
  });

  it("rejects malformed callback parameters and clears an identified transaction", async () => {
    const runtime = createRuntime();
    const login = await withMockFetch(
      () =>
        Promise.resolve(
          Response.json({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: `${ISSUER}/jwks`,
          }),
        ),
      () => runtime.handleAuthRoute(new Request(`${APP_ORIGIN}/_veryfront/auth/login`)),
    );
    assert(login);
    const location = login.headers.get("Location");
    assert(location);
    const state = new URL(location).searchParams.get("state");
    assert(state);
    const cookie = transactionCookie(login, state);

    for (
      const query of [
        `state=${state}&code=ok&code=again`,
        `state=${state}&code=ok&error=access_denied`,
        `state=${state}&error=access_denied`,
        `state=${state}&code=ok&iss=https%3A%2F%2Fother.example.test`,
        `state=${state}&code=ok&scope=openid&scope=email`,
        `state=${state}&code=ok&scope=${encodeURIComponent("openid\nemail")}`,
        `state=${state}&code=ok&session_state=one&session_state=two`,
        `state=${state}&code=ok&session_state=${"s".repeat(513)}`,
        `state=${state}&code=ok&session_state=${encodeURIComponent("keycloak\nsession")}`,
      ]
    ) {
      const response = await runtime.handleAuthRoute(
        new Request(`${APP_ORIGIN}/_veryfront/auth/callback?${query}`, {
          headers: { cookie },
        }),
      );
      assert(response);
      assertEquals(response.status, 400);
      assertEquals(
        (response.headers.get("Set-Cookie") ?? "").includes(`__Host-vf_oidc_tx_${state}=;`),
        true,
      );
    }
  });

  it("accepts one bounded Keycloak session_state callback parameter", async () => {
    const { runtime, state, nonce, cookie } = await startTransaction();

    const callback = await successfulCallback(
      runtime,
      state,
      nonce,
      cookie,
      "ok",
      "&session_state=6f730d5d-55d0-48e7-a02e-fdbcf849a4f7",
    );

    assertEquals(callback.status, 303);
    assertEquals(callback.headers.get("Location"), "/");
    assertEquals((callback.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="), true);
  });

  it("fails callback query and transaction boundaries closed without reflecting secrets", async () => {
    const { runtime, state, cookie } = await startTransaction();
    const otherState = "A".repeat(43);
    const longValue = "x".repeat(2_049);
    const longQuery = `state=${state}&code=${"x".repeat(4_100)}`;
    const boundaryCases = [
      { query: "code=sensitive-code", clears: false },
      { query: "state=bad&code=sensitive-code", clears: false },
      { query: `state=${state}&code=${longValue}`, clears: true },
      { query: longQuery, clears: true },
      { query: `state=${state}&error=${longValue}`, clears: true },
      { query: `state=${state}&code=ok&error_description=${longValue}`, clears: true },
      { query: `state=${state}&state=${state}&code=ok`, clears: false },
      { query: `state=${state}&code=ok&code=again`, clears: true },
      { query: `state=${state}&error=access_denied&error=server_error`, clears: true },
      { query: `state=${state}&code=ok&iss=${encodeURIComponent(ISSUER)}&iss=x`, clears: true },
      {
        query: `state=${state}&error=access_denied&error_description=${
          encodeURIComponent(CLIENT_SECRET)
        }`,
        clears: true,
      },
      { query: `state=${state}&code=ok&error=access_denied`, clears: true },
      {
        query: `state=${state}&code=ok&iss=${encodeURIComponent("https://wrong.example.test")}`,
        clears: true,
      },
    ] as const;

    for (const boundaryCase of boundaryCases) {
      const response = await runtime.handleAuthRoute(
        new Request(`${APP_ORIGIN}/_veryfront/auth/callback?${boundaryCase.query}`, {
          headers: { cookie },
        }),
      );
      assert(response);
      await assertGenericFailure(response, ["sensitive-code", CLIENT_SECRET, longValue]);
      assertEquals(response.status, 400);
      assertEquals(
        (response.headers.get("Set-Cookie") ?? "").includes(`__Host-vf_oidc_tx_${state}=;`),
        boundaryCase.clears,
      );
      assertEquals(
        (response.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="),
        false,
      );
    }

    const missing = await runtime.handleAuthRoute(
      new Request(`${APP_ORIGIN}/_veryfront/auth/callback?state=${otherState}&code=ok`, {
        headers: { cookie },
      }),
    );
    assert(missing);
    assertEquals(missing.status, 400);
    assertEquals(
      (missing.headers.get("Set-Cookie") ?? "").includes(`__Host-vf_oidc_tx_${otherState}=;`),
      true,
    );
    assertEquals((missing.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="), false);

    const expired = await createRuntimeAt(NOW + 601).handleAuthRoute(
      new Request(`${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=ok`, {
        headers: { cookie },
      }),
    );
    assert(expired);
    assertEquals(expired.status, 400);
    assertEquals(
      (expired.headers.get("Set-Cookie") ?? "").includes(`__Host-vf_oidc_tx_${state}=;`),
      true,
    );

    const drifted = createRuntimeWith({
      APP_URL: APP_ORIGIN,
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: "different-client",
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
      OIDC_SESSION_SECRET: SESSION_SECRET,
    });
    const configDrift = await drifted.handleAuthRoute(
      new Request(`${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=ok`, {
        headers: { cookie },
      }),
    );
    assert(configDrift);
    assertEquals(configDrift.status, 400);
    assertEquals(
      (configDrift.headers.get("Set-Cookie") ?? "").includes(`__Host-vf_oidc_tx_${state}=;`),
      true,
    );
  });

  it("fails token response boundaries closed without creating a partial session", async () => {
    const wrongNonce = await createSignedIdToken({
      iss: ISSUER,
      sub: "subject-123",
      aud: "client-id",
      nonce: "A".repeat(43),
      iat: NOW,
      exp: NOW + 300,
    });
    const idTokenCases: readonly {
      readonly name: string;
      readonly tokenResponse: Response;
      readonly jwks?: Response;
    }[] = [
      { name: "redirect", tokenResponse: new Response(null, { status: 302 }) },
      {
        name: "non-json",
        tokenResponse: new Response("token", { headers: { "content-type": "text/plain" } }),
      },
      {
        name: "malformed-json",
        tokenResponse: new Response("{", { headers: { "content-type": "application/json" } }),
      },
      {
        name: "duplicate-key",
        tokenResponse: new Response('{"id_token":"a","id_token":"b"}', {
          headers: { "content-type": "application/json" },
        }),
      },
      {
        name: "oversized-body",
        tokenResponse: new Response(`{"id_token":"${"x".repeat(65 * 1024)}"}`, {
          headers: { "content-type": "application/json" },
        }),
      },
      {
        name: "non-2xx",
        tokenResponse: Response.json({ error: "invalid_grant" }, { status: 400 }),
      },
      { name: "missing-id-token", tokenResponse: Response.json({ access_token: "ignored" }) },
      {
        name: "oversized-id-token",
        tokenResponse: Response.json({ id_token: "x".repeat(16_385) }),
      },
      { name: "non-string-id-token", tokenResponse: Response.json({ id_token: 123 }) },
      {
        name: "verifier-failure",
        tokenResponse: Response.json({ id_token: wrongNonce.token }),
        jwks: Response.json({ keys: [wrongNonce.jwk] }),
      },
    ];

    for (const testCase of idTokenCases) {
      const { runtime, state, cookie } = await startTransaction();
      let tokenCalls = 0;
      const response = await withMockFetch(
        (input) => {
          const url = String(input);
          if (url.endsWith("/.well-known/openid-configuration")) {
            return Promise.resolve(oidcMetadata());
          }
          if (url === `${ISSUER}/token`) {
            tokenCalls += 1;
            return Promise.resolve(testCase.tokenResponse.clone());
          }
          if (url === `${ISSUER}/jwks` && testCase.jwks !== undefined) {
            return Promise.resolve(testCase.jwks.clone());
          }
          return Promise.reject(new Error(`unexpected OIDC fetch in ${testCase.name}`));
        },
        () =>
          runtime.handleAuthRoute(
            new Request(
              `${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=sensitive-code`,
              {
                headers: { cookie },
              },
            ),
          ),
      );
      assert(response);
      assertEquals(tokenCalls, 1);
      assertEquals(response.status, 400);
      await assertGenericFailure(response, ["sensitive-code", "invalid_grant", CLIENT_SECRET]);
      const setCookie = response.headers.get("Set-Cookie") ?? "";
      assertEquals(setCookie.includes(`__Host-vf_oidc_tx_${state}=;`), true);
      assertEquals(setCookie.includes("__Host-vf_session="), false);
    }

    const { runtime, state, cookie } = await startTransaction();
    let cancelled = false;
    let stalledTimer: number | undefined;
    let resolveStalledPull: (() => void) | undefined;
    const stalledBody = new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>((resolve) => {
          resolveStalledPull = resolve;
          stalledTimer = setTimeout(resolve, 5_200);
        });
      },
      cancel() {
        cancelled = true;
        if (stalledTimer !== undefined) clearTimeout(stalledTimer);
        resolveStalledPull?.();
      },
    });
    const started = performance.now();
    const timeoutResponse = await withMockFetch(
      (input) => {
        const url = String(input);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return Promise.resolve(oidcMetadata());
        }
        if (url === `${ISSUER}/token`) {
          return Promise.resolve(
            new Response(stalledBody, { headers: { "content-type": "application/json" } }),
          );
        }
        return Promise.reject(new Error("unexpected timeout fetch"));
      },
      () =>
        runtime.handleAuthRoute(
          new Request(`${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=sensitive-code`, {
            headers: { cookie },
          }),
        ),
    );
    assert(timeoutResponse);
    assertEquals(timeoutResponse.status, 400);
    assertEquals(performance.now() - started < 6_500, true);
    assertEquals(cancelled, true);
    assertEquals(
      (timeoutResponse.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="),
      false,
    );
  });

  it("proves callback replay is local-cookie bounded and fails closed after clearing", async () => {
    const { runtime, state, nonce, cookie } = await startTransaction();
    const first = await successfulCallback(runtime, state, nonce, cookie, "one-time-code");
    assertEquals(first.status, 303);
    assertEquals((first.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="), true);

    const noTransaction = await runtime.handleAuthRoute(
      new Request(`${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=one-time-code`),
    );
    assert(noTransaction);
    assertEquals(noTransaction.status, 400);
    assertEquals(
      (noTransaction.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="),
      false,
    );

    let tokenCalls = 0;
    const replay = await withMockFetch(
      (input) => {
        const url = String(input);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return Promise.resolve(oidcMetadata());
        }
        if (url === `${ISSUER}/token`) {
          tokenCalls += 1;
          return Promise.resolve(Response.json({ error: "invalid_grant" }, { status: 400 }));
        }
        return Promise.reject(new Error("unexpected replay fetch"));
      },
      () =>
        runtime.handleAuthRoute(
          new Request(`${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=one-time-code`, {
            headers: { cookie },
          }),
        ),
    );
    assert(replay);
    assertEquals(tokenCalls, 1);
    assertEquals(replay.status, 400);
    assertEquals(
      (replay.headers.get("Set-Cookie") ?? "").includes(`__Host-vf_oidc_tx_${state}=;`),
      true,
    );
    assertEquals((replay.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="), false);
  });

  it("enforces session cookie boundaries and navigation-specific admission responses", async () => {
    const { runtime, state, nonce, cookie } = await startTransaction();
    const callback = await successfulCallback(runtime, state, nonce, cookie);
    const session = sessionCookie(callback);

    const htmlGet = await runtime.admitRequest(
      new Request(`${APP_ORIGIN}/dashboard?x=1`, { headers: { accept: "text/html" } }),
    );
    assert(htmlGet instanceof Response);
    assertEquals(htmlGet.status, 302);
    assertEquals(
      htmlGet.headers.get("Location"),
      "/_veryfront/auth/login?returnTo=%2Fdashboard%3Fx%3D1",
    );

    const htmlHead = await runtime.admitRequest(
      new Request(`${APP_ORIGIN}/dashboard`, { method: "HEAD", headers: { accept: "text/html" } }),
    );
    assert(htmlHead instanceof Response);
    assertEquals(htmlHead.status, 302);

    const api = await runtime.admitRequest(new Request(`${APP_ORIGIN}/api/data`));
    assert(api instanceof Response);
    assertEquals(api.status, 401);

    const invalidCookies = [
      `${session}x`,
      `${session}; ${session}`,
      "__Host-vf_session=not-a-cookie",
    ];
    for (const invalidCookie of invalidCookies) {
      const denied = await runtime.admitRequest(
        new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: invalidCookie } }),
      );
      assert(denied instanceof Response);
      assertEquals(denied.status, 401);
      assertEquals(
        (denied.headers.get("Set-Cookie") ?? "").startsWith("__Host-vf_session=;"),
        true,
      );
    }

    const expired = await createRuntimeAt(NOW + 28_801).admitRequest(
      new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
    );
    assert(expired instanceof Response);
    assertEquals(expired.status, 401);

    const rotated = await createRuntimeWith({
      APP_URL: APP_ORIGIN,
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
      OIDC_SESSION_SECRET: "x".repeat(32),
    }).admitRequest(new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }));
    assert(rotated instanceof Response);
    assertEquals(rotated.status, 401);

    const mismatchedClaims = await createRuntimeWith({
      APP_URL: APP_ORIGIN,
      OIDC_ISSUER: "https://other-issuer.example.test",
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
      OIDC_SESSION_SECRET: SESSION_SECRET,
    }).admitRequest(new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }));
    assert(mismatchedClaims instanceof Response);
    assertEquals(mismatchedClaims.status, 401);

    const hugeClaims = await createSignedIdToken({
      iss: ISSUER,
      sub: "subject-123",
      aud: "client-id",
      nonce,
      iat: NOW,
      exp: NOW + 300,
      groups: Array.from({ length: 500 }, (_, index) => `group-${index}`),
    });
    const hugeSession = await withMockFetch(
      (input) => {
        const url = String(input);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return Promise.resolve(oidcMetadata());
        }
        if (url === `${ISSUER}/token`) {
          return Promise.resolve(Response.json({ id_token: hugeClaims.token }));
        }
        if (url === `${ISSUER}/jwks`) {
          return Promise.resolve(Response.json({ keys: [hugeClaims.jwk] }));
        }
        return Promise.reject(new Error("unexpected huge-claims fetch"));
      },
      () =>
        runtime.handleAuthRoute(
          new Request(`${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=huge`, {
            headers: { cookie },
          }),
        ),
    );
    assert(hugeSession);
    assertEquals(hugeSession.status, 400);
    assertEquals(
      (hugeSession.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="),
      false,
    );
  });

  it("compacts moderate Entra group claims into a fail-closed stateless session", async () => {
    const runtime = createRuntimeAt(
      NOW,
      {
        APP_URL: APP_ORIGIN,
        OIDC_ISSUER: ISSUER,
        OIDC_CLIENT_ID: "client-id",
        OIDC_CLIENT_SECRET: CLIENT_SECRET,
        OIDC_SESSION_SECRET: SESSION_SECRET,
      },
      {
        claims: {
          email: "email",
          name: "name",
          groups: "groups",
          roles: "roles",
        },
      },
    );
    const { state, nonce, cookie } = await startTransaction(runtime);
    const signed = await createSignedIdToken({
      iss: ISSUER,
      sub: "entra-subject",
      aud: "client-id",
      nonce,
      iat: NOW,
      exp: NOW + 300,
      email: "user@example.test",
      name: "Example User",
      groups: Array.from(
        { length: 199 },
        (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      ),
      roles: ["application-admin"],
    });

    const callback = await withMockFetch(
      (input) => {
        const url = String(input);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return Promise.resolve(oidcMetadata());
        }
        if (url === `${ISSUER}/token`) {
          return Promise.resolve(Response.json({ id_token: signed.token }));
        }
        if (url === `${ISSUER}/jwks`) {
          return Promise.resolve(Response.json({ keys: [signed.jwk] }));
        }
        return Promise.reject(new Error("unexpected Entra claims fetch"));
      },
      () =>
        runtime.handleAuthRoute(
          new Request(`${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=ok`, {
            headers: { cookie },
          }),
        ),
    );

    assert(callback);
    assertEquals(callback.status, 303);
    const admitted = await runtime.admitRequest(
      new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: sessionCookie(callback) } }),
    );
    assert(!(admitted instanceof Response));
    assertEquals(admitted.subject, "entra-subject");
    assertEquals(admitted.email, "user@example.test");
    assertEquals(admitted.name, "Example User");
    assertEquals(admitted.groups, []);
    assertEquals(admitted.roles, []);
    assertEquals(admitted.groupsComplete, false);
    assertEquals(admitted.claims.aud, "client-id");
    assertEquals(admitted.claims.groups, undefined);
    assertEquals(admitted.claims.roles, undefined);
  });

  it("rejects a scope-only policy change after Array.sort is poisoned", async () => {
    const { runtime, state, nonce, cookie } = await startTransaction();
    const restore = [
      replacePropertyForTest(
        Array.prototype,
        "sort",
        function (this: unknown[], ...args: unknown[]): unknown[] {
          for (let index = 0; index < this.length; index += 1) {
            if (this[index] === "openid") {
              this.length = 0;
              return this;
            }
          }
          return TestReflectApply(TestArrayPrototypeSort, this, args) as unknown[];
        },
      ),
    ];

    try {
      const callback = await successfulCallback(runtime, state, nonce, cookie);
      assertEquals(callback.status, 303);
      const session = sessionCookie(callback);

      const unchanged = await runtime.admitRequest(
        new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
      );
      assert(!(unchanged instanceof Response));

      const changedPolicy = await createRuntimeAt(
        NOW,
        {
          APP_URL: APP_ORIGIN,
          OIDC_ISSUER: ISSUER,
          OIDC_CLIENT_ID: "client-id",
          OIDC_CLIENT_SECRET: CLIENT_SECRET,
          OIDC_SESSION_SECRET: SESSION_SECRET,
        },
        {
          scopes: ["openid", "groups"],
        },
      ).admitRequest(
        new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
      );
      assert(changedPolicy instanceof Response);
      assertEquals(changedPolicy.status, 401);
    } finally {
      for (let index = restore.length - 1; index >= 0; index -= 1) restore[index]?.();
    }
  });

  it("rejects a claim-only policy change between distinct lone surrogates", async () => {
    const initialRuntime = createRuntimeAt(
      NOW,
      undefined,
      { claims: { groups: "\uD800" } },
    );
    const { state, nonce, cookie } = await startTransaction(initialRuntime);
    const callback = await successfulCallback(initialRuntime, state, nonce, cookie);
    assertEquals(callback.status, 303);
    const session = sessionCookie(callback);

    const changedPolicy = await createRuntimeAt(
      NOW,
      undefined,
      { claims: { groups: "\uD801" } },
    ).admitRequest(
      new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
    );

    assert(changedPolicy instanceof Response);
    assertEquals(changedPolicy.status, 401);
  });

  it("rejects a claim-only policy change after TextEncoder.encode is poisoned", async () => {
    const initialRuntime = createRuntimeAt(
      NOW,
      undefined,
      { claims: { groups: "\uD800" } },
    );
    const { state, nonce, cookie } = await startTransaction(initialRuntime);
    const callback = await successfulCallback(initialRuntime, state, nonce, cookie);
    assertEquals(callback.status, 303);
    const session = sessionCookie(callback);
    const restore = replacePropertyForTest(
      TextEncoder.prototype,
      "encode",
      function (this: TextEncoder, value = ""): Uint8Array {
        const encoded = value === "\uD800" || value === "\uD801" ? "\uFFFD" : value;
        return TestReflectApply(TestTextEncoderPrototypeEncode, this, [encoded]) as Uint8Array;
      },
    );

    try {
      const changedPolicy = await createRuntimeAt(
        NOW,
        undefined,
        { claims: { groups: "\uD801" } },
      ).admitRequest(
        new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
      );
      assert(changedPolicy instanceof Response);
      assertEquals(changedPolicy.status, 401);
    } finally {
      restore();
    }
  });

  it("rejects a session policy change after crypto digest is poisoned", async () => {
    const originalDigest = crypto.subtle.digest;
    crypto.subtle.digest = () => Promise.resolve(new Uint8Array(32).buffer);

    try {
      const { runtime, state, nonce, cookie } = await startTransaction();
      const callback = await successfulCallback(runtime, state, nonce, cookie);
      assertEquals(callback.status, 303);
      const session = sessionCookie(callback);

      const changedPolicy = await createRuntimeAt(
        NOW,
        undefined,
        { scopes: ["openid", "groups"] },
      ).admitRequest(
        new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
      );

      assert(changedPolicy instanceof Response);
      assertEquals(changedPolicy.status, 401);
    } finally {
      crypto.subtle.digest = originalDigest;
    }
  });

  it("rejects a trusted endpoint origin policy change without depending on origin order", async () => {
    const initialRuntime = createRuntimeAt(
      NOW,
      undefined,
      {
        trustedEndpointOrigins: [
          "https://tokens-b.example.test",
          "https://tokens-a.example.test",
        ],
      },
    );
    const { state, nonce, cookie } = await startTransaction(initialRuntime);
    const callback = await successfulCallback(initialRuntime, state, nonce, cookie);
    assertEquals(callback.status, 303);
    const session = sessionCookie(callback);

    const sameOrigins = await createRuntimeAt(
      NOW,
      undefined,
      {
        trustedEndpointOrigins: [
          "https://tokens-a.example.test",
          "https://tokens-b.example.test",
        ],
      },
    ).admitRequest(
      new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
    );
    assert(!(sameOrigins instanceof Response));
    assertEquals(sameOrigins.subject, "subject-123");

    const changedOrigins = await createRuntimeAt(
      NOW,
      undefined,
      { trustedEndpointOrigins: ["https://tokens-a.example.test"] },
    ).admitRequest(
      new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
    );

    assert(changedOrigins instanceof Response);
    assertEquals(changedOrigins.status, 401);
  });

  it("preserves an unchanged session after typed-array set is poisoned", async () => {
    const { runtime, state, nonce, cookie } = await startTransaction();
    const callback = await successfulCallback(runtime, state, nonce, cookie);
    assertEquals(callback.status, 303);
    const session = sessionCookie(callback);
    const restore = replacePropertyForTest(
      TestTypedArrayPrototype,
      "set",
      function (this: Uint8Array, source: ArrayLike<number>, offset?: number): void {
        if (
          source instanceof Uint8Array && source[0] === 0 && source[1] === 0 &&
          source[2] === 0 && source[3] === 30
        ) {
          return;
        }
        TestReflectApply(TestUint8ArrayPrototypeSet, this, [source, offset ?? 0]);
      },
    );

    try {
      const admitted = await runtime.admitRequest(
        new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
      );
      assert(!(admitted instanceof Response));
      assertEquals(admitted.subject, "subject-123");
    } finally {
      restore();
    }
  });

  it("rejects a forged policy binding after typed-array iteration is poisoned", async () => {
    const setCookie = await createSessionCookie({
      secret: SESSION_SECRET,
      payload: {
        v: 2,
        binding: "A".repeat(43),
        issuer: ISSUER,
        subject: "subject-123",
        claims: { iss: ISSUER, sub: "subject-123", aud: "client-id" },
      },
      maxAgeSeconds: 60,
      now: NOW,
      randomBytes: fixedRandom(),
    });
    const session = cookiePair(setCookie, "__Host-vf_session");
    const restore = replacePropertyForTest(
      TestTypedArrayPrototype,
      Symbol.iterator,
      function* (this: Uint8Array): IterableIterator<number> {
        for (let index = 0; index < this.length; index += 1) yield 0;
      },
    );

    try {
      const admitted = await createRuntime().admitRequest(
        new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
      );
      assert(admitted instanceof Response);
      assertEquals(admitted.status, 401);
    } finally {
      restore();
    }
  });

  it("rejects a scope change after mutable array iteration is poisoned", async () => {
    const { runtime, state, nonce, cookie } = await startTransaction(createRuntimeAt(NOW));
    const callback = await successfulCallback(runtime, state, nonce, cookie);
    assertEquals(callback.status, 303);
    const session = sessionCookie(callback);
    const restore = replacePropertyForTest(
      Array.prototype,
      Symbol.iterator,
      function* (this: unknown[]): IterableIterator<unknown> {
        let containsOpenid = false;
        for (let index = 0; index < this.length; index += 1) {
          if (this[index] === "openid") containsOpenid = true;
        }
        for (let index = 0; index < this.length; index += 1) {
          if (containsOpenid && this[index] === "groups") continue;
          yield this[index];
        }
      },
    );

    try {
      const changedPolicy = await createRuntimeAt(
        NOW,
        undefined,
        { scopes: ["openid", "groups"] },
      ).admitRequest(
        new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
      );
      assert(changedPolicy instanceof Response);
      assertEquals(changedPolicy.status, 401);
    } finally {
      restore();
    }
  });

  it("bounds environment and origin derivation while supporting independent parallel flows", async () => {
    for (
      const values of [
        {
          APP_URL: APP_ORIGIN,
          OIDC_ISSUER: ISSUER,
          OIDC_CLIENT_ID: "client-id",
          OIDC_CLIENT_SECRET: CLIENT_SECRET,
        },
        {
          APP_URL: APP_ORIGIN,
          OIDC_ISSUER: ISSUER,
          OIDC_CLIENT_ID: "client-id",
          OIDC_CLIENT_SECRET: CLIENT_SECRET,
          OIDC_SESSION_SECRET: "s".repeat(4_097),
        },
        {
          APP_URL: "http://app.example.test",
          OIDC_ISSUER: ISSUER,
          OIDC_CLIENT_ID: "client-id",
          OIDC_CLIENT_SECRET: CLIENT_SECRET,
          OIDC_SESSION_SECRET: SESSION_SECRET,
        },
      ]
    ) {
      const response = await createRuntimeWith(values).handleAuthRoute(
        new Request(`${APP_ORIGIN}/_veryfront/auth/login`),
      );
      assert(response);
      assertEquals(response.status, 500);
      await assertGenericFailure(response, [SESSION_SECRET, CLIENT_SECRET]);
    }

    const crossOrigin = await createRuntime().handleAuthRoute(
      new Request(`https://attacker.example.test/_veryfront/auth/login`),
    );
    assert(crossOrigin);
    assertEquals(crossOrigin.status, 500);
    await assertGenericFailure(crossOrigin, ["attacker", CLIENT_SECRET]);

    const noAppUrlRemote = await createRuntimeWith({
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
      OIDC_SESSION_SECRET: SESSION_SECRET,
    }).handleAuthRoute(new Request(`http://127.0.0.1:8787/_veryfront/auth/login`));
    assert(noAppUrlRemote);
    assertEquals(noAppUrlRemote.status, 500);

    const loopbackIssuer = "http://127.0.0.1:8788";
    const loopbackRuntime = createRuntimeWith({
      OIDC_ISSUER: loopbackIssuer,
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
      OIDC_SESSION_SECRET: SESSION_SECRET,
    });
    const loopbackLogin = await withMockFetch(
      (input) => {
        assertEquals(String(input), `${loopbackIssuer}/.well-known/openid-configuration`);
        return Promise.resolve(
          oidcMetadata({
            issuer: loopbackIssuer,
            authorization_endpoint: `${loopbackIssuer}/authorize`,
            token_endpoint: `${loopbackIssuer}/token`,
            jwks_uri: `${loopbackIssuer}/jwks`,
          }),
        );
      },
      () => loopbackRuntime.handleAuthRoute(loopbackRequest("/_veryfront/auth/login")),
    );
    assert(loopbackLogin);
    assertEquals(loopbackLogin.status, 302);
    const loopbackRedirect = new URL(loopbackLogin.headers.get("Location") ?? "");
    assertEquals(
      loopbackRedirect.searchParams.get("redirect_uri"),
      "http://127.0.0.1:8787/_veryfront/auth/callback",
    );
    const loopbackState = loopbackRedirect.searchParams.get("state");
    const loopbackNonce = loopbackRedirect.searchParams.get("nonce");
    assert(loopbackState);
    assert(loopbackNonce);
    const loopbackCookie = transactionCookie(loopbackLogin, loopbackState);
    const loopbackToken = await createSignedIdToken({
      iss: loopbackIssuer,
      sub: "loopback-subject",
      aud: "client-id",
      nonce: loopbackNonce,
      iat: NOW,
      exp: NOW + 300,
    });
    const loopbackCallback = await withMockFetch(
      (input) => {
        const url = String(input);
        if (url === `${loopbackIssuer}/.well-known/openid-configuration`) {
          return Promise.resolve(
            oidcMetadata({
              issuer: loopbackIssuer,
              authorization_endpoint: `${loopbackIssuer}/authorize`,
              token_endpoint: `${loopbackIssuer}/token`,
              jwks_uri: `${loopbackIssuer}/jwks`,
            }),
          );
        }
        if (url === `${loopbackIssuer}/token`) {
          return Promise.resolve(Response.json({ id_token: loopbackToken.token }));
        }
        if (url === `${loopbackIssuer}/jwks`) {
          return Promise.resolve(Response.json({ keys: [loopbackToken.jwk] }));
        }
        return Promise.reject(new Error("unexpected loopback callback fetch"));
      },
      () =>
        loopbackRuntime.handleAuthRoute(
          loopbackRequest(`/_veryfront/auth/callback?state=${loopbackState}&code=ok`, {
            headers: {
              cookie: loopbackCookie,
              "sec-fetch-site": "cross-site",
            },
          }),
        ),
    );
    assert(loopbackCallback);
    assertEquals(loopbackCallback.status, 303);

    const trustedHttpsOrigin = "https://127.0.0.1:8788";
    const internalHttpsRuntime = createRuntimeAt(
      NOW,
      {
        OIDC_ISSUER: loopbackIssuer,
        OIDC_CLIENT_ID: "client-id",
        OIDC_CLIENT_SECRET: CLIENT_SECRET,
        OIDC_SESSION_SECRET: SESSION_SECRET,
      },
      { trustedEndpointOrigins: [trustedHttpsOrigin] },
    );
    const internalLogin = await withMockFetch(
      () =>
        Promise.resolve(
          oidcMetadata({
            issuer: loopbackIssuer,
            authorization_endpoint: `${loopbackIssuer}/authorize`,
            token_endpoint: `${trustedHttpsOrigin}/token`,
            jwks_uri: `${loopbackIssuer}/jwks`,
          }),
        ),
      () => internalHttpsRuntime.handleAuthRoute(loopbackRequest("/_veryfront/auth/login")),
    );
    assert(internalLogin);
    const internalRedirect = new URL(internalLogin.headers.get("Location") ?? "");
    const internalState = internalRedirect.searchParams.get("state");
    const internalNonce = internalRedirect.searchParams.get("nonce");
    assert(internalState);
    assert(internalNonce);
    const internalCookie = transactionCookie(internalLogin, internalState);
    let internalTokenCalls = 0;
    const blockedToken = await withMockFetch(
      (input) => {
        const url = String(input);
        if (url === `${loopbackIssuer}/.well-known/openid-configuration`) {
          return Promise.resolve(
            oidcMetadata({
              issuer: loopbackIssuer,
              authorization_endpoint: `${loopbackIssuer}/authorize`,
              token_endpoint: `${trustedHttpsOrigin}/token`,
              jwks_uri: `${loopbackIssuer}/jwks`,
            }),
          );
        }
        if (url === `${trustedHttpsOrigin}/token`) {
          internalTokenCalls += 1;
          return Promise.resolve(Response.json({ id_token: "unexpected" }));
        }
        return Promise.reject(new Error("unexpected internal-token fetch"));
      },
      () =>
        internalHttpsRuntime.handleAuthRoute(
          loopbackRequest(`/_veryfront/auth/callback?state=${internalState}&code=ok`, {
            headers: { cookie: internalCookie },
          }),
        ),
    );
    assert(blockedToken);
    assertEquals(blockedToken.status, 400);
    assertEquals(internalTokenCalls, 0);
    assertEquals(
      (blockedToken.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="),
      false,
    );

    const internalJwksLogin = await withMockFetch(
      () =>
        Promise.resolve(
          oidcMetadata({
            issuer: loopbackIssuer,
            authorization_endpoint: `${loopbackIssuer}/authorize`,
            token_endpoint: `${loopbackIssuer}/token`,
            jwks_uri: `${trustedHttpsOrigin}/jwks`,
          }),
        ),
      () => internalHttpsRuntime.handleAuthRoute(loopbackRequest("/_veryfront/auth/login")),
    );
    assert(internalJwksLogin);
    const internalJwksRedirect = new URL(internalJwksLogin.headers.get("Location") ?? "");
    const internalJwksState = internalJwksRedirect.searchParams.get("state");
    const internalJwksNonce = internalJwksRedirect.searchParams.get("nonce");
    assert(internalJwksState);
    assert(internalJwksNonce);
    const internalJwksToken = await createSignedIdToken({
      iss: loopbackIssuer,
      sub: "loopback-subject",
      aud: "client-id",
      nonce: internalJwksNonce,
      iat: NOW,
      exp: NOW + 300,
    });
    let internalJwksCalls = 0;
    const blockedJwks = await withMockFetch(
      (input) => {
        const url = String(input);
        if (url === `${loopbackIssuer}/.well-known/openid-configuration`) {
          return Promise.resolve(
            oidcMetadata({
              issuer: loopbackIssuer,
              authorization_endpoint: `${loopbackIssuer}/authorize`,
              token_endpoint: `${loopbackIssuer}/token`,
              jwks_uri: `${trustedHttpsOrigin}/jwks`,
            }),
          );
        }
        if (url === `${loopbackIssuer}/token`) {
          return Promise.resolve(Response.json({ id_token: internalJwksToken.token }));
        }
        if (url === `${trustedHttpsOrigin}/jwks`) {
          internalJwksCalls += 1;
          return Promise.resolve(Response.json({ keys: [internalJwksToken.jwk] }));
        }
        return Promise.reject(new Error("unexpected internal-jwks fetch"));
      },
      () =>
        internalHttpsRuntime.handleAuthRoute(
          loopbackRequest(`/_veryfront/auth/callback?state=${internalJwksState}&code=ok`, {
            headers: { cookie: transactionCookie(internalJwksLogin, internalJwksState) },
          }),
        ),
    );
    assert(blockedJwks);
    assertEquals(blockedJwks.status, 400);
    assertEquals(internalJwksCalls, 0);
    assertEquals(
      (blockedJwks.headers.get("Set-Cookie") ?? "").includes("__Host-vf_session="),
      false,
    );

    const priorAllowedOrigins = Deno.env.get(HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV);
    Deno.env.set(HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV, trustedHttpsOrigin);
    try {
      const allowedRuntime = createRuntimeWith({
        OIDC_ISSUER: trustedHttpsOrigin,
        OIDC_CLIENT_ID: "client-id",
        OIDC_CLIENT_SECRET: CLIENT_SECRET,
        OIDC_SESSION_SECRET: SESSION_SECRET,
      });
      const allowedLogin = await withMockFetch(
        () =>
          Promise.resolve(
            oidcMetadata({
              issuer: trustedHttpsOrigin,
              authorization_endpoint: `${trustedHttpsOrigin}/authorize`,
              token_endpoint: `${trustedHttpsOrigin}/token`,
              jwks_uri: `${trustedHttpsOrigin}/jwks`,
            }),
          ),
        () => allowedRuntime.handleAuthRoute(loopbackRequest("/_veryfront/auth/login")),
      );
      assert(allowedLogin);
      assertEquals(allowedLogin.status, 302);
      const allowedRedirect = new URL(allowedLogin.headers.get("Location") ?? "");
      const allowedState = allowedRedirect.searchParams.get("state");
      const allowedNonce = allowedRedirect.searchParams.get("nonce");
      assert(allowedState);
      assert(allowedNonce);
      const allowedToken = await createSignedIdToken({
        iss: trustedHttpsOrigin,
        sub: "internal-subject",
        aud: "client-id",
        nonce: allowedNonce,
        iat: NOW,
        exp: NOW + 300,
      });
      let allowedTokenCalls = 0;
      let allowedJwksCalls = 0;
      const allowedCallback = await withMockFetch(
        (input) => {
          const url = String(input);
          if (url === `${trustedHttpsOrigin}/.well-known/openid-configuration`) {
            return Promise.resolve(
              oidcMetadata({
                issuer: trustedHttpsOrigin,
                authorization_endpoint: `${trustedHttpsOrigin}/authorize`,
                token_endpoint: `${trustedHttpsOrigin}/token`,
                jwks_uri: `${trustedHttpsOrigin}/jwks`,
              }),
            );
          }
          if (url === `${trustedHttpsOrigin}/token`) {
            allowedTokenCalls += 1;
            return Promise.resolve(Response.json({ id_token: allowedToken.token }));
          }
          if (url === `${trustedHttpsOrigin}/jwks`) {
            allowedJwksCalls += 1;
            return Promise.resolve(Response.json({ keys: [allowedToken.jwk] }));
          }
          return Promise.reject(new Error("unexpected allowed internal-provider fetch"));
        },
        () =>
          allowedRuntime.handleAuthRoute(
            loopbackRequest(
              `/_veryfront/auth/callback?state=${allowedState}&code=ok&scope=openid`,
              { headers: { cookie: transactionCookie(allowedLogin, allowedState) } },
            ),
          ),
      );
      assert(allowedCallback);
      assertEquals(allowedCallback.status, 303);
      assertEquals(allowedTokenCalls, 1);
      assertEquals(allowedJwksCalls, 1);
    } finally {
      if (priorAllowedOrigins === undefined) {
        Deno.env.delete(HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV);
      } else {
        Deno.env.set(HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV, priorAllowedOrigins);
      }
    }

    for (const returnTo of ["https://attacker.example.test/", "//attacker.example.test/"]) {
      const unsafe = await createRuntime().handleAuthRoute(
        new Request(`${APP_ORIGIN}/_veryfront/auth/login?returnTo=${encodeURIComponent(returnTo)}`),
      );
      assert(unsafe);
      assertEquals(unsafe.status, 400);
      await assertGenericFailure(unsafe, ["attacker"]);
    }

    const postLogin = await createRuntime().handleAuthRoute(
      new Request(`${APP_ORIGIN}/_veryfront/auth/login`, { method: "POST" }),
    );
    assert(postLogin);
    assertEquals(postLogin.status, 405);
    assertEquals(postLogin.headers.get("Allow"), "GET");
    const postCallback = await createRuntime().handleAuthRoute(
      new Request(`${APP_ORIGIN}/_veryfront/auth/callback`, { method: "POST" }),
    );
    assert(postCallback);
    assertEquals(postCallback.status, 405);
    assertEquals(postCallback.headers.get("Allow"), "GET");
    const missingEnvMethod = await createRuntimeWith({
      APP_URL: APP_ORIGIN,
    }).handleAuthRoute(new Request(`${APP_ORIGIN}/_veryfront/auth/login`, { method: "POST" }));
    assert(missingEnvMethod);
    assertEquals(missingEnvMethod.status, 405);
    assertEquals(missingEnvMethod.headers.get("Allow"), "GET");

    const parallelRuntime = createRuntime();
    const first = await startTransaction(parallelRuntime);
    const second = await startTransaction(parallelRuntime);
    assertEquals(first.state === second.state, false);
    const firstToken = await createSignedIdToken(
      {
        iss: ISSUER,
        sub: "first-subject",
        aud: "client-id",
        nonce: first.nonce,
        iat: NOW,
        exp: NOW + 300,
      },
      "first-key",
    );
    const secondToken = await createSignedIdToken(
      {
        iss: ISSUER,
        sub: "second-subject",
        aud: "client-id",
        nonce: second.nonce,
        iat: NOW,
        exp: NOW + 300,
      },
      "second-key",
    );
    const tokenByCode = new Map([
      ["first", firstToken],
      ["second", secondToken],
    ]);
    async function finishParallel(
      flow: typeof first,
      code: "first" | "second",
    ): Promise<Response> {
      const response = await withMockFetch(
        (input, init) => {
          const url = String(input);
          if (url.endsWith("/.well-known/openid-configuration")) {
            return Promise.resolve(oidcMetadata());
          }
          if (url === `${ISSUER}/token`) {
            assert(init?.body instanceof URLSearchParams);
            const body = init.body;
            const signed = tokenByCode.get(body.get("code") ?? "");
            assert(signed);
            return Promise.resolve(Response.json({ id_token: signed.token }));
          }
          if (url === `${ISSUER}/jwks`) {
            return Promise.resolve(Response.json({ keys: [firstToken.jwk, secondToken.jwk] }));
          }
          return Promise.reject(new Error("unexpected parallel fetch"));
        },
        () =>
          parallelRuntime.handleAuthRoute(
            new Request(`${APP_ORIGIN}/_veryfront/auth/callback?state=${flow.state}&code=${code}`, {
              headers: { cookie: flow.cookie },
            }),
          ),
      );
      assert(response);
      return response;
    }
    const secondCallback = await finishParallel(second, "second");
    const firstCallback = await finishParallel(first, "first");
    assertEquals(secondCallback.status, 303);
    assertEquals(firstCallback.status, 303);
    const secondAdmission = await parallelRuntime.admitRequest(
      new Request(`${APP_ORIGIN}/dashboard`, {
        headers: { cookie: sessionCookie(secondCallback) },
      }),
    );
    const firstAdmission = await parallelRuntime.admitRequest(
      new Request(`${APP_ORIGIN}/dashboard`, { headers: { cookie: sessionCookie(firstCallback) } }),
    );
    assert(!(secondAdmission instanceof Response));
    assert(!(firstAdmission instanceof Response));
    assertEquals(secondAdmission.subject, "second-subject");
    assertEquals(firstAdmission.subject, "first-subject");
  });

  it("accepts an Authelia scope response on another instance without sticky routing", async () => {
    const runtimeA = createRuntime();
    const runtimeB = createRuntime();
    let observedVerifier = "";

    const login = await withMockFetch(
      () =>
        Promise.resolve(
          Response.json({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: `${ISSUER}/jwks`,
          }),
        ),
      () => runtimeA.handleAuthRoute(new Request(`${APP_ORIGIN}/_veryfront/auth/login`)),
    );
    assert(login);
    const loginLocation = login.headers.get("Location");
    assert(loginLocation);
    const redirect = new URL(loginLocation);
    const state = redirect.searchParams.get("state");
    const nonce = redirect.searchParams.get("nonce");
    assert(state);
    assert(nonce);
    const cookie = transactionCookie(login, state);
    const signed = await createSignedIdToken({
      iss: ISSUER,
      sub: "subject-123",
      aud: "client-id",
      nonce,
      iat: NOW,
      exp: NOW + 300,
      email: "user@example.test",
    });

    const callback = await withMockFetch(
      async (input, init) => {
        const url = String(input);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return Response.json({
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/authorize`,
            token_endpoint: `${ISSUER}/token`,
            jwks_uri: `${ISSUER}/jwks`,
          });
        }
        if (url === `${ISSUER}/token`) {
          assert(init?.body instanceof URLSearchParams);
          const body = init.body;
          observedVerifier = body.get("code_verifier") ?? "";
          assertEquals(body.get("redirect_uri"), `${APP_ORIGIN}/_veryfront/auth/callback`);
          assertEquals(new Headers(init?.headers).get("authorization")?.startsWith("Basic "), true);
          return Response.json({ id_token: signed.token, access_token: "ignored" });
        }
        if (url === `${ISSUER}/jwks`) {
          return Response.json({ keys: [signed.jwk] });
        }
        throw new Error("unexpected OIDC fetch");
      },
      () =>
        runtimeB.handleAuthRoute(
          new Request(
            `${APP_ORIGIN}/_veryfront/auth/callback?state=${state}&code=ok&iss=${
              encodeURIComponent(ISSUER)
            }&scope=openid+profile+email+groups`,
            {
              headers: { cookie },
            },
          ),
        ),
    );

    assert(callback);
    assertEquals(callback.status, 303);
    assertEquals(callback.headers.get("Location"), "/");
    assertEquals(observedVerifier.length, 43);

    const session = sessionCookie(callback);
    const admittedA = await runtimeA.admitRequest(
      new Request(`${APP_ORIGIN}/dashboard`, { headers: { cookie: session } }),
    );
    const admittedB = await runtimeB.admitRequest(
      new Request(`${APP_ORIGIN}/dashboard`, { headers: { cookie: session } }),
    );
    assert(!(admittedA instanceof Response));
    assert(!(admittedB instanceof Response));
    assertEquals(admittedA.subject, "subject-123");
    assertEquals(admittedB.email, "user@example.test");

    const wrongSecret = createRuntimeWith({
      APP_URL: APP_ORIGIN,
      OIDC_ISSUER: ISSUER,
      OIDC_CLIENT_ID: "client-id",
      OIDC_CLIENT_SECRET: CLIENT_SECRET,
      OIDC_SESSION_SECRET: "x".repeat(32),
    });
    const rejected = await wrongSecret.admitRequest(
      new Request(`${APP_ORIGIN}/api/data`, { headers: { cookie: session } }),
    );
    assert(rejected instanceof Response);
    assertEquals(rejected.status, 401);
  });

  it("requires POST and same-origin Origin for logout while clearing only the session cookie", async () => {
    const runtime = createRuntime();

    for (const method of ["GET", "HEAD", "PUT"]) {
      const deniedMethod = await runtime.handleAuthRoute(
        new Request(`${APP_ORIGIN}/_veryfront/auth/logout`, { method }),
      );
      assert(deniedMethod);
      assertEquals(deniedMethod.status, 405);
      assertEquals(deniedMethod.headers.get("Allow"), "POST");
    }

    const combinedOrigin = new Headers();
    combinedOrigin.append("Origin", APP_ORIGIN);
    combinedOrigin.append("Origin", "https://attacker.example.test");

    for (
      const headers of [
        undefined,
        { origin: "not a url" },
        { origin: "https://attacker.example.test" },
        combinedOrigin,
      ]
    ) {
      const denied = await runtime.handleAuthRoute(
        new Request(`${APP_ORIGIN}/_veryfront/auth/logout`, { method: "POST", headers }),
      );
      assert(denied);
      assertEquals(denied.status, 403);
      await assertGenericFailure(denied, ["attacker", CLIENT_SECRET]);
    }

    const response = await withMockFetch(
      () => Promise.reject(new Error("logout must not call the provider")),
      () =>
        runtime.handleAuthRoute(
          new Request(`${APP_ORIGIN}/_veryfront/auth/logout`, {
            method: "POST",
            headers: { origin: APP_ORIGIN, cookie: "__Host-vf_session=old" },
          }),
        ),
    );

    assert(response);
    assertEquals(response.status, 303);
    assertEquals(
      (response.headers.get("Set-Cookie") ?? "").startsWith("__Host-vf_session=;"),
      true,
    );
    assertEquals((response.headers.get("Set-Cookie") ?? "").includes("token"), false);
  });
});
