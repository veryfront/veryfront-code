import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotEquals, assertThrows } from "#std/assert";
import { createOAuthCallbackHandler } from "./callback-handler.ts";
import { MemoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig, StoredOAuthState, TokenStore } from "../types.ts";

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

Deno.test("callback-handler: rejects stale state returned by a custom store", async () => {
  const staleState: StoredOAuthState = {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    createdAt: Date.now() - 11 * 60 * 1_000,
  };
  const tokenStore: TokenStore = {
    getTokens: () => Promise.resolve(null),
    setTokens: () => Promise.resolve(),
    clearTokens: () => Promise.resolve(),
    setState: () => Promise.resolve(),
    consumeState: () => Promise.resolve(staleState),
  };
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    envReader: (key) => ENV[key],
  });

  const response = await handler(makeRequest({ code: "code", state: "stale-state" }));

  assertEquals(
    new URL(response.headers.get("location")!).searchParams.get("error"),
    "invalid_state",
  );
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

Deno.test("callback-handler: never bypasses missing state validation", async () => {
  const tokenStore = new MemoryTokenStore();

  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://localhost:3000",
    skipStateValidation: true,
    envReader: (key) => ENV[key],
  });

  const response = await handler(makeRequest({ code: "auth-code-123" }));

  assertEquals(response.status, 302);
  const location = new URL(response.headers.get("location")!);
  assertEquals(location.searchParams.get("error"), "invalid_state");
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

Deno.test("callback-handler: stores tokens keyed by (serviceId, userId), bob's slot untouched", async () => {
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

Deno.test("callback-handler: exchanges a code with the redirect URI bound to state", async () => {
  const tokenStore = new MemoryTokenStore();
  const storedRedirectUri = "https://original-app.test/custom/oauth/callback";
  await tokenStore.setState("bound-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    redirectUri: storedRedirectUri,
    scopes: ["read"],
    createdAt: Date.now(),
  });

  const original = globalThis.fetch;
  let tokenRequestBody = "";
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    tokenRequestBody = String(init?.body ?? "");
    return Promise.resolve(Response.json({ access_token: "access-token" }));
  }) as typeof fetch;

  try {
    const handler = createOAuthCallbackHandler(TEST_CONFIG, {
      tokenStore,
      baseUrl: "https://current-app.test",
      envReader: (key) => ENV[key],
    });
    const response = await handler(
      makeRequest({ code: "auth-code", state: "bound-state" }),
    );

    assertEquals(response.status, 302);
    assertEquals(
      new URLSearchParams(tokenRequestBody).get("redirect_uri"),
      storedRedirectUri,
    );
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("callback-handler: validates state before reflecting provider errors", async () => {
  const tokenStore = new MemoryTokenStore();
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "https://app.test",
    envReader: (key) => ENV[key],
  });

  const forged = await handler(makeRequest({
    error: "access_denied",
    error_description: "provider detail",
    state: "forged-state",
  }));

  assertEquals(
    new URL(forged.headers.get("location")!).searchParams.get("error"),
    "invalid_state",
  );

  await tokenStore.setState("valid-error-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    createdAt: Date.now(),
  });
  const denied = await handler(makeRequest({
    error: "access_denied",
    state: "valid-error-state",
  }));
  assertEquals(
    new URL(denied.headers.get("location")!).searchParams.get("error"),
    "access_denied",
  );
  assertEquals(await tokenStore.consumeState("valid-error-state"), null);
});

Deno.test("callback-handler: rejects cross-origin application redirects", () => {
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
        successRedirect: "https://oauth-redirect.invalid/collect",
      }),
    Error,
    "same origin",
  );
});

Deno.test("callback-handler: requires TLS for non-loopback application URLs", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.setState("tls-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    createdAt: Date.now(),
  });
  const handler = createOAuthCallbackHandler(TEST_CONFIG, {
    tokenStore,
    baseUrl: "http://app.test",
    envReader: (key) => ENV[key],
  });

  const response = await handler(makeRequest({ code: "code", state: "tls-state" }));

  assertEquals(response.status, 500);
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertNotEquals(await tokenStore.consumeState("tls-state"), null);
});

Deno.test("callback-handler: does not log raw provider error descriptions", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.setState("error-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    createdAt: Date.now(),
  });
  const originalError = console.error;
  const logs: string[] = [];
  console.error = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    const handler = createOAuthCallbackHandler(TEST_CONFIG, {
      tokenStore,
      baseUrl: "https://app.test",
    });
    const response = await handler(makeRequest({
      error: "access_denied",
      error_description: "private-provider-detail",
      state: "error-state",
    }));
    assertEquals(response.status, 302);
    assertEquals(response.headers.get("cache-control"), "no-store");
  } finally {
    console.error = originalError;
  }
  assertEquals(logs.join("\n").includes("private-provider-detail"), false);
});

Deno.test("callback-handler: rejects oversized callback parameters before outbound work", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.setState("valid-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    createdAt: Date.now(),
  });
  const original = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(Response.json({ access_token: "token" }));
  }) as typeof fetch;
  try {
    const handler = createOAuthCallbackHandler(TEST_CONFIG, {
      tokenStore,
      baseUrl: "https://app.test",
      envReader: (key) => ENV[key],
    });
    const oversizedCode = await handler(
      makeRequest({ code: "x".repeat(20_000), state: "valid-state" }),
    );
    assertEquals(
      new URL(oversizedCode.headers.get("location")!).searchParams.get("error"),
      "invalid_request",
    );
    assertEquals(fetchCalls, 0);

    const oversizedState = await handler(
      makeRequest({ code: "code", state: "x".repeat(5_000) }),
    );
    assertEquals(
      new URL(oversizedState.headers.get("location")!).searchParams.get("error"),
      "invalid_state",
    );
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("callback-handler: normalizes token endpoint error codes", async () => {
  const tokenStore = new MemoryTokenStore();
  await tokenStore.setState("token-error-state", {
    userId: "alice",
    serviceId: TEST_CONFIG.serviceId,
    redirectUri: "http://localhost:3000/api/auth/test-provider/callback",
    createdAt: Date.now(),
  });
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({ error: "unsafe error?private=value", error_description: "private-value" }, {
        status: 400,
      }),
    )) as typeof fetch;
  try {
    const handler = createOAuthCallbackHandler(TEST_CONFIG, {
      tokenStore,
      baseUrl: "http://localhost:3000",
      envReader: (key) => ENV[key],
    });
    const response = await handler(makeRequest({ code: "code", state: "token-error-state" }));
    const location = new URL(response.headers.get("location")!);

    assertEquals(location.searchParams.get("error"), "provider_error");
    assertEquals(location.toString().includes("private-value"), false);
  } finally {
    globalThis.fetch = original;
  }
});
