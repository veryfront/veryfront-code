import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#std/assert";
import { createTestEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  createOAuthCallbackHandler as createRuntimeOAuthCallbackHandler,
  type OAuthCallbackHandlerOptions,
} from "./callback-handler.ts";
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
const APP_URL = "http://localhost:3000";
const CODE_VERIFIER = "v".repeat(64);
const TEST_ENV = createTestEnvironmentConfig({
  veryfrontEnv: "test",
  appUrl: APP_URL,
});

function createOAuthCallbackHandler(
  config: OAuthServiceConfig,
  options: OAuthCallbackHandlerOptions = {},
): (request: Request) => Promise<Response> {
  return createRuntimeOAuthCallbackHandler(config, {
    env: TEST_ENV,
    ...options,
  });
}

function makeRequest(params: Record<string, string>): Request {
  const url = new URL(`${APP_URL}/api/auth/test-provider/callback`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new Request(url.toString());
}

function createConsumedStateStore(state: StoredOAuthState): TokenStore {
  let consumed = false;
  return {
    getTokens: () => Promise.resolve(null),
    setTokens: () => Promise.resolve(),
    clearTokens: () => Promise.resolve(),
    setState: () => Promise.resolve(),
    consumeState: () => {
      if (consumed) return Promise.resolve(null);
      consumed = true;
      return Promise.resolve(state);
    },
  };
}

Deno.test("callback-handler rejects non-GET requests before consuming state", async () => {
  let consumeCalls = 0;
  const tokenStore = new MemoryTokenStore();
  tokenStore.consumeState = () => {
    consumeCalls++;
    return Promise.resolve(null);
  };
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });
  const response = await handler(
    new Request("http://localhost:3000/api/auth/test-provider/callback?state=state", {
      method: "POST",
    }),
  );

  assertEquals(response.status, 405);
  assertEquals(response.headers.get("allow"), "GET");
  assertEquals(consumeCalls, 0);
});

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
    codeVerifier: CODE_VERIFIER,
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
  const tokenStore = createConsumedStateStore({
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
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

Deno.test("callback-handler: rejects stored state without a valid PKCE verifier", async () => {
  const tokenStore = createConsumedStateStore({
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  } as unknown as StoredOAuthState);
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(
    makeRequest({ code: "auth-code-123", state: "missing-verifier" }),
  );

  assertEquals(
    new URL(response.headers.get("location")!).searchParams.get("error"),
    "invalid_state",
  );
});

Deno.test("callback-handler rejects legacy state rows without transaction bindings", async () => {
  const legacyState: StoredOAuthState = {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: "a".repeat(43),
    createdAt: Date.now(),
  };
  const tokenStore = createConsumedStateStore(legacyState);
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(
    makeRequest({ code: "auth-code-123", state: "legacy-unbound-state" }),
  );

  assertEquals(
    new URL(response.headers.get("location")!).searchParams.get("error"),
    "invalid_state",
  );
});

Deno.test("callback-handler accepts verifier-free state for a provider without PKCE", async () => {
  const config = { ...TEST_CONFIG, pkceMode: "unsupported" as const };
  const tokenStore = createConsumedStateStore({
    userId: "alice",
    serviceId: config.serviceId,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  } as StoredOAuthState);
  const handler = createOAuthCallbackHandler(config, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(
    makeRequest({ code: "auth-code-123", state: "verifier-free-state" }),
  );

  assertNotEquals(
    new URL(response.headers.get("location")!).searchParams.get("error"),
    "invalid_state",
  );
});

Deno.test("callback-handler: consumes state once (double-use rejected)", async () => {
  const tokenStore = new MemoryTokenStore();

  await tokenStore.setState("valid-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
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

Deno.test("callback-handler: rejects the unsafe state-validation bypass", () => {
  assertThrows(
    () =>
      createOAuthCallbackHandler(TEST_CONFIG, {
        tokenStore: new MemoryTokenStore(),
        baseUrl: "http://localhost:3000",
        skipStateValidation: true,
        getUserId: () => "alice",
        envReader: (key) => ENV[key],
      }),
    Error,
    "state validation cannot be disabled",
  );
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
    codeVerifier: CODE_VERIFIER,
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
    codeVerifier: CODE_VERIFIER,
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

Deno.test("callback-handler: validates and consumes state before handling provider errors", async () => {
  const tokenStore = new MemoryTokenStore();
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const missingState = await handler(makeRequest({ error: "access_denied" }));
  assertEquals(
    new URL(missingState.headers.get("location")!).searchParams.get("error"),
    "invalid_state",
  );

  await tokenStore.setState("denied-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  });
  const denied = await handler(
    makeRequest({
      error: "access_denied",
      error_description: "provider supplied internal detail",
      state: "denied-state",
    }),
  );
  const deniedLocation = new URL(denied.headers.get("location")!);
  assertEquals(deniedLocation.searchParams.get("error"), "access_denied");
  assertEquals(deniedLocation.searchParams.has("error_description"), false);

  const replay = await handler(
    makeRequest({ error: "access_denied", state: "denied-state" }),
  );
  assertEquals(new URL(replay.headers.get("location")!).searchParams.get("error"), "invalid_state");
});

Deno.test("callback-handler: rejects duplicate security-sensitive query parameters", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.setState("first", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  });
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });
  const url = new URL("http://localhost:3000/api/auth/test-provider/callback");
  url.searchParams.append("code", "first-code");
  url.searchParams.append("code", "second-code");
  url.searchParams.append("state", "first");

  const response = await handler(new Request(url));
  assertEquals(
    new URL(response.headers.get("location")!).searchParams.get("error"),
    "invalid_request",
  );
  // An ambiguous request must not consume the legitimate state.
  assertEquals((await tokenStore.consumeState("first"))?.userId, "alice");
});

Deno.test("callback-handler: rejects oversized state before touching the store", async () => {
  const tokenStore = new MemoryTokenStore();
  let consumeCalls = 0;
  tokenStore.consumeState = () => {
    consumeCalls++;
    return Promise.resolve(null);
  };
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(
    makeRequest({ code: "code", state: "s".repeat(1_025) }),
  );

  assertEquals(
    new URL(response.headers.get("location")!).searchParams.get("error"),
    "invalid_request",
  );
  assertEquals(consumeCalls, 0);
});

Deno.test("callback-handler: rejects oversized codes before token exchange", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.setState("valid-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  });
  let fetchCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(Response.json({ access_token: "token" }));
  }) as typeof fetch;

  try {
    const handler = createOAuthCallbackHandler(TEST_CONFIG, {
      tokenStore,
      baseUrl: "http://localhost:3000",
      envReader: (key) => ENV[key],
    });
    const response = await handler(
      makeRequest({ code: "c".repeat(4_097), state: "valid-state" }),
    );
    assertEquals(
      new URL(response.headers.get("location")!).searchParams.get("error"),
      "invalid_request",
    );
    assertEquals(fetchCalls, 0);
    assertEquals((await tokenStore.consumeState("valid-state"))?.userId, "alice");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("callback-handler: rejects a state bound to a different redirect URI", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.setState("wrong-redirect", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
    redirectUri: "https://attacker.test/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  });
  let fetchCalls = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(Response.json({ access_token: "token" }));
  }) as typeof fetch;

  try {
    const handler = createOAuthCallbackHandler(TEST_CONFIG, {
      tokenStore,
      baseUrl: "http://localhost:3000",
      envReader: (key) => ENV[key],
    });
    const response = await handler(
      makeRequest({ code: "code", state: "wrong-redirect" }),
    );
    assertEquals(
      new URL(response.headers.get("location")!).searchParams.get("error"),
      "invalid_state",
    );
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("callback-handler: rejects cross-origin completion redirects", () => {
  assertThrows(
    () =>
      createOAuthCallbackHandler(TEST_CONFIG, {
        baseUrl: "https://app.test",
        successRedirect: "https://attacker.test/collect",
      }),
    Error,
    "same origin",
  );
  assertThrows(
    () =>
      createOAuthCallbackHandler(TEST_CONFIG, {
        baseUrl: "https://app.test",
        errorRedirect: "//attacker.test/collect",
      }),
    Error,
    "same origin",
  );
  assertThrows(
    () =>
      createOAuthCallbackHandler(TEST_CONFIG, {
        baseUrl: "https://app.test",
        successRedirect: "https://user:password@app.test/collect",
      }),
    Error,
    "credentials",
  );
});

Deno.test("callback-handler: redirect responses prevent caching and referrer leakage", async () => {
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore: new MemoryTokenStore(),
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(makeRequest({ code: "code" }));
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
});

Deno.test("callback-handler: detaches persisted tokens from post-commit hooks", async () => {
  const storedState: StoredOAuthState = {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  };
  let persistedTokens: OAuthTokens | null = null;
  const tokenStore: TokenStore = {
    getTokens: () => Promise.resolve(persistedTokens),
    setTokens: (_serviceId, _userId, tokens) => {
      persistedTokens = tokens;
      return Promise.resolve();
    },
    clearTokens: () => Promise.resolve(),
    setState: () => Promise.resolve(),
    consumeState: () => Promise.resolve(storedState),
  };
  const original = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.resolve(Response.json({ access_token: "provider-token" }))) as typeof fetch;

  try {
    const handler = createOAuthCallbackHandler(TEST_CONFIG, {
      tokenStore,
      baseUrl: "http://localhost:3000",
      envReader: (key) => ENV[key],
      onSuccess: (_serviceId, tokens) => {
        tokens.accessToken = "hook-mutated-token";
        throw new Error("notification failed");
      },
    });
    const response = await handler(makeRequest({ code: "code", state: "state" }));

    assertEquals(
      new URL(response.headers.get("location")!).searchParams.get("connected"),
      TEST_CONFIG.serviceId,
    );
    assertEquals((persistedTokens as OAuthTokens | null)?.accessToken, "provider-token");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("callback-handler: error hook failures do not replace the OAuth response", async () => {
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore: new MemoryTokenStore(),
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
    onError: () => {
      throw new Error("notification failed");
    },
  });

  const response = await handler(makeRequest({ code: "code" }));
  assertEquals(
    new URL(response.headers.get("location")!).searchParams.get("error"),
    "invalid_state",
  );
});
