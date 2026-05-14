import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#std/assert";
import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  createOAuthDisconnectHandler,
  createOAuthInitHandler,
  createOAuthStatusHandler,
} from "./init-handler.ts";
import { MemoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig, OAuthTokens, StoredOAuthState, TokenStore } from "../types.ts";

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

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/auth/test-provider/status");
}

function makeEnv(appUrl = "http://localhost:3000"): EnvironmentConfig {
  return { ...getEnvironmentConfig(), appUrl };
}

function createFailingStateStore(message: string): TokenStore {
  return {
    async getTokens(): Promise<OAuthTokens | null> {
      return null;
    },
    async setTokens(): Promise<void> {},
    async clearTokens(): Promise<void> {},
    async setState(): Promise<void> {
      throw new Error(message);
    },
    async consumeState(): Promise<StoredOAuthState | null> {
      return null;
    },
  };
}

Deno.test("init handler: returns 401 when getUserId is not provided (fail-closed)", async () => {
  // deno-lint-ignore no-explicit-any
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    env: makeEnv(),
    envReader: (key: string) => ENV[key],
    // intentionally omit getUserId to simulate caller who forgets — but TS requires it,
    // so we cast to `any` only to check runtime fail-closed behavior.
  } as any);

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));
  assertEquals(response.status, 401);
});

Deno.test("init handler: returns 401 when isAuthenticated returns false", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: store,
    env: makeEnv(),
    envReader: (key: string) => ENV[key],
    isAuthenticated: () => false,
    getUserId: () => "alice",
  });

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));
  assertEquals(response.status, 401);
});

Deno.test("init handler: returns 401 when getUserId returns null", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: store,
    env: makeEnv(),
    envReader: (key: string) => ENV[key],
    getUserId: () => null,
  });

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));
  assertEquals(response.status, 401);
});

Deno.test("init handler: returns 401 when getUserId returns empty string", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: store,
    env: makeEnv(),
    envReader: (key: string) => ENV[key],
    getUserId: () => "",
  });

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));
  assertEquals(response.status, 401);
});

Deno.test("init handler: returns 503 when oauth is not configured", async () => {
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    env: makeEnv(),
    envReader: () => undefined,
    getUserId: () => "alice",
  });

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));

  // SEC-009: misconfiguration is Service Unavailable, not a generic 500.
  assertEquals(response.status, 503);
  assertEquals(await response.json(), {
    error: "Test Provider OAuth not configured",
  });
});

Deno.test("init handler: not-configured response does not leak env var names (SEC-009)", async () => {
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    env: makeEnv(),
    envReader: () => undefined,
    getUserId: () => "alice",
  });

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));

  assertEquals(response.status, 503);

  const bodyText = await response.text();
  // Internal env var names must NOT appear in the response body.
  assertEquals(bodyText.includes(TEST_CONFIG.clientIdEnvVar), false);
  assertEquals(bodyText.includes(TEST_CONFIG.clientSecretEnvVar), false);
  // The body still surfaces a generic "not configured" message to the caller.
  assertEquals(bodyText.includes("not configured"), true);

  const body = JSON.parse(bodyText) as Record<string, unknown>;
  assertEquals("details" in body, false);
});

Deno.test("init handler: stores state with userId and redirects to the provider", async () => {
  const store = new MemoryTokenStore();
  const appUrl = "https://example.test";
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: store,
    env: makeEnv(appUrl),
    envReader: (key: string) => ENV[key],
    getUserId: () => "alice",
  });

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));

  assertEquals(response.status, 302);

  const location = new URL(response.headers.get("location")!);
  assertEquals(location.origin + location.pathname, "https://provider.test/auth");
  assertEquals(location.searchParams.get("client_id"), "test-id");
  assertEquals(
    location.searchParams.get("redirect_uri"),
    `${appUrl}/api/auth/test-provider/callback`,
  );
  assertEquals(location.searchParams.get("scope"), "read");
  assertEquals(location.searchParams.get("code_challenge_method"), "S256");

  const state = location.searchParams.get("state");
  if (!state) {
    throw new Error("expected redirect state parameter to be present");
  }

  // Peek without consuming — use a separate method for test assertion by consuming a clone.
  const storedState = await store.consumeState(state);
  assertEquals(storedState?.userId, "alice");
  assertEquals(storedState?.serviceId, "test-provider");
  assertEquals(storedState?.redirectUri, `${appUrl}/api/auth/test-provider/callback`);
  assertEquals(storedState?.scopes, ["read"]);
});

Deno.test("init handler: supports async isAuthenticated and getUserId", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: store,
    env: makeEnv("https://example.test"),
    envReader: (key: string) => ENV[key],
    isAuthenticated: () => Promise.resolve(true),
    getUserId: () => Promise.resolve("bob"),
  });

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));

  assertEquals(response.status, 302);
  const state = new URL(response.headers.get("location")!).searchParams.get("state")!;
  const storedState = await store.consumeState(state);
  assertEquals(storedState?.userId, "bob");
});

Deno.test("init handler: returns 500 when state persistence fails", async () => {
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: createFailingStateStore("state store failed"),
    env: makeEnv(),
    envReader: (key: string) => ENV[key],
    getUserId: () => "alice",
  });

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));

  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: "Failed to initiate OAuth flow",
    details: "state store failed",
  });
});

Deno.test("status handler: returns 401 when getUserId is not provided (fail-closed)", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
    // deno-lint-ignore no-explicit-any
  } as any);

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
});

Deno.test("status handler: returns 401 when getUserId returns null", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
    getUserId: () => null,
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
});

Deno.test("status handler: returns status for authenticated user", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
    getUserId: () => "alice",
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.service, "test-provider");
  assertEquals(body.connected, false);
});

Deno.test("status handler: returns 401 when isAuthenticated returns false", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
    isAuthenticated: () => false,
    getUserId: () => "alice",
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Unauthorized");
});

Deno.test("status handler: scopes token lookup to caller userId", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens(TEST_CONFIG.serviceId, "alice", { accessToken: "alice-token" });
  await store.setTokens(TEST_CONFIG.serviceId, "bob", { accessToken: "bob-token" });

  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
    getUserId: () => "alice",
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.connected, true);

  // Bob's tokens must still be there
  assertEquals((await store.getTokens(TEST_CONFIG.serviceId, "bob"))?.accessToken, "bob-token");
});

Deno.test("status handler: treats expired access as connected when refresh token exists", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens(TEST_CONFIG.serviceId, "alice", {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() - 1_000,
  });

  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
    getUserId: () => "alice",
  });

  const res = await handler(makeRequest());

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.connected, true);
  assertEquals(body.hasRefreshToken, true);
});

Deno.test("status handler: supports async isAuthenticated and getUserId", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
    isAuthenticated: async () => false,
    getUserId: async () => "alice",
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
});

Deno.test("disconnect handler: returns 401 when getUserId is not provided (fail-closed)", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
    // deno-lint-ignore no-explicit-any
  } as any);

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
});

Deno.test("disconnect handler: clears only the calling user's tokens", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens(TEST_CONFIG.serviceId, "alice", { accessToken: "alice-token" });
  await store.setTokens(TEST_CONFIG.serviceId, "bob", { accessToken: "bob-token" });

  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
    getUserId: () => "alice",
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);

  assertEquals(await store.getTokens(TEST_CONFIG.serviceId, "alice"), null);
  // Bob's tokens must be untouched
  assertEquals(
    (await store.getTokens(TEST_CONFIG.serviceId, "bob"))?.accessToken,
    "bob-token",
  );
});

Deno.test("disconnect handler: returns 401 when isAuthenticated returns false", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
    isAuthenticated: () => false,
    getUserId: () => "alice",
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Unauthorized");
});

Deno.test("disconnect handler: supports async isAuthenticated and getUserId", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
    isAuthenticated: async () => false,
    getUserId: async () => "alice",
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
});
