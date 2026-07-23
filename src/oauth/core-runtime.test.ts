import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createOAuthStatusHandler } from "./handlers/init-handler.ts";
import { MemoryTokenStore } from "./token-store/memory.ts";
import type { OAuthServiceConfig, StoredOAuthState, TokenStore } from "./types.ts";
import { isOAuthRedirectUrl, isSecureOAuthEndpointUrl } from "./url-validation.ts";

const TEST_CONFIG: OAuthServiceConfig = {
  providerId: "runtime-test",
  serviceId: "runtime-test",
  displayName: "Runtime Test",
  clientIdEnvVar: "RUNTIME_TEST_CLIENT_ID",
  clientSecretEnvVar: "RUNTIME_TEST_CLIENT_SECRET",
  authorizationUrl: "https://provider.test/authorize",
  tokenUrl: "https://provider.test/token",
  apiBaseUrl: "https://api.provider.test",
  defaultScopes: ["read"],
};

describe("OAuth cross-runtime contracts", () => {
  it("accepts only secure provider endpoints and explicit loopback HTTP redirects", () => {
    assertEquals(isSecureOAuthEndpointUrl("https://provider.test/token"), true);
    assertEquals(isSecureOAuthEndpointUrl("http://provider.test/token"), false);
    assertEquals(isSecureOAuthEndpointUrl("https://user:secret@provider.test/token"), false);
    assertEquals(isSecureOAuthEndpointUrl("https://provider.test/token#fragment"), false);

    assertEquals(isOAuthRedirectUrl("https://app.test/oauth/callback"), true);
    assertEquals(isOAuthRedirectUrl("http://127.0.0.1:8787/oauth/callback"), true);
    assertEquals(isOAuthRedirectUrl("http://localhost:8787/oauth/callback"), true);
    assertEquals(isOAuthRedirectUrl("http://app.test/oauth/callback"), false);
  });

  it("keeps in-memory tokens detached and consumes OAuth state exactly once", async () => {
    const store = new MemoryTokenStore("runtime-test");
    const inputTokens = { accessToken: "access", refreshToken: "refresh" };
    await store.setTokens(TEST_CONFIG.serviceId, "alice", inputTokens);
    inputTokens.accessToken = "mutated";

    const firstTokens = await store.getTokens(TEST_CONFIG.serviceId, "alice");
    const secondTokens = await store.getTokens(TEST_CONFIG.serviceId, "alice");
    assertEquals(firstTokens?.accessToken, "access");
    assertNotStrictEquals(firstTokens, secondTokens);

    const state: StoredOAuthState = {
      userId: "alice",
      serviceId: TEST_CONFIG.serviceId,
      redirectUri: "https://app.test/oauth/callback",
      scopes: ["read"],
      createdAt: Date.now(),
      metadata: { source: "runtime-test" },
    };
    await store.setState("state", state);
    state.scopes![0] = "mutated";
    const consumed = await store.consumeState("state");
    assertEquals(consumed?.scopes, ["read"]);
    assertEquals(await store.consumeState("state"), null);
  });

  it("does not report expired tokens as connected without refresh capabilities", async () => {
    const store: TokenStore = {
      getTokens: () =>
        Promise.resolve({
          accessToken: "expired",
          refreshToken: "refresh",
          expiresAt: Date.now() - 1_000,
        }),
      setTokens: () => Promise.resolve(),
      clearTokens: () => Promise.resolve(),
      setState: () => Promise.resolve(),
      consumeState: () => Promise.resolve(null),
    };
    const handler = createOAuthStatusHandler(TEST_CONFIG, {
      tokenStore: store,
      envReader: () => "configured",
      getUserId: () => "alice",
    });

    const response = await handler(new Request("https://app.test/api/auth/runtime-test/status"));
    const body = await response.json();
    assertEquals(response.status, 200);
    assertEquals(body.connected, false);
    assertEquals(body.refreshCapable, false);
  });
});
