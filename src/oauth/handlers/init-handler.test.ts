import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#std/assert";
import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  createOAuthDisconnectHandler,
  createOAuthInitHandler,
  createOAuthStatusHandler,
} from "./init-handler.ts";
import { MemoryTokenStore } from "../token-store/memory.ts";
import { MAX_OAUTH_USER_ID_LENGTH } from "../limits.ts";
import type {
  AuthorizationUrlOptions,
  OAuthServiceConfig,
  OAuthTokens,
  StoredOAuthState,
  TokenStore,
} from "../types.ts";

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

function makeDisconnectRequest(origin = "http://localhost:3000"): Request {
  return new Request("http://localhost:3000/api/auth/test-provider/disconnect", {
    method: "POST",
    headers: { Origin: origin },
  });
}

function makeEnv(appUrl = "http://localhost:3000"): EnvironmentConfig {
  return { ...getEnvironmentConfig(), appUrl };
}

function makeDeploymentEnv(
  nodeEnv: string,
  appUrl: string | undefined = "https://app.test",
): EnvironmentConfig {
  return { ...getEnvironmentConfig(), nodeEnv, veryfrontEnv: nodeEnv, appUrl };
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

Deno.test("OAuth handlers reject oversized user identifiers before store access", async () => {
  const oversizedUserId = "u".repeat(MAX_OAUTH_USER_ID_LENGTH + 1);
  let storeOperations = 0;
  const store: TokenStore = {
    getTokens: () => {
      storeOperations++;
      return Promise.resolve(null);
    },
    setTokens: () => {
      storeOperations++;
      return Promise.resolve();
    },
    clearTokens: () => {
      storeOperations++;
      return Promise.resolve();
    },
    setState: () => {
      storeOperations++;
      return Promise.resolve();
    },
    consumeState: () => {
      storeOperations++;
      return Promise.resolve(null);
    },
  };
  const sharedOptions = {
    tokenStore: store,
    env: makeEnv(),
    envReader: (key: string) => ENV[key],
    getUserId: () => oversizedUserId,
  };

  const responses = await Promise.all([
    createOAuthInitHandler(TEST_CONFIG, sharedOptions)(makeRequest()),
    createOAuthStatusHandler(TEST_CONFIG, sharedOptions)(makeRequest()),
    createOAuthDisconnectHandler(TEST_CONFIG, sharedOptions)(makeDisconnectRequest()),
  ]);

  assertEquals(responses.map((response) => response.status), [401, 401, 401]);
  assertEquals(storeOperations, 0);
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

Deno.test("init handler binds provider state to an explicit shared callback route", async () => {
  const store = new MemoryTokenStore();
  const appUrl = "https://example.test";
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: store,
    callbackRouteId: "shared-oauth",
    env: makeEnv(appUrl),
    envReader: (key: string) => ENV[key],
    getUserId: () => "alice",
  });

  const response = await handler(new Request("http://localhost:3000/api/auth/test-provider"));
  const location = new URL(response.headers.get("location")!);
  const expectedRedirectUri = `${appUrl}/api/auth/shared-oauth/callback`;
  const state = location.searchParams.get("state")!;

  assertEquals(location.searchParams.get("redirect_uri"), expectedRedirectUri);
  assertEquals((await store.consumeState(state))?.redirectUri, expectedRedirectUri);
});

Deno.test("init handler validates an explicit callback route eagerly", () => {
  assertThrows(
    () =>
      createOAuthInitHandler(TEST_CONFIG, {
        callbackRouteId: "invalid/route",
        env: makeEnv(),
        envReader: (key) => ENV[key],
        getUserId: () => "alice",
      }),
    Error,
    "unsupported characters",
  );
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
  // SEC-009: the response must NOT leak internal error details (e.g. the
  // underlying "state store failed" message). It is logged server-side only.
  assertEquals(await response.json(), {
    error: "Failed to initiate OAuth flow",
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

Deno.test("status handler does not claim an expired token is usable without refresh capabilities", async () => {
  const store: TokenStore = {
    getTokens: () =>
      Promise.resolve({
        accessToken: "expired-access-token",
        refreshToken: "refresh-token",
        expiresAt: Date.now() - 1_000,
      }),
    setTokens: () => Promise.resolve(),
    clearTokens: () => Promise.resolve(),
    setState: () => Promise.resolve(),
    consumeState: () => Promise.resolve(null),
  };
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key) => ENV[key],
    getUserId: () => "alice",
  });

  const response = await handler(makeRequest());
  assertEquals(response.status, 200);
  const body = await response.json();
  assertEquals(body.connected, false);
  assertEquals(body.refreshCapable, false);
});

Deno.test("status handler: treats an epoch expiry as expired", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens(TEST_CONFIG.serviceId, "alice", {
    accessToken: "expired-access-token",
    expiresAt: 0,
  });
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: store,
    envReader: (key) => ENV[key],
    getUserId: () => "alice",
  });

  const response = await handler(makeRequest());
  assertEquals((await response.json()).connected, false);
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

  const res = await handler(makeDisconnectRequest());
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

  const res = await handler(makeDisconnectRequest());
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

  const res = await handler(makeDisconnectRequest());
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

  const res = await handler(makeDisconnectRequest());
  assertEquals(res.status, 401);
});

Deno.test("OAuth handlers reject unexpected HTTP methods before application callbacks", async () => {
  let callbackCalls = 0;
  const options = {
    tokenStore: new MemoryTokenStore(),
    env: makeEnv(),
    envReader: (key: string) => ENV[key],
    getUserId: () => {
      callbackCalls++;
      return "alice";
    },
  };

  const initResponse = await createOAuthInitHandler(TEST_CONFIG, options)(
    new Request("http://localhost:3000/api/auth/test-provider", { method: "POST" }),
  );
  const statusResponse = await createOAuthStatusHandler(TEST_CONFIG, options)(
    new Request("http://localhost:3000/api/auth/test-provider/status", { method: "POST" }),
  );
  const disconnectResponse = await createOAuthDisconnectHandler(TEST_CONFIG, options)(
    makeRequest(),
  );

  assertEquals(
    [initResponse.status, statusResponse.status, disconnectResponse.status],
    [405, 405, 405],
  );
  assertEquals(initResponse.headers.get("allow"), "GET");
  assertEquals(statusResponse.headers.get("allow"), "GET");
  assertEquals(disconnectResponse.headers.get("allow"), "POST");
  assertEquals(callbackCalls, 0);
});

Deno.test("disconnect handler rejects missing and cross-origin CSRF origins", async () => {
  const store = new MemoryTokenStore();
  await store.setTokens(TEST_CONFIG.serviceId, "alice", { accessToken: "token" });
  let userIdCalls = 0;
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore: store,
    env: makeEnv(),
    getUserId: () => {
      userIdCalls++;
      return "alice";
    },
  });

  const missingOrigin = await handler(
    new Request("http://localhost:3000/api/auth/test-provider/disconnect", { method: "POST" }),
  );
  const crossOrigin = await handler(makeDisconnectRequest("https://attacker.test"));

  assertEquals([missingOrigin.status, crossOrigin.status], [403, 403]);
  assertEquals(userIdCalls, 0);
  assertEquals((await store.getTokens(TEST_CONFIG.serviceId, "alice"))?.accessToken, "token");
});

Deno.test("init handler: rejects whitespace-only user identifiers", async () => {
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    env: makeEnv(),
    envReader: (key) => ENV[key],
    getUserId: () => "   ",
  });

  assertEquals((await handler(makeRequest())).status, 401);
});

Deno.test("init handler: rejects noncanonical user identifier whitespace", async () => {
  const store = new MemoryTokenStore();
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: store,
    env: makeEnv(),
    envReader: (key) => ENV[key],
    getUserId: () => "  alice  ",
  });

  const response = await handler(makeRequest());
  assertEquals(response.status, 401);
});

Deno.test("init handler: rejects caller-supplied state instead of weakening CSRF entropy", () => {
  assertThrows(
    () =>
      createOAuthInitHandler(TEST_CONFIG, {
        env: makeEnv(),
        envReader: (key) => ENV[key],
        getUserId: () => "alice",
        authOptions: { state: "fixed-state" },
      }),
    Error,
    "state",
  );
});

Deno.test("init handler rejects malformed or handler-owned authorization options eagerly", () => {
  for (
    const [authOptions, expectedMessage] of [
      [{ redirectUri: "https://other.test/callback" }, "redirectUri"],
      [{ scopes: "read" }, "scopes"],
      [{ additionalParams: null }, "authorization parameter"],
    ] as const
  ) {
    assertThrows(
      () =>
        createOAuthInitHandler(TEST_CONFIG, {
          env: makeEnv(),
          envReader: (key) => ENV[key],
          getUserId: () => "alice",
          authOptions: authOptions as unknown as AuthorizationUrlOptions,
        }),
      Error,
      expectedMessage,
    );
  }
});

Deno.test("init handler: requires PKCE instead of permitting a handler-level downgrade", () => {
  assertThrows(
    () =>
      createOAuthInitHandler(TEST_CONFIG, {
        env: makeEnv(),
        envReader: (key) => ENV[key],
        getUserId: () => "alice",
        authOptions: { usePkce: false },
      }),
    Error,
    "requires PKCE",
  );
});

Deno.test("init handler omits PKCE only for providers declaring it unsupported", async () => {
  const store = new MemoryTokenStore();
  const config = { ...TEST_CONFIG, pkceMode: "unsupported" as const };
  const handler = createOAuthInitHandler(config, {
    tokenStore: store,
    env: makeEnv(),
    envReader: (key) => ENV[key],
    getUserId: () => "alice",
  });

  const response = await handler(makeRequest());
  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assertEquals(location.searchParams.has("code_challenge"), false);
  const state = await store.consumeState(location.searchParams.get("state")!);
  assertEquals(state?.codeVerifier, undefined);
});

Deno.test("init handler: snapshots authorization options at construction", async () => {
  const authOptions = {
    scopes: ["read"],
    additionalParams: { audience: "original" },
  };
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: new MemoryTokenStore(),
    env: makeEnv(),
    envReader: (key) => ENV[key],
    getUserId: () => "alice",
    authOptions,
  });

  authOptions.scopes[0] = "mutated";
  authOptions.additionalParams.audience = "mutated";
  Object.assign(authOptions, { state: "attacker-controlled" });

  const response = await handler(makeRequest());
  const location = new URL(response.headers.get("location")!);
  assertEquals(location.searchParams.get("scope"), "read");
  assertEquals(location.searchParams.get("audience"), "original");
  assertEquals(location.searchParams.get("state") === "attacker-controlled", false);
});

Deno.test("init handler: rejects invalid application base URLs eagerly", () => {
  for (
    const baseUrl of [
      "javascript:alert(1)",
      "https://user:password@app.test",
      "https://app.test/base-path",
      "https://app.test/?next=elsewhere",
      " https://app.test",
    ]
  ) {
    assertThrows(
      () =>
        createOAuthInitHandler(TEST_CONFIG, {
          baseUrl,
          env: makeEnv(),
          envReader: (key) => ENV[key],
          getUserId: () => "alice",
        }),
      Error,
      "application URL",
    );
  }
});

Deno.test("init handler: authentication resolver failures return a generic 500", async () => {
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    env: makeEnv(),
    envReader: (key) => ENV[key],
    getUserId: () => {
      throw new Error("private session backend detail");
    },
  });

  const response = await handler(makeRequest());
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Failed to initiate OAuth flow" });
});

Deno.test("init handler: authorization redirects prevent caching and referrer leakage", async () => {
  const handler = createOAuthInitHandler(TEST_CONFIG, {
    tokenStore: new MemoryTokenStore(),
    env: makeEnv(),
    envReader: (key) => ENV[key],
    getUserId: () => "alice",
  });

  const response = await handler(makeRequest());
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
});

Deno.test("status handler: token-store failures are sanitized and non-cacheable", async () => {
  const tokenStore = createFailingStateStore("unused");
  tokenStore.getTokens = () => Promise.reject(new Error("private database detail"));
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore,
    envReader: (key) => ENV[key],
    getUserId: () => "alice",
  });

  const response = await handler(makeRequest());
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Failed to read OAuth status" });
  assertEquals(response.headers.get("cache-control"), "no-store");
});

Deno.test("status handler: malformed token-store rows fail closed", async () => {
  const tokenStore = createFailingStateStore("unused");
  tokenStore.getTokens = () => Promise.resolve({ accessToken: "   " });
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore,
    envReader: (key) => ENV[key],
    getUserId: () => "alice",
  });

  const response = await handler(makeRequest());
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Failed to read OAuth status" });
});

Deno.test("disconnect handler: token-store failures do not report success", async () => {
  const tokenStore = createFailingStateStore("unused");
  tokenStore.clearTokens = () => Promise.reject(new Error("private database detail"));
  const handler = createOAuthDisconnectHandler(TEST_CONFIG, {
    tokenStore,
    getUserId: () => "alice",
  });

  const response = await handler(makeDisconnectRequest());
  assertEquals(response.status, 500);
  assertEquals(await response.json(), { error: "Failed to disconnect OAuth provider" });
  assertEquals(response.headers.get("cache-control"), "no-store");
});

Deno.test("OAuth handlers require an explicit shared store outside development/test", () => {
  const env = makeDeploymentEnv("production");
  assertThrows(
    () =>
      createOAuthInitHandler(TEST_CONFIG, {
        env,
        envReader: (key) => ENV[key],
        getUserId: () => "alice",
      }),
    Error,
    "explicit shared TokenStore",
  );
  assertThrows(
    () =>
      createOAuthStatusHandler(TEST_CONFIG, {
        env,
        envReader: (key) => ENV[key],
        getUserId: () => "alice",
      }),
    Error,
    "explicit shared TokenStore",
  );
  assertThrows(
    () =>
      createOAuthDisconnectHandler(TEST_CONFIG, {
        env,
        getUserId: () => "alice",
      }),
    Error,
    "explicit shared TokenStore",
  );
});

Deno.test("OAuth application URLs require HTTPS outside explicit local environments", () => {
  for (const nodeEnv of ["production", "staging", "preview", "custom"]) {
    assertThrows(
      () =>
        createOAuthInitHandler(TEST_CONFIG, {
          tokenStore: new MemoryTokenStore(),
          env: makeDeploymentEnv(nodeEnv, "http://localhost:3000"),
          envReader: (key) => ENV[key],
          getUserId: () => "alice",
        }),
      Error,
      "HTTPS",
    );
  }
  assertThrows(
    () =>
      createOAuthInitHandler(TEST_CONFIG, {
        tokenStore: new MemoryTokenStore(),
        env: { ...makeDeploymentEnv("staging"), appUrl: undefined },
        envReader: (key) => ENV[key],
        getUserId: () => "alice",
      }),
    Error,
    "base URL not configured",
  );
});

Deno.test("status handler uses provider credential normalization", async () => {
  const handler = createOAuthStatusHandler(TEST_CONFIG, {
    tokenStore: new MemoryTokenStore(),
    envReader: () => "   ",
    getUserId: () => "alice",
  });

  const response = await handler(makeRequest());
  assertEquals((await response.json()).configured, false);
});

Deno.test("handler factories snapshot mutable provider configuration", async () => {
  const config: OAuthServiceConfig = {
    ...TEST_CONFIG,
    defaultScopes: [...TEST_CONFIG.defaultScopes],
  };
  const store = new MemoryTokenStore();
  const handler = createOAuthInitHandler(config, {
    tokenStore: store,
    env: makeEnv(),
    envReader: (key) => ENV[key],
    getUserId: () => "alice",
  });

  config.serviceId = "mutated";
  config.displayName = "Mutated";
  config.defaultScopes[0] = "write";
  const response = await handler(makeRequest());
  const location = new URL(response.headers.get("location")!);
  const state = location.searchParams.get("state")!;

  assertEquals(location.searchParams.get("scope"), "read");
  assertEquals((await store.consumeState(state))?.serviceId, "test-provider");
  assertEquals(
    location.searchParams.get("redirect_uri"),
    "http://localhost:3000/api/auth/test-provider/callback",
  );
});
