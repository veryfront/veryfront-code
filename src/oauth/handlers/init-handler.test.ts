import { assertEquals } from "#std/assert";
import { createOAuthDisconnectHandler, createOAuthStatusHandler } from "./init-handler.ts";
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

function makeRequest(): Request {
  return new Request("http://localhost:3000/api/auth/test-provider/status");
}

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
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
  });

  const res = await handler(makeRequest());
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.success, true);
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
