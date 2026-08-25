import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createOidcApplicationAuthRuntime } from "./oidc-runtime.ts";
import type { PublicJwk } from "./jwks-cache.ts";

const NOW = 1_900_000_000;
const APP_ORIGIN = "https://app.example.test";
const ISSUER = "https://issuer.example.test";
const SESSION_SECRET = "s".repeat(32);
const CLIENT_SECRET = "client-secret-value";

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
  return createOidcApplicationAuthRuntime({
    config: {
      issuerEnvVar: "OIDC_ISSUER",
      clientIdEnvVar: "OIDC_CLIENT_ID",
      clientSecretEnvVar: "OIDC_CLIENT_SECRET",
      sessionSecretEnvVar: "OIDC_SESSION_SECRET",
      scopes: ["openid"],
    },
    env: env(values),
    now: () => NOW,
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
  const header = encodeJsonSegment({ alg: "RS256", kid: "test-key" });
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
      kid: "test-key",
      alg: "RS256",
      use: "sig",
      n: String(jwk.n),
      e: String(jwk.e),
    },
  };
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

  it("completes login on another runtime instance and admits the session without sticky routing", async () => {
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
            }`,
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

    const get = await runtime.handleAuthRoute(new Request(`${APP_ORIGIN}/_veryfront/auth/logout`));
    assert(get);
    assertEquals(get.status, 405);
    assertEquals(get.headers.get("Allow"), "POST");

    for (const headers of [undefined, { origin: "https://attacker.example.test" }]) {
      const denied = await runtime.handleAuthRoute(
        new Request(`${APP_ORIGIN}/_veryfront/auth/logout`, { method: "POST", headers }),
      );
      assert(denied);
      assertEquals(denied.status, 403);
    }

    const response = await runtime.handleAuthRoute(
      new Request(`${APP_ORIGIN}/_veryfront/auth/logout`, {
        method: "POST",
        headers: { origin: APP_ORIGIN },
      }),
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
