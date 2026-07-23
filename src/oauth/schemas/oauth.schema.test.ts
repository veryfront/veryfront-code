import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import {
  getAuthorizationUrlOptionsSchema,
  getOAuthProviderConfigSchema,
  getOAuthServiceConfigSchema,
  getOAuthStateSchema,
  getOAuthTokensSchema,
  getTokenExchangeOptionsSchema,
  getTokenExchangeResultSchema,
} from "./oauth.schema.ts";
import * as providerCatalog from "../providers/index.ts";

const PROVIDER_CONFIG = {
  providerId: "provider",
  displayName: "Provider",
  authorizationUrl: "https://provider.test/authorize",
  tokenUrl: "https://provider.test/token",
  clientIdEnvVar: "CLIENT_ID",
  clientSecretEnvVar: "CLIENT_SECRET",
};

Deno.test("OAuth schemas accept the hardened public contracts", () => {
  const parsedConfig = getOAuthServiceConfigSchema().safeParse({
    ...PROVIDER_CONFIG,
    serviceId: "provider.service-1",
    defaultScopes: ["read"],
    apiBaseUrl: "https://api.provider.test/v1",
    requestTimeoutMs: 30_000,
    maxTokenResponseBytes: 64 * 1_024,
    maxApiResponseBytes: 1024 * 1_024,
    tokenRequestFormat: "json",
    pkceMode: "unsupported",
    tokenRequestHeaders: { "X-Provider-Version": "2026-01-01" },
    apiHeaders: { "X-Provider-Version": "2026-01-01" },
  });
  assertEquals(parsedConfig.success, true);
  if (parsedConfig.success) {
    assertEquals(parsedConfig.data.tokenRequestFormat, "json");
    assertEquals(parsedConfig.data.pkceMode, "unsupported");
    assertEquals(parsedConfig.data.maxApiResponseBytes, 1024 * 1_024);
  }
  assertEquals(
    getOAuthTokensSchema().safeParse({ accessToken: "token", expiresAt: 0 }).success,
    true,
  );
  assertEquals(
    getOAuthStateSchema().safeParse({
      state: "state",
      codeVerifier: "v".repeat(64),
      redirectUri: "https://app.test/api/auth/provider/callback",
      scopes: ["read"],
      createdAt: Date.now(),
    }).success,
    true,
  );
});

Deno.test("OAuth schemas reject values that constructors reject", () => {
  for (
    const config of [
      { ...PROVIDER_CONFIG, additionalAuthParams: { state: "fixed" } },
      { ...PROVIDER_CONFIG, additionalAuthParams: { STATE: "fixed" } },
      { ...PROVIDER_CONFIG, additionalTokenParams: { client_secret: "fixed" } },
      { ...PROVIDER_CONFIG, additionalTokenParams: { CLIENT_SECRET: "fixed" } },
      { ...PROVIDER_CONFIG, tokenRequestHeaders: { Authorization: "Basic wrong" } },
      { ...PROVIDER_CONFIG, apiHeaders: { Authorization: "Bearer wrong" } },
      { ...PROVIDER_CONFIG, authorizationUrl: "https://provider.test/auth?client_id=fixed" },
      { ...PROVIDER_CONFIG, authorizationUrl: "https://provider.test/auth?CLIENT_ID=fixed" },
      { ...PROVIDER_CONFIG, tokenUrl: "https://provider.test/token?code=fixed" },
      { ...PROVIDER_CONFIG, providerId: "provider id" },
      { ...PROVIDER_CONFIG, clientIdEnvVar: "INVALID-NAME" },
      { ...PROVIDER_CONFIG, additionalAuthParams: { ["x".repeat(129)]: "value" } },
      { ...PROVIDER_CONFIG, additionalTokenParams: { audience: "x".repeat(4_097) } },
      { ...PROVIDER_CONFIG, tokenRequestHeaders: { "X-Large": "x".repeat(8_193) } },
      { ...PROVIDER_CONFIG, tokenResponseMapping: { accessToken: "" } },
      {
        ...PROVIDER_CONFIG,
        tokenResponseMapping: { accessToken: "token", refreshToken: "token" },
      },
    ]
  ) {
    assertEquals(getOAuthProviderConfigSchema().safeParse(config).success, false);
  }

  assertEquals(
    getOAuthServiceConfigSchema().safeParse({
      ...PROVIDER_CONFIG,
      serviceId: "provider",
      defaultScopes: ["read,write"],
      scopeSeparator: ",",
      apiBaseUrl: "https://api.provider.test",
    }).success,
    false,
  );
});

Deno.test("OAuth provider schemas reject unsafe URLs and invalid numeric bounds", () => {
  for (
    const authorizationUrl of [
      "not a URL",
      "ftp://provider.test/authorize",
      "https://user:password@provider.test/authorize",
      "https://provider.test/authorize#fragment",
    ]
  ) {
    assertEquals(
      getOAuthProviderConfigSchema().safeParse({
        ...PROVIDER_CONFIG,
        authorizationUrl,
      }).success,
      false,
    );
  }

  for (const requestTimeoutMs of [0, 1.5, Number.POSITIVE_INFINITY]) {
    assertEquals(
      getOAuthProviderConfigSchema().safeParse({
        ...PROVIDER_CONFIG,
        requestTimeoutMs,
      }).success,
      false,
    );
  }

  for (const maxApiResponseBytes of [0, 1.5, Number.POSITIVE_INFINITY, 11 * 1_048_576]) {
    assertEquals(
      getOAuthProviderConfigSchema().safeParse({
        ...PROVIDER_CONFIG,
        maxApiResponseBytes,
      }).success,
      false,
    );
  }
});

Deno.test("OAuth schemas reject blank credentials, tokens, codes, and scopes", () => {
  assertEquals(
    getOAuthProviderConfigSchema().safeParse({
      ...PROVIDER_CONFIG,
      clientIdEnvVar: "   ",
    }).success,
    false,
  );
  assertEquals(getOAuthTokensSchema().safeParse({ accessToken: "   " }).success, false);
  assertEquals(
    getOAuthTokensSchema().safeParse({ accessToken: "x".repeat(65_537) }).success,
    false,
  );
  assertEquals(
    getOAuthServiceConfigSchema().safeParse({
      ...PROVIDER_CONFIG,
      serviceId: "provider",
      defaultScopes: ["   "],
      apiBaseUrl: "https://api.provider.test",
    }).success,
    false,
  );
  assertEquals(
    getTokenExchangeOptionsSchema().safeParse({
      code: "   ",
      redirectUri: "https://app.test/callback",
    }).success,
    false,
  );
});

Deno.test("OAuth request schemas bound state and validate redirects and PKCE", () => {
  assertEquals(
    getAuthorizationUrlOptionsSchema().safeParse({ state: "x".repeat(1_025) }).success,
    false,
  );
  assertEquals(
    getAuthorizationUrlOptionsSchema().safeParse({ redirectUri: "javascript:alert(1)" }).success,
    false,
  );
  assertEquals(
    getAuthorizationUrlOptionsSchema().safeParse({
      additionalParams: { STATE: "attacker-controlled" },
    }).success,
    false,
  );
  assertEquals(
    getAuthorizationUrlOptionsSchema().safeParse({
      additionalParams: { audience: "x".repeat(4_097) },
    }).success,
    false,
  );
  assertEquals(
    getTokenExchangeOptionsSchema().safeParse({
      code: "code",
      redirectUri: "https://app.test/callback",
      codeVerifier: "too-short",
    }).success,
    false,
  );
});

Deno.test("OAuth token exchange results enforce success and failure invariants", () => {
  assertEquals(
    getTokenExchangeResultSchema().safeParse({
      success: true,
      tokens: { accessToken: "token" },
    }).success,
    true,
  );
  assertEquals(
    getTokenExchangeResultSchema().safeParse({ success: false, error: "invalid_grant" }).success,
    true,
  );

  for (
    const result of [
      { success: true },
      { success: true, tokens: { accessToken: "token" }, error: "invalid_grant" },
      { success: false },
      { success: false, error: "invalid_grant", tokens: { accessToken: "token" } },
      { success: false, error: "x".repeat(129) },
    ]
  ) {
    assertEquals(getTokenExchangeResultSchema().safeParse(result).success, false);
  }
});

Deno.test("every built-in OAuth provider config satisfies the public service schema", () => {
  const configs = Object.entries(providerCatalog).filter(([name]) => name.endsWith("Config"));
  assertEquals(configs.length > 0, true);

  for (const [name, config] of configs) {
    const result = getOAuthServiceConfigSchema().safeParse(config);
    assertEquals(result.success, true, `${name} must satisfy OAuthServiceConfig`);
  }
});
