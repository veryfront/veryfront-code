import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { encodeAuthBase64Url } from "./base64url.ts";
import { createMockOidcProvider } from "./mock-oidc-provider.ts";

const STATE = "s".repeat(43);
const NONCE = "n".repeat(43);
const VERIFIER = "v".repeat(43);

async function challengeFor(verifier: string): Promise<string> {
  return encodeAuthBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))),
  );
}

describe("security/application-auth mock OIDC provider", () => {
  it("performs a bound one-time authorization-code exchange without exposing private keys", async () => {
    const provider = await createMockOidcProvider({
      issuer: "https://provider.example.test",
      clientId: "test-client",
      clientSecret: "test-client-secret",
      now: 1_900_000_000,
    });
    const authorizationUrl = new URL(provider.urls.authorization);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", "test-client");
    authorizationUrl.searchParams.set(
      "redirect_uri",
      "https://app.example.test/_veryfront/auth/callback",
    );
    authorizationUrl.searchParams.set("scope", "openid profile email groups");
    authorizationUrl.searchParams.set("state", STATE);
    authorizationUrl.searchParams.set("nonce", NONCE);
    authorizationUrl.searchParams.set("code_challenge", await challengeFor(VERIFIER));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    const authorization = provider.parseAuthorizationRedirect(authorizationUrl.href);
    assertEquals(authorization, {
      state: STATE,
      nonce: NONCE,
      redirectUri: "https://app.example.test/_veryfront/auth/callback",
      codeChallenge: await challengeFor(VERIFIER),
      codeChallengeMethod: "S256",
      clientId: "test-client",
      scope: "openid profile email groups",
      responseType: "code",
    });
    const callbackUrl = provider.mintAuthorizationCode(authorization, {
      claims: {
        sub: "subject-123",
        email: "person@example.test",
        groups: ["engineering"],
      },
    });
    const code = new URL(callbackUrl).searchParams.get("code");
    assert(code);

    await withMockFetch(provider.fetch, async () => {
      const discovery = await fetch(provider.urls.discovery);
      assertEquals(discovery.status, 200);
      assertEquals(await discovery.json(), {
        issuer: provider.urls.issuer,
        authorization_endpoint: provider.urls.authorization,
        token_endpoint: provider.urls.token,
        jwks_uri: provider.urls.jwks,
      });

      const tokenResponse = await fetch(provider.urls.token, {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa("test-client:test-client-secret")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: authorization.redirectUri,
          code_verifier: VERIFIER,
        }),
      });
      assertEquals(tokenResponse.status, 200);
      const tokenBody = await tokenResponse.json();
      assertEquals(typeof tokenBody.id_token, "string");

      const jwksResponse = await fetch(provider.urls.jwks);
      const jwks = await jwksResponse.json();
      assertEquals(jwks.keys.length, 1);
      assertEquals(jwks.keys[0].kid, "key-a");
      assertEquals("d" in jwks.keys[0], false);
      assertEquals("p" in jwks.keys[0], false);

      const replay = await fetch(provider.urls.token, {
        method: "POST",
        headers: {
          authorization: `Basic ${btoa("test-client:test-client-secret")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: authorization.redirectUri,
          code_verifier: VERIFIER,
        }),
      });
      assertEquals(replay.status, 400);
    });

    assertEquals(provider.getCallCounts(), {
      authorization: 1,
      discovery: 1,
      jwks: 1,
      token: 2,
      unexpected: 0,
    });
    const snapshots = JSON.stringify(provider.getRequestSnapshots());
    for (
      const sensitive of [
        "test-client-secret",
        code,
        VERIFIER,
        NONCE,
        STATE,
        "person@example.test",
        "engineering",
      ]
    ) {
      assertEquals(snapshots.includes(sensitive), false);
    }
  });

  it("supports key publication changes and bounded protocol fixtures", async () => {
    const provider = await createMockOidcProvider();
    provider.publishKeys(["key-b", "key-b"]);

    await withMockFetch(provider.fetch, async () => {
      const duplicateJwks = await (await fetch(provider.urls.jwks)).json();
      assertEquals(
        duplicateJwks.keys.map((key: { readonly kid?: string }) => key.kid),
        ["key-b", "key-b"],
      );

      provider.setFixture("jwks", { kind: "wrong-content-type" });
      const wrongType = await fetch(provider.urls.jwks);
      assertEquals(wrongType.headers.get("content-type"), "text/plain");

      provider.setFixture("discovery", { kind: "duplicate-json-keys" });
      const duplicateJson = await fetch(provider.urls.discovery);
      assertEquals((await duplicateJson.text()).includes('"issuer"'), true);

      provider.setFixture("token", { kind: "redirect" });
      const redirect = await fetch(provider.urls.token, { method: "POST", redirect: "manual" });
      assertEquals(redirect.status, 302);
    });

    provider.setKeyId("key-c", "replacement-kid");
    provider.publishKeys(["key-c"]);
    const token = await provider.issueIdToken({
      key: "key-c",
      nonce: NONCE,
      claims: { sub: "replacement-subject" },
    });
    const headerSegment = token.split(".")[0];
    assert(headerSegment);
    assertEquals(
      JSON.parse(atob(headerSegment.replaceAll("-", "+").replaceAll("_", "/"))).kid,
      "replacement-kid",
    );

    await assertRejects(
      () =>
        withMockFetch(provider.fetch, () => fetch("https://unregistered.example.test/secret-path")),
      TypeError,
      "Mock OIDC provider rejected an unregistered request",
    );
    assertEquals(provider.getCallCounts().unexpected, 1);
  });

  it("refuses to mint a code for an authorization request bound to another client", async () => {
    const provider = await createMockOidcProvider({
      clientId: "registered-client",
      clientSecret: "registered-secret",
    });
    const authorizationUrl = new URL(provider.urls.authorization);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("client_id", "different-client");
    authorizationUrl.searchParams.set(
      "redirect_uri",
      "https://app.example.test/_veryfront/auth/callback",
    );
    authorizationUrl.searchParams.set("scope", "openid");
    authorizationUrl.searchParams.set("state", STATE);
    authorizationUrl.searchParams.set("nonce", NONCE);
    authorizationUrl.searchParams.set("code_challenge", await challengeFor(VERIFIER));
    authorizationUrl.searchParams.set("code_challenge_method", "S256");
    const authorization = provider.parseAuthorizationRedirect(authorizationUrl.href);

    assertThrows(
      () => provider.mintAuthorizationCode(authorization),
      TypeError,
      "Mock OIDC provider rejected an invalid authorization request",
    );
  });
});
