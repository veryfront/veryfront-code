import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#std/assert";
import { OAuthService } from "./base.ts";
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
  });

  // Critical assertion: no outbound request was issued.
  assertEquals(captured, []);
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
