import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { createOAuthCallbackHandler } from "./callback-handler.ts";
import { MemoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig } from "../types.ts";

const TEST_CONFIG: OAuthServiceConfig = {
  serviceId: "test-provider",
  displayName: "Test Provider",
  clientIdEnvVar: "TEST_CLIENT_ID",
  clientSecretEnvVar: "TEST_CLIENT_SECRET",
  authorizationUrl: "https://provider.test/auth",
  tokenUrl: "https://provider.test/token",
  defaultScopes: ["read"],
  apiBaseUrl: "https://api.provider.test",
};

const ENV: Record<string, string> = {
  TEST_CLIENT_ID: "test-id",
  TEST_CLIENT_SECRET: "test-secret",
};

function makeRequest(params: Record<string, string>): Request {
  const url = new URL("http://localhost:3000/api/auth/test-provider/callback");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

Deno.test("callback-handler: rejects request when state parameter is missing", async () => {
  const tokenStore = new MemoryTokenStore();
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(makeRequest({ code: "auth-code-123" }));

  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assertEquals(location.searchParams.get("error"), "invalid_state");
});

Deno.test("callback-handler: rejects request when state parameter is invalid (not in store)", async () => {
  const tokenStore = new MemoryTokenStore();
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(
    makeRequest({ code: "auth-code-123", state: "bogus-state-value" }),
  );

  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assertEquals(location.searchParams.get("error"), "invalid_state");
});

Deno.test("callback-handler: rejects request when state has expired", async () => {
  const tokenStore = new MemoryTokenStore();

  await tokenStore.setState({
    state: "expired-state",
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now() - 11 * 60 * 1000, // 11 minutes ago, past 10-minute expiry
  });

  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(
    makeRequest({ code: "auth-code-123", state: "expired-state" }),
  );

  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assertEquals(location.searchParams.get("error"), "invalid_state");
});

Deno.test("callback-handler: allows missing state when skipStateValidation is true", async () => {
  const tokenStore = new MemoryTokenStore();

  // Store a valid state so token exchange can work
  await tokenStore.setState({
    state: "valid-state",
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  });

  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    skipStateValidation: true,
    envReader: (key) => ENV[key],
  });

  // Without state param - should NOT redirect with error
  const response = await handler(makeRequest({ code: "auth-code-123" }));

  // It should proceed to token exchange (which will fail due to no real server,
  // but the error should NOT be "invalid_state")
  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  const error = location.searchParams.get("error");
  if (error) {
    // Any error other than invalid_state is acceptable - it means state validation was skipped
    assertNotEquals(error, "invalid_state");
  }
});

Deno.test("callback-handler: calls onError with invalid_state when state is missing", async () => {
  const tokenStore = new MemoryTokenStore();
  let errorServiceId = "";
  let errorCode = "";

  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
    onError: (serviceId, error) => {
      errorServiceId = serviceId;
      errorCode = error;
    },
  });

  await handler(makeRequest({ code: "auth-code-123" }));

  assertEquals(errorServiceId, "test-provider");
  assertEquals(errorCode, "invalid_state");
});

Deno.test("callback-handler: accepts request with valid state from store", async () => {
  const tokenStore = new MemoryTokenStore();

  await tokenStore.setState({
    state: "valid-state-abc",
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  });

  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(
    makeRequest({ code: "auth-code-123", state: "valid-state-abc" }),
  );

  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  // Should NOT be invalid_state - it proceeds to token exchange
  const error = location.searchParams.get("error");
  if (error) {
    assertNotEquals(error, "invalid_state");
  }
});
