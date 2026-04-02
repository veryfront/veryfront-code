import { assertEquals } from "#std/assert";
import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  createOAuthDisconnectHandler,
  createOAuthInitHandler,
  createOAuthStatusHandler,
} from "./init-handler.ts";
import { MemoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig, OAuthState, OAuthTokens, TokenStore } from "../types.ts";

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
    async getState(): Promise<OAuthState | null> {
      return null;
    },
    async setState(): Promise<void> {
      throw new Error(message);
    },
    async clearState(): Promise<void> {},
  };
}

Deno.test("init handler: returns 500 when oauth is not configured", async () => {
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    env: makeEnv(),
    envReader: () => undefined,
  });

  const response = await handler();

  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: "Test Provider OAuth not configured",
    details: "Missing TEST_CLIENT_ID or TEST_CLIENT_SECRET",
  });
});

Deno.test("init handler: stores state and redirects to the provider", async () => {
  const store = new MemoryTokenStore();
  const appUrl = "https://example.test";
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: store,
    env: makeEnv(appUrl),
    envReader: (key: string) => ENV[key],
  });

  const response = await handler();

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

  const storedState = await store.getState(state);
  assertEquals(storedState?.redirectUri, `${appUrl}/api/auth/test-provider/callback`);
  assertEquals(storedState?.scopes, ["read"]);
});

Deno.test("init handler: returns 500 when state persistence fails", async () => {
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: createFailingStateStore("state store failed"),
    env: makeEnv(),
    envReader: (key: string) => ENV[key],
  });

  const response = await handler();

  assertEquals(response.status, 500);
  assertEquals(await response.json(), {
    error: "Failed to initiate OAuth flow",
    details: "state store failed",
  });
});

Deno.test("status handler: returns status without isAuthenticated", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
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
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Unauthorized");
});

Deno.test("status handler: returns status when isAuthenticated returns true", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
    isAuthenticated: () => true,
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.service, "test-provider");
});

Deno.test("status handler: treats expired access as connected when refresh token exists", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens(TEST_CONFIG.serviceId, {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() - 1_000,
  });

  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
  });

  const res = await handler(makeRequest());

  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.connected, true);
  assertEquals(body.hasRefreshToken, true);
});

Deno.test("status handler: supports async isAuthenticated", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key: string) => ENV[key],
    isAuthenticated: async () => false,
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
});

Deno.test("disconnect handler: returns success without isAuthenticated", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens(TEST_CONFIG.serviceId, { accessToken: "access-token" });
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
  assertEquals(await store.getTokens(TEST_CONFIG.serviceId), null);
});

Deno.test("disconnect handler: returns 401 when isAuthenticated returns false", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
    isAuthenticated: () => false,
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, "Unauthorized");
});

Deno.test("disconnect handler: returns success when isAuthenticated returns true", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
    isAuthenticated: () => true,
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
});

Deno.test("disconnect handler: supports async isAuthenticated", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
    isAuthenticated: async () => false,
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 401);
});
