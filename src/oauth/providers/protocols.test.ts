import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { jiraConfig } from "./atlassian.ts";
import { OAuthProvider, OAuthService } from "./base.ts";
import { figmaConfig, hubspotConfig, linearConfig, notionConfig, slackConfig } from "./common.ts";
import type { OAuthServiceConfig, TokenExchangeResult } from "../types.ts";

interface CapturedTokenRequest {
  url: string;
  headers: Headers;
  body: string;
}

async function captureExchange(
  config: OAuthServiceConfig,
  responseBody: unknown = { access_token: "token" },
): Promise<{ request: CapturedTokenRequest; result: TokenExchangeResult }> {
  const credentials: Record<string, string> = {
    [config.clientIdEnvVar]: "client-id",
    [config.clientSecretEnvVar]: "client-secret",
  };
  const provider = new OAuthProvider(config, (key) => credentials[key]);
  const original = globalThis.fetch;
  let captured: CapturedTokenRequest | undefined;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    captured = {
      url: input instanceof Request ? input.url : String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ""),
    };
    return Promise.resolve(Response.json(responseBody));
  }) as typeof fetch;

  try {
    const result = await provider.exchangeCode({
      code: "authorization-code",
      redirectUri: "https://app.test/oauth/callback",
    });
    assert(captured, "expected a token request");
    return { request: captured, result };
  } finally {
    globalThis.fetch = original;
  }
}

describe("built-in OAuth provider wire contracts", () => {
  it("sends Notion's Basic-authenticated JSON token request and version header", async () => {
    const { request, result } = await captureExchange(notionConfig, {
      access_token: "token",
      refresh_token: null,
    });

    assertEquals(request.url, "https://api.notion.com/v1/oauth/token");
    assertEquals(request.headers.get("content-type"), "application/json");
    assertEquals(request.headers.get("notion-version"), "2026-03-11");
    assert(request.headers.get("authorization")?.startsWith("Basic "));
    assertEquals(JSON.parse(request.body), {
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: "https://app.test/oauth/callback",
    });
    assertEquals(result.success, true);
  });

  it("sends Atlassian's JSON token request with body credentials", async () => {
    const { request } = await captureExchange(jiraConfig);

    assertEquals(request.url, "https://auth.atlassian.com/oauth/token");
    assertEquals(request.headers.get("content-type"), "application/json");
    assertEquals(request.headers.has("authorization"), false);
    assertEquals(JSON.parse(request.body), {
      grant_type: "authorization_code",
      code: "authorization-code",
      redirect_uri: "https://app.test/oauth/callback",
      client_id: "client-id",
      client_secret: "client-secret",
    });
  });

  it("uses Figma's current Basic-authenticated form token endpoint", async () => {
    const { request } = await captureExchange(figmaConfig);

    assertEquals(request.url, "https://api.figma.com/v1/oauth/token");
    assertEquals(request.headers.get("content-type"), "application/x-www-form-urlencoded");
    assert(request.headers.get("authorization")?.startsWith("Basic "));
    const body = new URLSearchParams(request.body);
    assertEquals(body.get("grant_type"), "authorization_code");
    assertEquals(body.has("client_secret"), false);
  });

  it("uses HubSpot's current v3 token endpoint without unsupported PKCE fields", async () => {
    const { request } = await captureExchange(hubspotConfig);
    assertEquals(request.url, "https://api.hubapi.com/oauth/v3/token");
    const body = new URLSearchParams(request.body);
    assertEquals(body.get("client_id"), "client-id");
    assertEquals(body.get("client_secret"), "client-secret");
    assertEquals(body.has("code_verifier"), false);

    const credentials: Record<string, string> = {
      [hubspotConfig.clientIdEnvVar]: "client-id",
      [hubspotConfig.clientSecretEnvVar]: "client-secret",
    };
    const service = new OAuthService(hubspotConfig, undefined, (key) => credentials[key]);
    const authorization = await service.createAuthorizationUrl({
      redirectUri: "https://app.test/oauth/callback",
    });
    assertEquals(new URL(authorization.url).searchParams.has("code_challenge"), false);
  });

  it("serializes Slack and Linear authorization scopes with commas", async () => {
    for (const config of [slackConfig, linearConfig]) {
      const credentials: Record<string, string> = {
        [config.clientIdEnvVar]: "client-id",
        [config.clientSecretEnvVar]: "client-secret",
      };
      const service = new OAuthService(config, undefined, (key) => credentials[key]);
      const { url } = await service.createAuthorizationUrl({
        redirectUri: "https://app.test/oauth/callback",
      });
      assertEquals(
        new URL(url).searchParams.get("scope"),
        config.defaultScopes.join(","),
      );
    }
  });
});
