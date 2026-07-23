import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AuthorizationUrlOptionsSchema,
  OAuthProviderConfigSchema,
  OAuthStateSchema,
  OAuthTokensSchema,
  StoredOAuthStateSchema,
  TokenExchangeOptionsSchema,
  TokenExchangeResultSchema,
} from "./oauth.schema.ts";

const providerConfig = {
  providerId: "example",
  displayName: "Example",
  authorizationUrl: "https://provider.test/authorize",
  tokenUrl: "https://provider.test/token",
  clientIdEnvVar: "EXAMPLE_CLIENT_ID",
  clientSecretEnvVar: "EXAMPLE_CLIENT_SECRET",
};

describe("OAuth public schemas", () => {
  it("accepts a bounded HTTPS provider config", () => {
    assertEquals(OAuthProviderConfigSchema.safeParse(providerConfig).success, true);
    assertEquals(
      OAuthProviderConfigSchema.safeParse({ ...providerConfig, tokenRequestFormat: "json" })
        .success,
      true,
    );
  });

  it("rejects non-HTTP endpoints, malformed env names, and unbounded params", () => {
    assertEquals(
      OAuthProviderConfigSchema.safeParse({
        ...providerConfig,
        tokenUrl: "file:///tmp/token",
      }).success,
      false,
    );
    assertEquals(
      OAuthProviderConfigSchema.safeParse({
        ...providerConfig,
        tokenUrl: "http://provider.test/token",
      }).success,
      false,
    );
    assertEquals(
      OAuthProviderConfigSchema.safeParse({
        ...providerConfig,
        clientIdEnvVar: "invalid env name",
      }).success,
      false,
    );
    assertEquals(
      OAuthProviderConfigSchema.safeParse({
        ...providerConfig,
        tokenRequestFormat: "xml",
      }).success,
      false,
    );
    assertEquals(
      OAuthProviderConfigSchema.safeParse({
        ...providerConfig,
        additionalAuthParams: Object.fromEntries(
          Array.from({ length: 129 }, (_, index) => [`key-${index}`, "value"]),
        ),
      }).success,
      false,
    );
  });

  it("enforces token and token-exchange result invariants", () => {
    assertEquals(OAuthTokensSchema.safeParse({ accessToken: "" }).success, false);
    assertEquals(
      TokenExchangeResultSchema.safeParse({ success: true }).success,
      false,
    );
    assertEquals(
      TokenExchangeResultSchema.safeParse({ success: false }).success,
      false,
    );
    assertEquals(
      TokenExchangeResultSchema.safeParse({
        success: true,
        tokens: { accessToken: "token" },
      }).success,
      true,
    );
    assertEquals(
      TokenExchangeResultSchema.safeParse({
        success: false,
        error: "invalid_grant",
        tokens: { accessToken: "token" },
      }).success,
      false,
    );
  });

  it("validates PKCE, redirect URIs, state, and authorization collections", () => {
    assertEquals(
      OAuthStateSchema.safeParse({
        state: "state",
        codeVerifier: "too-short",
        redirectUri: "https://app.test/callback",
        scopes: ["read"],
        createdAt: Date.now(),
      }).success,
      false,
    );
    assertEquals(
      StoredOAuthStateSchema.safeParse({
        userId: "alice",
        serviceId: "github",
        redirectUri: "https://app.test/callback",
        createdAt: Date.now(),
      }).success,
      true,
    );
    assertEquals(
      TokenExchangeOptionsSchema.safeParse({
        code: "",
        redirectUri: "https://app.test/callback",
      }).success,
      false,
    );
    assertEquals(
      AuthorizationUrlOptionsSchema.safeParse({
        redirectUri: "javascript:alert(1)",
      }).success,
      false,
    );
    assertEquals(
      AuthorizationUrlOptionsSchema.safeParse({ scopes: ["read", "read"] }).success,
      false,
    );
    assertEquals(
      AuthorizationUrlOptionsSchema.safeParse({ scopes: ["read write"] }).success,
      false,
    );
    assertEquals(
      OAuthStateSchema.safeParse({
        state: "state",
        redirectUri: "https://app.test/callback",
        scopes: ["read"],
        createdAt: Date.now(),
        metadata: { invalid: () => "not persistent" },
      }).success,
      false,
    );
  });
});
