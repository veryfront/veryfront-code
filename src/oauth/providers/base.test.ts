import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#std/assert";
import { OAuthProvider, OAuthService } from "./base.ts";
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

/** Minimal TokenStore that always returns a valid (non-expired) access token. */
function makeAuthedTokenStore(): TokenStore {
  const tokens: OAuthTokens = {
    accessToken: "test-access-token",
    refreshToken: undefined,
    tokenType: "Bearer",
    scope: "read",
    idToken: undefined,
    expiresAt: Date.now() + 60_000_000,
  };
  return {
    getTokens(): Promise<OAuthTokens | null> {
      return Promise.resolve(tokens);
    },
    setTokens(): Promise<void> {
      return Promise.resolve();
    },
    clearTokens(): Promise<void> {
      return Promise.resolve();
    },
    setState(_state: string, _meta: StoredOAuthState): Promise<void> {
      return Promise.resolve();
    },
    consumeState(): Promise<StoredOAuthState | null> {
      return Promise.resolve(null);
    },
  };
}

/**
 * Replace globalThis.fetch for the duration of `fn`. Captured calls land in
 * `captured`; the stubbed fetch always returns `{ ok: true }` JSON.
 */
async function withStubbedFetch(
  captured: string[],
  fn: () => Promise<unknown>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    captured.push(url);
    return Promise.resolve(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test("OAuthService.fetch: relative endpoint resolves against apiBaseUrl", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);
  const captured: string[] = [];

  await withStubbedFetch(captured, async () => {
    const result = await service.fetch<{ ok: boolean }>("user-1", "/v1/me");
    assertEquals(result, { ok: true });
  });

  assertEquals(captured, ["https://api.provider.test/v1/me"]);
});

Deno.test("OAuthService.fetch: absolute endpoint matching apiBaseUrl origin is allowed", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);
  const captured: string[] = [];
  const sameOrigin = "https://api.provider.test/v1/me";

  await withStubbedFetch(captured, async () => {
    const result = await service.fetch<{ ok: boolean }>("user-1", sameOrigin);
    assertEquals(result, { ok: true });
  });

  assertEquals(captured, [sameOrigin]);
});

Deno.test("OAuthService.fetch: absolute endpoint on different origin is rejected before fetch", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);
  const captured: string[] = [];
  // Classic cloud-metadata SSRF target.
  const hostileUrl = "http://169.254.169.254/latest/meta-data/";

  await withStubbedFetch(captured, async () => {
    await assertRejects(
      () => service.fetch<unknown>("user-1", hostileUrl),
      Error,
      "does not match configured",
    );
    await assertRejects(
      () => service.fetch<unknown>("user-1", "//attacker.test/collect"),
      Error,
      "endpoint path",
    );
  });

  // Critical assertion: no outbound request was issued.
  assertEquals(captured, []);
});

Deno.test("OAuthService.fetch rejects URL credentials before token lookup", async () => {
  let tokenLookups = 0;
  const store: TokenStore = {
    ...makeAuthedTokenStore(),
    getTokens: () => {
      tokenLookups++;
      return Promise.resolve({ accessToken: "access-token" });
    },
  };
  const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);

  await assertRejects(
    () => service.fetch("user-1", "https://user:password@api.provider.test/v1/me"),
    Error,
    "endpoint",
  );
  assertEquals(tokenLookups, 0);
});

/**
 * Replace globalThis.fetch for the duration of `fn` so that the provider returns
 * a non-OK response carrying `body` in its payload. SEC-010 verification.
 */
async function withErrorFetch(
  status: number,
  body: string,
  fn: () => Promise<unknown>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((): Promise<Response> => {
    return Promise.resolve(
      new Response(body, {
        status,
        headers: { "Content-Type": "text/plain" },
      }),
    );
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test(
  "OAuthService.fetch: provider error body is not leaked into thrown error (SEC-010)",
  async () => {
    const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);
    const secret = "internal-secret-error-detail-do-not-expose";

    const thrown = await assertRejects(
      () => withErrorFetch(500, secret, () => service.fetch<unknown>("user-1", "/v1/me")),
      Error,
    );

    const message = thrown instanceof Error ? thrown.message : String(thrown);
    assert(
      !message.includes(secret),
      `Thrown error must not contain raw provider body. Got: ${message}`,
    );
    // The sanitized message should still surface the HTTP status for callers.
    assert(
      message.includes("500"),
      `Thrown error should include status code. Got: ${message}`,
    );
  },
);

/**
 * Replace globalThis.fetch so the token endpoint returns `status` with `body`
 * JSON. Used to exercise exchangeCode token-validation behavior (H11/H12).
 */
async function withTokenFetch(
  status: number,
  body: unknown,
  fn: () => Promise<unknown>,
): Promise<void> {
  const original = globalThis.fetch;
  globalThis.fetch = ((): Promise<Response> => {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
}

Deno.test(
  "OAuthService.getAccessToken: concurrent expired-token reads share one refresh",
  async () => {
    let storedTokens: OAuthTokens = {
      accessToken: "expired-access-token",
      refreshToken: "rotating-refresh-token",
      tokenType: "Bearer",
      scope: "read",
      expiresAt: Date.now() - 60_000,
    };
    let setTokenCalls = 0;
    const tokenStore: TokenStore = {
      getTokens(): Promise<OAuthTokens | null> {
        return Promise.resolve(storedTokens);
      },
      setTokens(_serviceId: string, _userId: string, tokens: OAuthTokens): Promise<void> {
        setTokenCalls++;
        storedTokens = tokens;
        return Promise.resolve();
      },
      clearTokens(): Promise<void> {
        return Promise.resolve();
      },
      setState(): Promise<void> {
        return Promise.resolve();
      },
      consumeState(): Promise<StoredOAuthState | null> {
        return Promise.resolve(null);
      },
    };
    const service = new OAuthService(TEST_CONFIG, tokenStore, (k) => ENV[k]);
    const original = globalThis.fetch;
    let refreshCalls = 0;
    globalThis.fetch = ((): Promise<Response> => {
      refreshCalls++;
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            refresh_token: "rotated-refresh-token",
            token_type: "Bearer",
            scope: "read",
            expires_in: 3600,
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        ),
      );
    }) as typeof fetch;

    try {
      const [first, second] = await Promise.all([
        service.getAccessToken("user-1"),
        service.getAccessToken("user-1"),
      ]);

      assertEquals(first, "fresh-access-token");
      assertEquals(second, "fresh-access-token");
      assertEquals(refreshCalls, 1);
      assertEquals(setTokenCalls, 1);
      assertEquals(storedTokens.refreshToken, "rotated-refresh-token");
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  "OAuthService.exchangeCode: 200 with no access_token is treated as failure (H11)",
  async () => {
    const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);

    let result: Awaited<ReturnType<typeof service.exchangeCode>> | undefined;
    await withTokenFetch(200, { token_type: "Bearer" }, async () => {
      result = await service.exchangeCode({ code: "abc", redirectUri: "https://app/cb" });
    });

    assert(result, "expected a result");
    assertEquals(result!.success, false);
    // Must not surface a usable (empty) token.
    assertEquals(result!.tokens, undefined);
    assertEquals(result!.error, "invalid_token_response");
  },
);

Deno.test(
  "OAuthService.exchangeCode: 200 with empty body is treated as failure (H11)",
  async () => {
    const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);

    let result: Awaited<ReturnType<typeof service.exchangeCode>> | undefined;
    await withTokenFetch(200, {}, async () => {
      result = await service.exchangeCode({ code: "abc", redirectUri: "https://app/cb" });
    });

    assert(result, "expected a result");
    assertEquals(result!.success, false);
    assertEquals(result!.tokens, undefined);
  },
);

Deno.test(
  "OAuthService.exchangeCode: 200 with body-level ok:false/error is a failure (H12)",
  async () => {
    const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);

    let result: Awaited<ReturnType<typeof service.exchangeCode>> | undefined;
    await withTokenFetch(200, { ok: false, error: "invalid_code" }, async () => {
      result = await service.exchangeCode({ code: "bad", redirectUri: "https://app/cb" });
    });

    assert(result, "expected a result");
    assertEquals(result!.success, false);
    assertEquals(result!.error, "invalid_code");
    // No token persisted/returned.
    assertEquals(result!.tokens, undefined);
  },
);

Deno.test(
  "OAuthService.exchangeCode: 200 with a valid access_token still succeeds",
  async () => {
    const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);

    let result: Awaited<ReturnType<typeof service.exchangeCode>> | undefined;
    await withTokenFetch(
      200,
      { access_token: "real-token", token_type: "Bearer" },
      async () => {
        result = await service.exchangeCode({ code: "good", redirectUri: "https://app/cb" });
      },
    );

    assert(result, "expected a result");
    assertEquals(result!.success, true);
    assertEquals(result!.tokens?.accessToken, "real-token");
  },
);

Deno.test("OAuthProvider omits absent optional token fields", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  let result: Awaited<ReturnType<typeof service.exchangeCode>> | undefined;
  await withTokenFetch(200, { access_token: "real-token" }, async () => {
    result = await service.exchangeCode({ code: "good", redirectUri: "https://app.test/cb" });
  });

  assertEquals(result, {
    success: true,
    tokens: { accessToken: "real-token" },
  });
});

Deno.test("OAuthProvider preserves a refresh token when rotation returns a blank value", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  let result: Awaited<ReturnType<typeof service.refreshTokens>> | undefined;
  await withTokenFetch(
    200,
    { access_token: "real-token", refresh_token: "  " },
    async () => {
      result = await service.refreshTokens("existing-refresh-token");
    },
  );

  assertEquals(result?.tokens?.refreshToken, "existing-refresh-token");
});

Deno.test(
  "OAuthService.fetch: provider error body is not leaked into logs (SEC-010)",
  async () => {
    const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);
    const secret = "internal-secret-error-detail-do-not-log";
    const originalError = console.error;
    const messages: string[] = [];

    console.error = (...args: unknown[]) => {
      messages.push(args.map((arg) => String(arg)).join(" "));
    };

    try {
      await assertRejects(
        () => withErrorFetch(502, secret, () => service.fetch<unknown>("user-1", "/v1/me")),
        Error,
      );
    } finally {
      console.error = originalError;
    }

    const logOutput = messages.join("\n");
    assert(logOutput.includes("OAuth provider API error"));
    assert(logOutput.includes("502"));
    assert(
      !logOutput.includes(secret),
      `Log output must not contain raw provider body. Got: ${logOutput}`,
    );
  },
);

Deno.test(
  "OAuthService.getAccessToken: separate service instances share refresh by token store",
  async () => {
    const expired: OAuthTokens = {
      accessToken: "old-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      scope: "read",
      idToken: undefined,
      expiresAt: Date.now() - 1_000,
    };
    let setCount = 0;
    const store: TokenStore = {
      getTokens: () => Promise.resolve(expired),
      setTokens: () => {
        setCount++;
        return Promise.resolve();
      },
      clearTokens: () => Promise.resolve(),
      setState: () => Promise.resolve(),
      consumeState: () => Promise.resolve(null),
    };
    const firstService = new OAuthService(TEST_CONFIG, store, (k) => ENV[k]);
    const secondService = new OAuthService(TEST_CONFIG, store, (k) => ENV[k]);

    const original = globalThis.fetch;
    let tokenCalls = 0;
    globalThis.fetch = ((input: string | URL | Request): Promise<Response> => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;
      if (url === TEST_CONFIG.tokenUrl) tokenCalls++;
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "new-token", token_type: "Bearer" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    try {
      const [first, second] = await Promise.all([
        firstService.getAccessToken("user-concurrent"),
        secondService.getAccessToken("user-concurrent"),
      ]);
      assertEquals(first, "new-token");
      assertEquals(second, "new-token");
      assertEquals(tokenCalls, 1);
      assertEquals(setCount, 1);
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  "OAuthService.getAccessToken: separate token stores do not share refresh promises",
  async () => {
    function makeExpiredStore(refreshToken: string): TokenStore {
      const expired: OAuthTokens = {
        accessToken: `old-${refreshToken}`,
        refreshToken,
        tokenType: "Bearer",
        scope: "read",
        idToken: undefined,
        expiresAt: Date.now() - 1_000,
      };
      return {
        getTokens: () => Promise.resolve(expired),
        setTokens: () => Promise.resolve(),
        clearTokens: () => Promise.resolve(),
        setState: () => Promise.resolve(),
        consumeState: () => Promise.resolve(null),
      };
    }

    const firstService = new OAuthService(
      TEST_CONFIG,
      makeExpiredStore("refresh-a"),
      (k) => ENV[k],
    );
    const secondService = new OAuthService(
      TEST_CONFIG,
      makeExpiredStore("refresh-b"),
      (k) => ENV[k],
    );

    const original = globalThis.fetch;
    const refreshBodies: string[] = [];
    globalThis.fetch = ((
      _input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      refreshBodies.push(String(init?.body ?? ""));
      return Promise.resolve(
        new Response(JSON.stringify({ access_token: "new-token", token_type: "Bearer" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }) as typeof fetch;

    try {
      await Promise.all([
        firstService.getAccessToken("same-user"),
        secondService.getAccessToken("same-user"),
      ]);
      assertEquals(refreshBodies.length, 2);
      assertEquals(refreshBodies.some((body) => body.includes("refresh-a")), true);
      assertEquals(refreshBodies.some((body) => body.includes("refresh-b")), true);
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  "OAuthProvider.createAuthorizationUrl keeps protocol parameters authoritative",
  async () => {
    const config: OAuthServiceConfig = {
      ...TEST_CONFIG,
      authorizationUrl: `${TEST_CONFIG.authorizationUrl}?tenant=kept`,
    };
    const service = new OAuthService(config, makeAuthedTokenStore(), (key) => ENV[key]);

    const { url, state } = await service.createAuthorizationUrl({
      redirectUri: "https://app.test/oauth/callback",
      state: "trusted-state",
      additionalParams: {
        client_id: "attacker-client",
        redirect_uri: "https://attacker.test/callback",
        response_type: "token",
        state: "attacker-state",
        scope: "admin",
        code_challenge: "attacker-challenge",
        code_challenge_method: "plain",
      },
    });

    const authorizationUrl = new URL(url);
    assertEquals(authorizationUrl.searchParams.get("tenant"), "kept");
    assertEquals(authorizationUrl.searchParams.get("client_id"), "test-id");
    assertEquals(
      authorizationUrl.searchParams.get("redirect_uri"),
      "https://app.test/oauth/callback",
    );
    assertEquals(authorizationUrl.searchParams.get("response_type"), "code");
    assertEquals(authorizationUrl.searchParams.get("state"), "trusted-state");
    assertEquals(authorizationUrl.searchParams.get("scope"), "read");
    assertEquals(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert(
      authorizationUrl.searchParams.get("code_challenge") !== "attacker-challenge",
    );
    assertEquals(state.state, "trusted-state");
  },
);

Deno.test("OAuthProvider uses form-encoded UTF-8 credentials for Basic auth", async () => {
  const config: OAuthServiceConfig = {
    ...TEST_CONFIG,
    useBasicAuth: true,
  };
  const credentials: Record<string, string> = {
    TEST_CLIENT_ID: "client:id",
    TEST_CLIENT_SECRET: "sëcret value",
  };
  const provider = new OAuthProvider(config, (key) => credentials[key]);
  const original = globalThis.fetch;
  let authorization = "";
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return Promise.resolve(
      new Response(JSON.stringify({ access_token: "access-token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof fetch;

  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/oauth/callback",
    });
    assertEquals(result.success, true);

    const encodedId = new URLSearchParams({ value: credentials.TEST_CLIENT_ID })
      .toString().slice("value=".length);
    const encodedSecret = new URLSearchParams({ value: credentials.TEST_CLIENT_SECRET })
      .toString().slice("value=".length);
    const bytes = new TextEncoder().encode(`${encodedId}:${encodedSecret}`);
    const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
    assertEquals(authorization, `Basic ${btoa(binary)}`);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthService.fetch preserves Headers input and owns authorization", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  const original = globalThis.fetch;
  let capturedHeaders = new Headers();
  let capturedUrl = "";
  let capturedRedirect: RequestRedirect | undefined;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = typeof input === "string"
      ? input
      : input instanceof URL
      ? input.toString()
      : input.url;
    capturedHeaders = new Headers(init?.headers);
    capturedRedirect = init?.redirect;
    return Promise.resolve(
      Response.json({ ok: true }),
    );
  }) as typeof fetch;

  try {
    await service.fetch("user-1", "v1/me", {
      redirect: "follow",
      headers: new Headers({
        Authorization: "Bearer caller-controlled",
        "X-Custom": "preserved",
      }),
    });
    assertEquals(capturedUrl, "https://api.provider.test/v1/me");
    assertEquals(capturedHeaders.get("x-custom"), "preserved");
    assertEquals(capturedHeaders.get("authorization"), "Bearer test-access-token");
    assertEquals(capturedRedirect, "error");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthService refresh cannot resurrect tokens cleared while refresh is running", async () => {
  let storedTokens: OAuthTokens | null = {
    accessToken: "expired-access-token",
    refreshToken: "refresh-token",
    expiresAt: Date.now() - 1_000,
  };
  const store: TokenStore = {
    getTokens: () => Promise.resolve(storedTokens),
    setTokens: (_serviceId, _userId, tokens) => {
      storedTokens = tokens;
      return Promise.resolve();
    },
    clearTokens: () => {
      storedTokens = null;
      return Promise.resolve();
    },
    setState: () => Promise.resolve(),
    consumeState: () => Promise.resolve(null),
  };
  const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);
  const original = globalThis.fetch;
  let signalRefreshStarted!: () => void;
  const refreshStarted = new Promise<void>((resolve) => {
    signalRefreshStarted = resolve;
  });
  let finishRefresh!: () => void;
  globalThis.fetch = (() => {
    signalRefreshStarted();
    return new Promise<Response>((resolve) => {
      finishRefresh = () =>
        resolve(
          Response.json({
            access_token: "refreshed-access-token",
            refresh_token: "rotated-refresh-token",
          }),
        );
    });
  }) as typeof fetch;

  try {
    const accessToken = service.getAccessToken("user-1");
    await refreshStarted;
    await store.clearTokens(TEST_CONFIG.serviceId, "user-1");
    finishRefresh();

    assertEquals(await accessToken, null);
    assertEquals(storedTokens, null);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider rejects non-HTTP provider endpoints at construction", () => {
  const insecureConfig: OAuthServiceConfig = {
    ...TEST_CONFIG,
    tokenUrl: "file:///tmp/token",
  };
  assertThrows(
    () => new OAuthProvider(insecureConfig, (key) => ENV[key]),
    Error,
    "tokenUrl",
  );
});

Deno.test("OAuthProvider requires TLS for non-loopback provider endpoints", () => {
  assertThrows(
    () =>
      new OAuthProvider(
        { ...TEST_CONFIG, tokenUrl: "http://provider.test/token" },
        (key) => ENV[key],
      ),
    Error,
    "tokenUrl",
  );

  const loopback = new OAuthProvider(
    {
      ...TEST_CONFIG,
      authorizationUrl: "http://localhost:9000/authorize",
      tokenUrl: "http://127.0.0.1:9000/token",
    },
    (key) => ENV[key],
  );
  assertEquals(loopback.isConfigured(), true);
});

Deno.test("OAuthProvider validates runtime provider identity and service metadata", () => {
  for (
    const config of [
      { ...TEST_CONFIG, providerId: " " },
      { ...TEST_CONFIG, displayName: "" },
      { ...TEST_CONFIG, clientIdEnvVar: "invalid env" },
      { ...TEST_CONFIG, tokenRequestFormat: "xml" },
    ]
  ) {
    assertThrows(
      () => new OAuthProvider(config as OAuthServiceConfig, (key) => ENV[key]),
      Error,
      "OAuth",
    );
  }
  assertThrows(
    () =>
      new OAuthService(
        { ...TEST_CONFIG, defaultScopes: ["read", "read"] },
        makeAuthedTokenStore(),
        (key) => ENV[key],
      ),
    Error,
    "defaultScopes",
  );
});

Deno.test("OAuthProvider bounds and classifies malformed token responses", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response("<html>not a token response</html>", {
        status: 200,
        headers: { "Content-Type": "text/html" },
      }),
    )) as typeof fetch;
  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/oauth/callback",
    });
    assertEquals(result, { success: false, error: "invalid_token_response" });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider rejects oversized token responses", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  const original = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      Response.json({ access_token: "x".repeat(1_100_000) }),
    )) as typeof fetch;
  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/oauth/callback",
    });
    assertEquals(result, { success: false, error: "invalid_token_response" });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider applies a timeout signal and disables token redirects", async () => {
  const provider = new OAuthProvider(
    TEST_CONFIG,
    (key) => key === "VF_HTTP_FETCH_TIMEOUT" ? "25" : ENV[key],
  );
  const original = globalThis.fetch;
  let capturedSignal: AbortSignal | null | undefined;
  let capturedRedirect: RequestRedirect | undefined;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedSignal = init?.signal;
    capturedRedirect = init?.redirect;
    return Promise.resolve(Response.json({ access_token: "access-token" }));
  }) as typeof fetch;
  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/oauth/callback",
    });
    assertEquals(result.success, true);
    assert(capturedSignal instanceof AbortSignal);
    assertEquals(capturedRedirect, "error");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider does not expose transport error detail", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.reject(new Error("private-network-detail"))) as typeof fetch;
  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/oauth/callback",
    });
    assertEquals(result.success, false);
    assertEquals(result.error, "network_error");
    assertEquals(result.errorDescription, "OAuth provider request failed");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider preserves zero expiry and rejects negative expiry", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  let result: Awaited<ReturnType<typeof provider.exchangeCode>> | undefined;
  const before = Date.now();
  await withTokenFetch(200, { access_token: "token", expires_in: 0 }, async () => {
    result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/oauth/callback",
    });
  });
  assertEquals(result?.success, true);
  assert((result?.tokens?.expiresAt ?? -1) >= before);

  await withTokenFetch(200, { access_token: "token", expires_in: -1 }, async () => {
    result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/oauth/callback",
    });
  });
  assertEquals(result, { success: false, error: "invalid_token_response" });
});

Deno.test("OAuthProvider rejects unbounded authorization and exchange inputs", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  await assertRejects(
    () =>
      provider.createAuthorizationUrl({
        state: "x".repeat(5_000),
        redirectUri: "https://app.test/oauth/callback",
      }),
    Error,
    "state",
  );

  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (() => {
    calls++;
    return Promise.resolve(Response.json({ access_token: "token" }));
  }) as typeof fetch;
  try {
    const result = await provider.exchangeCode({
      code: "x".repeat(20_000),
      redirectUri: "https://app.test/oauth/callback",
    });
    assertEquals(result, { success: false, error: "invalid_request" });
    assertEquals(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider rejects blank or unbounded client credentials", async () => {
  const blank = new OAuthProvider(
    TEST_CONFIG,
    (key) => key === TEST_CONFIG.clientIdEnvVar ? "   " : ENV[key],
  );
  const oversized = new OAuthProvider(
    TEST_CONFIG,
    (key) => key === TEST_CONFIG.clientSecretEnvVar ? "x".repeat(70_000) : ENV[key],
  );

  assertEquals(blank.isConfigured(), false);
  assertEquals(oversized.isConfigured(), false);
  await assertRejects(
    () =>
      blank.createAuthorizationUrl({
        redirectUri: "https://app.test/oauth/callback",
      }),
    Error,
    "not configured",
  );
});

Deno.test("OAuthProvider keeps token-request protocol parameters authoritative", async () => {
  const config: OAuthServiceConfig = {
    ...TEST_CONFIG,
    additionalTokenParams: {
      grant_type: "attacker-grant",
      code: "attacker-code",
      redirect_uri: "https://attacker.test/callback",
      code_verifier: "a".repeat(43),
      refresh_token: "attacker-refresh",
      client_id: "attacker-client",
      client_secret: "attacker-secret",
      audience: "preserved-audience",
    },
  };
  const provider = new OAuthProvider(config, (key) => ENV[key]);
  const original = globalThis.fetch;
  const requestBodies: URLSearchParams[] = [];
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    requestBodies.push(new URLSearchParams(String(init?.body ?? "")));
    return Promise.resolve(Response.json({ access_token: "access-token" }));
  }) as typeof fetch;

  try {
    await provider.exchangeCode({
      code: "trusted-code",
      redirectUri: "https://app.test/oauth/callback",
    });
    await provider.refreshTokens("trusted-refresh");
  } finally {
    globalThis.fetch = original;
  }

  assertEquals(requestBodies.length, 2);
  assertEquals(requestBodies[0].get("grant_type"), "authorization_code");
  assertEquals(requestBodies[0].get("code"), "trusted-code");
  assertEquals(requestBodies[0].get("redirect_uri"), "https://app.test/oauth/callback");
  assertEquals(requestBodies[0].has("code_verifier"), false);
  assertEquals(requestBodies[0].has("refresh_token"), false);
  assertEquals(requestBodies[0].get("client_id"), ENV.TEST_CLIENT_ID);
  assertEquals(requestBodies[0].get("client_secret"), ENV.TEST_CLIENT_SECRET);
  assertEquals(requestBodies[0].get("audience"), "preserved-audience");

  assertEquals(requestBodies[1].get("grant_type"), "refresh_token");
  assertEquals(requestBodies[1].get("refresh_token"), "trusted-refresh");
  assertEquals(requestBodies[1].has("code"), false);
  assertEquals(requestBodies[1].has("redirect_uri"), false);
  assertEquals(requestBodies[1].has("code_verifier"), false);
  assertEquals(requestBodies[1].get("client_id"), ENV.TEST_CLIENT_ID);
  assertEquals(requestBodies[1].get("client_secret"), ENV.TEST_CLIENT_SECRET);
  assertEquals(requestBodies[1].get("audience"), "preserved-audience");
});

Deno.test("OAuthService snapshots mutable provider configuration", async () => {
  const config: OAuthServiceConfig = {
    ...TEST_CONFIG,
    defaultScopes: [...TEST_CONFIG.defaultScopes],
    additionalTokenParams: { audience: "original-audience" },
  };
  const service = new OAuthService(config, makeAuthedTokenStore(), (key) => ENV[key]);

  config.authorizationUrl = "https://attacker.test/authorize";
  config.tokenUrl = "https://attacker.test/token";
  config.apiBaseUrl = "https://attacker.test/api";
  config.defaultScopes[0] = "admin";
  config.additionalTokenParams!.audience = "attacker-audience";

  const authorization = await service.createAuthorizationUrl({
    redirectUri: "https://app.test/oauth/callback",
  });
  assertEquals(new URL(authorization.url).origin, "https://provider.test");
  assertEquals(new URL(authorization.url).searchParams.get("scope"), "read");

  const original = globalThis.fetch;
  let tokenUrl = "";
  let tokenBody = new URLSearchParams();
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    tokenUrl = String(input);
    tokenBody = new URLSearchParams(String(init?.body ?? ""));
    return Promise.resolve(Response.json({ access_token: "access-token" }));
  }) as typeof fetch;
  try {
    await service.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/oauth/callback",
    });
  } finally {
    globalThis.fetch = original;
  }

  assertEquals(tokenUrl, TEST_CONFIG.tokenUrl);
  assertEquals(tokenBody.get("audience"), "original-audience");
  assertEquals(service.apiBaseUrl, TEST_CONFIG.apiBaseUrl);
});

Deno.test("OAuthService treats expiresAt zero as expired", async () => {
  let storedTokens: OAuthTokens = {
    accessToken: "expired-access-token",
    refreshToken: "refresh-token",
    expiresAt: 0,
  };
  const store: TokenStore = {
    getTokens: () => Promise.resolve(storedTokens),
    setTokens: (_serviceId, _userId, tokens) => {
      storedTokens = tokens;
      return Promise.resolve();
    },
    clearTokens: () => Promise.resolve(),
    setState: () => Promise.resolve(),
    consumeState: () => Promise.resolve(null),
  };
  const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);
  const original = globalThis.fetch;
  let refreshCalls = 0;
  globalThis.fetch = (() => {
    refreshCalls++;
    return Promise.resolve(Response.json({ access_token: "fresh-access-token" }));
  }) as typeof fetch;
  try {
    assertEquals(await service.getAccessToken("user-1"), "fresh-access-token");
    assertEquals(refreshCalls, 1);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthService does not expire unrefreshable tokens at the refresh buffer", async () => {
  let storedTokens: OAuthTokens = {
    accessToken: "still-valid-token",
    expiresAt: Date.now() + 60_000,
  };
  const store: TokenStore = {
    getTokens: () => Promise.resolve(storedTokens),
    setTokens: () => Promise.resolve(),
    clearTokens: () => Promise.resolve(),
    setState: () => Promise.resolve(),
    consumeState: () => Promise.resolve(null),
  };
  const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);

  assertEquals(await service.getAccessToken("user-1"), "still-valid-token");
  storedTokens = { accessToken: "expired-token", expiresAt: Date.now() - 1 };
  assertEquals(await service.getAccessToken("user-1"), null);
});

Deno.test("OAuthService rejects malformed tokens returned by a custom store", async () => {
  const store: TokenStore = {
    getTokens: () => Promise.resolve({ accessToken: " " }),
    setTokens: () => Promise.resolve(),
    clearTokens: () => Promise.resolve(),
    setState: () => Promise.resolve(),
    consumeState: () => Promise.resolve(null),
  };
  const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);

  await assertRejects(
    () => service.getAccessToken("user-1"),
    Error,
    "Stored OAuth tokens are invalid",
  );
});

Deno.test("OAuthService bounds provider API JSON responses", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  const original = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.resolve(Response.json({ value: "x".repeat(2_048) }))) as typeof fetch;
  try {
    await assertRejects(
      () => service.fetch("user-1", "/v1/me", { maxResponseBytes: 128 }),
      Error,
      "response",
    );
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider serializes configured JSON token requests", async () => {
  const provider = new OAuthProvider(
    { ...TEST_CONFIG, tokenRequestFormat: "json", useBasicAuth: true },
    (key) => ENV[key],
  );
  const original = globalThis.fetch;
  let contentType = "";
  let requestBody: unknown;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    contentType = new Headers(init?.headers).get("content-type") ?? "";
    requestBody = JSON.parse(String(init?.body));
    return Promise.resolve(Response.json({ access_token: "access-token" }));
  }) as typeof fetch;

  try {
    const result = await provider.exchangeCode({
      code: "trusted-code",
      redirectUri: "https://app.test/oauth/callback",
    });
    assertEquals(result.success, true);
  } finally {
    globalThis.fetch = original;
  }

  assertEquals(contentType, "application/json");
  assertEquals(requestBody, {
    grant_type: "authorization_code",
    code: "trusted-code",
    redirect_uri: "https://app.test/oauth/callback",
  });
});
