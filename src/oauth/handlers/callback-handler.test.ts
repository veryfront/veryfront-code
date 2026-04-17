import { assertEquals, assertNotEquals } from "#std/assert";
import { createOAuthCallbackHandler } from "./callback-handler.ts";
import { MemoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig } from "../types.ts";

const TEST_CONFIG: OAuthServiceConfig = {
  providerId: "test-provider",
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

Deno.test("callback-handler: rejects request when state is unknown (forged)", async () => {
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

Deno.test("callback-handler: rejects request when state serviceId does not match", async () => {
  const tokenStore = new MemoryTokenStore();

  await tokenStore.setState("valid-state", {
    userId: "alice",
    serviceId: "other-provider", // mismatched!
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
    makeRequest({ code: "auth-code-123", state: "valid-state" }),
  );

  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assertEquals(location.searchParams.get("error"), "invalid_state");
});

Deno.test("callback-handler: rejects request when state has expired", async () => {
  const tokenStore = new MemoryTokenStore();

  await tokenStore.setState("expired-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
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

Deno.test("callback-handler: consumes state once (double-use rejected)", async () => {
  const tokenStore = new MemoryTokenStore();

  await tokenStore.setState("valid-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  });

  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  // First call consumes state
  await handler(makeRequest({ code: "auth-code-123", state: "valid-state" }));

  // Second call with same state should fail with invalid_state
  const response = await handler(
    makeRequest({ code: "auth-code-456", state: "valid-state" }),
  );

  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assertEquals(location.searchParams.get("error"), "invalid_state");
});

Deno.test("callback-handler: allows missing state when skipStateValidation is true", async () => {
  const tokenStore = new MemoryTokenStore();

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

Deno.test("callback-handler: proceeds with valid state matching serviceId", async () => {
  const tokenStore = new MemoryTokenStore();

  await tokenStore.setState("valid-state-abc", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
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

Deno.test("callback-handler: stores tokens keyed by (serviceId, userId) — bob's slot untouched", async () => {
  const tokenStore = new MemoryTokenStore();
  // Bob already connected
  await tokenStore.setTokens(TEST_CONFIG.serviceId, "bob", {
    accessToken: "bob-existing-token",
  });

  // Alice starts an OAuth flow
  await tokenStore.setState("alice-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  });

  // Stub token exchange to succeed without a network call by intercepting fetch.
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url: string | URL | Request, _init?: RequestInit) => {
    const href = typeof url === "string" ? url : (url as URL).toString();
    if (href === TEST_CONFIG.tokenUrl) {
      return new Response(
        JSON.stringify({
          access_token: "alice-access-token",
          refresh_token: "alice-refresh-token",
          expires_in: 3600,
          token_type: "Bearer",
          scope: "read",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  };

  try {
    const handler = createOAuthCallbackHandler(TEST_CONFIG, {
      tokenStore,
      baseUrl: "http://localhost:3000",
      envReader: (key) => ENV[key],
    });

    const response = await handler(
      makeRequest({ code: "auth-code-abc", state: "alice-state" }),
    );
    assertEquals(response.status, 302);

    // Alice's tokens stored under her userId
    const aliceTokens = await tokenStore.getTokens(TEST_CONFIG.serviceId, "alice");
    assertEquals(aliceTokens?.accessToken, "alice-access-token");

    // Bob's slot untouched
    const bobTokens = await tokenStore.getTokens(TEST_CONFIG.serviceId, "bob");
    assertEquals(bobTokens?.accessToken, "bob-existing-token");
  } finally {
    globalThis.fetch = origFetch;
  }
});
