import "#veryfront/schemas/_test-setup.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { FakeTime } from "#std/testing/time";
import { createTestEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  createOAuthCallbackHandler as createRuntimeOAuthCallbackHandler,
  type OAuthCallbackHandlerOptions,
} from "./callback-handler.ts";
import { MemoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig, OAuthTokens, StoredOAuthState, TokenStore } from "../types.ts";

const TEST_PUBLIC_PROVIDER_ORIGIN = "https://93.184.216.34";
const TEST_CONFIG: OAuthServiceConfig = {
  providerId: "test-provider",
  serviceId: "test-provider",
  displayName: "Test Provider",
  clientIdEnvVar: "TEST_CLIENT_ID",
  clientSecretEnvVar: "TEST_CLIENT_SECRET",
  authorizationUrl: `${TEST_PUBLIC_PROVIDER_ORIGIN}/provider/auth`,
  tokenUrl: `${TEST_PUBLIC_PROVIDER_ORIGIN}/provider/token`,
  defaultScopes: ["read"],
  apiBaseUrl: `${TEST_PUBLIC_PROVIDER_ORIGIN}/provider/api`,
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

async function withTokenExchange<T>(
  response: () => Response,
  operation: () => Promise<T>,
): Promise<T> {
  return await withMockFetch(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    assertEquals(request.url, TEST_CONFIG.tokenUrl);
    assertEquals(request.method, "POST");
    return response();
  }, operation);
}

function tokenExchangeError(): Response {
  return Response.json({ error: "invalid_grant" }, { status: 400 });
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

it("callback-handler rejects non-GET requests before consuming state", async () => {
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

it("callback-handler: rejects request when state parameter is missing", async () => {
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

it("callback-handler: rejects request when state is unknown (forged)", async () => {
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

it("callback-handler: rejects request when state serviceId does not match", async () => {
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

it("callback-handler: rejects request when state has expired", async () => {
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

it("callback-handler: rejects state that expired inside the token store", async () => {
  using time = new FakeTime();
  const tokenStore = new MemoryTokenStore();
  await tokenStore.setState("expired-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  });
  // The user takes 11 minutes to complete consent, past the 10-minute window.
  await time.tickAsync(11 * 60 * 1000);

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

it("callback-handler: rejects stored state without a valid PKCE verifier", async () => {
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

it("callback-handler rejects legacy state rows without transaction bindings", async () => {
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

it("callback-handler accepts verifier-free state for a provider without PKCE", async () => {
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

  const response = await withTokenExchange(
    tokenExchangeError,
    () =>
      handler(
        makeRequest({ code: "auth-code-123", state: "verifier-free-state" }),
      ),
  );

  assertNotEquals(
    new URL(response.headers.get("location")!).searchParams.get("error"),
    "invalid_state",
  );
});

it("callback-handler: consumes state once (double-use rejected)", async () => {
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

  const response = await withTokenExchange(tokenExchangeError, async () => {
    // First call consumes state.
    await handler(makeRequest({ code: "auth-code-123", state: "valid-state" }));

    // A second call with the same state fails before another token exchange.
    return await handler(
      makeRequest({ code: "auth-code-456", state: "valid-state" }),
    );
  });

  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assertEquals(location.searchParams.get("error"), "invalid_state");
});

it("callback-handler: rejects the unsafe state-validation bypass", () => {
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

it("callback-handler: calls onError with invalid_state when state is missing", async () => {
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

it("callback-handler: proceeds with valid state matching serviceId", async () => {
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

  const response = await withTokenExchange(
    tokenExchangeError,
    () =>
      handler(
        makeRequest({ code: "auth-code-123", state: "valid-state-abc" }),
      ),
  );

  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  // Should NOT be invalid_state - it proceeds to token exchange
  const error = location.searchParams.get("error");
  if (error) {
    assertNotEquals(error, "invalid_state");
  }
});

it("callback-handler: stores tokens keyed by (serviceId, userId) — bob's slot untouched", async () => {
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

  // Captured inside the mock but asserted after it resolves: a throw inside the
  // fetch mock is swallowed by the handler and surfaces as a callback_error redirect.
  const exchange: { url?: string; method?: string; body?: URLSearchParams } = {};

  await withMockFetch(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    exchange.url = request.url;
    exchange.method = request.method;
    exchange.body = new URLSearchParams(await request.text());
    return Response.json({
      access_token: "alice-access-token",
      refresh_token: "alice-refresh-token",
      expires_in: 3600,
      token_type: "Bearer",
      scope: "read",
    });
  }, async () => {
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
  });

  assertEquals(exchange.url, TEST_CONFIG.tokenUrl, "the exchange must target the token URL");
  assertEquals(exchange.method, "POST", "the exchange must be a POST");
  assertEquals(
    exchange.body?.get("code_verifier"),
    CODE_VERIFIER,
    "exchange must carry the consumed state's PKCE verifier",
  );
  assertEquals(
    exchange.body?.get("code"),
    "auth-code-abc",
    "exchange must redeem the callback code",
  );
  assertEquals(
    exchange.body?.get("redirect_uri"),
    "http://localhost:3000/api/auth/test-provider/callback",
    "exchange must reuse the state's redirect URI",
  );
});

it("callback-handler: validates and consumes state before handling provider errors", async () => {
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

it("callback-handler: rejects duplicate security-sensitive query parameters", async () => {
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

it("callback-handler: rejects oversized state before touching the store", async () => {
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

it("callback-handler: rejects oversized codes before token exchange", async () => {
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

it("callback-handler: rejects a state bound to a different redirect URI", async () => {
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

it("callback-handler: rejects cross-origin completion redirects", () => {
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
  assertThrows(
    () =>
      createOAuthCallbackHandler(TEST_CONFIG, {
        baseUrl: "https://app.test",
        successRedirect: "/account\\settings",
      }),
    Error,
    "raw controls or backslashes",
  );
});

it("callback-handler: redirect responses prevent caching and referrer leakage", async () => {
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore: new MemoryTokenStore(),
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(makeRequest({ code: "code" }));
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
});

it("callback-handler: success redirects prevent caching and referrer leakage", async () => {
  const storedState: StoredOAuthState = {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    createdAt: Date.now(),
  };
  const tokenStore = createConsumedStateStore(storedState);

  await withTokenExchange(
    () => Response.json({ access_token: "provider-token" }),
    async () => {
      const handler = createOAuthCallbackHandler(TEST_CONFIG, {
        tokenStore,
        baseUrl: "http://localhost:3000",
        envReader: (key) => ENV[key],
      });
      const response = await handler(makeRequest({ code: "code", state: "state" }));

      assertEquals(response.status, 302, "a completed connection must redirect");
      assertEquals(
        new URL(response.headers.get("location")!).searchParams.get("connected"),
        TEST_CONFIG.serviceId,
        "the success redirect must report the connected service",
      );
      assertEquals(
        response.headers.get("cache-control"),
        "no-store",
        "the success redirect must not be cached",
      );
      assertEquals(
        response.headers.get("referrer-policy"),
        "no-referrer",
        "the success redirect must not leak the authorization code through the referrer",
      );
    },
  );
});

it("callback-handler: detaches persisted tokens from post-commit hooks", async () => {
  const storedState: StoredOAuthState = {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    codeVerifier: CODE_VERIFIER,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    scopes: ["read"],
    scopeSource: "explicit",
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
  await withTokenExchange(
    () => Response.json({ access_token: "provider-token" }),
    async () => {
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
      assertEquals((persistedTokens as OAuthTokens | null)?.scopeSource, "explicit");
      assertEquals(
        (persistedTokens as (OAuthTokens & { requestedScope?: string }) | null)?.requestedScope,
        "read",
      );
    },
  );
});

it("callback-handler: rejects a superseded broad grant returned for a narrow request", async () => {
  const narrowedScopes = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.file",
  ];
  const config: OAuthServiceConfig = {
    ...TEST_CONFIG,
    serviceId: "drive",
    defaultScopes: narrowedScopes,
  };
  const storedState: StoredOAuthState = {
    userId: "alice",
    serviceId: "drive",
    codeVerifier: CODE_VERIFIER,
    redirectUri: "http://localhost:3000/api/auth/drive/callback",
    scopes: narrowedScopes,
    scopeSource: "explicit",
    createdAt: Date.now(),
  };
  let setTokenCalls = 0;
  const tokenStore: TokenStore = {
    getTokens: () => Promise.resolve(null),
    setTokens: () => {
      setTokenCalls += 1;
      return Promise.resolve();
    },
    clearTokens: () => Promise.resolve(),
    setState: () => Promise.resolve(),
    consumeState: () => Promise.resolve(storedState),
  };

  await withTokenExchange(
    () =>
      Response.json({
        access_token: "provider-token",
        scope: "https://www.googleapis.com/auth/drive",
      }),
    async () => {
      const handler = createOAuthCallbackHandler(config, {
        tokenStore,
        baseUrl: APP_URL,
        envReader: (key) => ENV[key],
      });
      const response = await handler(makeRequest({ code: "code", state: "state" }));

      assertEquals(
        new URL(response.headers.get("location")!).searchParams.get("error"),
        "scope_mismatch",
      );
      assertEquals(setTokenCalls, 0);
    },
  );
});

it("callback-handler: error hook failures do not replace the OAuth response", async () => {
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
