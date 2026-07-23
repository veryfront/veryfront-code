import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertNotEquals, assertRejects, assertThrows } from "#std/assert";
import { OAuthProvider, OAuthService } from "./base.ts";
import type {
  AuthorizationUrlOptions,
  OAuthServiceConfig,
  OAuthTokens,
  StoredOAuthState,
  TokenStore,
} from "../types.ts";
import { MemoryTokenStore } from "../token-store/memory.ts";
import { MAX_OAUTH_TOKEN_VALUE_LENGTH, MAX_OAUTH_USER_ID_LENGTH } from "../limits.ts";

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

Deno.test("OAuthService.fetch: joins relative endpoints without requiring a leading slash", async () => {
  const service = new OAuthService(
    { ...TEST_CONFIG, apiBaseUrl: "https://api.provider.test/v1" },
    makeAuthedTokenStore(),
    (k) => ENV[k],
  );
  const captured: string[] = [];

  await withStubbedFetch(captured, async () => {
    await service.fetch("user-1", "me");
  });

  assertEquals(captured, ["https://api.provider.test/v1/me"]);
});

Deno.test("OAuthService.fetch: preserves Headers instances and caller content types", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (k) => ENV[k]);
  const original = globalThis.fetch;
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = ((
    _input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> => {
    capturedHeaders = new Headers(init?.headers);
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;

  try {
    await service.fetch("user-1", "/v1/me", {
      method: "POST",
      body: "plain body",
      headers: new Headers({
        "content-type": "text/plain",
        "x-request-id": "request-1",
      }),
    });
  } finally {
    globalThis.fetch = original;
  }

  assertEquals(capturedHeaders?.get("authorization"), "Bearer test-access-token");
  assertEquals(capturedHeaders?.get("content-type"), "text/plain");
  assertEquals(capturedHeaders?.get("x-request-id"), "request-1");
});

Deno.test("OAuthService.fetch does not invent a content type for caller-owned bodies", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  const original = globalThis.fetch;
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;

  try {
    await service.fetch("user-1", "/v1/me", {
      method: "POST",
      body: new URLSearchParams({ field: "value" }),
    });
  } finally {
    globalThis.fetch = original;
  }

  assertEquals(capturedHeaders?.get("authorization"), "Bearer test-access-token");
  assertEquals(capturedHeaders?.has("content-type"), false);
});

Deno.test("OAuthService.fetch applies provider API headers and owns Authorization", async () => {
  const config = {
    ...TEST_CONFIG,
    apiHeaders: { "X-Provider-Version": "2026-01-01" },
  };
  const service = new OAuthService(config, makeAuthedTokenStore(), (key) => ENV[key]);
  const original = globalThis.fetch;
  let capturedHeaders: Headers | undefined;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    capturedHeaders = new Headers(init?.headers);
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;

  try {
    await service.fetch("user-1", "/v1/me", {
      headers: { Authorization: "Bearer caller-controlled", "X-Request-Id": "request-1" },
    });
  } finally {
    globalThis.fetch = original;
  }

  assertEquals(capturedHeaders?.get("authorization"), "Bearer test-access-token");
  assertEquals(capturedHeaders?.get("x-provider-version"), "2026-01-01");
  assertEquals(capturedHeaders?.get("x-request-id"), "request-1");
});

Deno.test("OAuthService.fetch bounds successful JSON responses and accepts the exact limit", async () => {
  const exactJson = '{"ok":1}';
  const config = {
    ...TEST_CONFIG,
    maxApiResponseBytes: new TextEncoder().encode(exactJson).byteLength,
  };
  const service = new OAuthService(config, makeAuthedTokenStore(), (key) => ENV[key]);
  const original = globalThis.fetch;

  try {
    globalThis.fetch = (() => Promise.resolve(new Response(exactJson))) as typeof fetch;
    assertEquals(await service.fetch("user-1", "/v1/me"), { ok: 1 });

    globalThis.fetch = (() => Promise.resolve(new Response('{"oversized":true}'))) as typeof fetch;
    await assertRejects(
      () => service.fetch("user-1", "/v1/me"),
      Error,
      "response exceeded",
    );
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthService.fetch supports successful no-content responses", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(null, { status: 204 }))) as typeof fetch;

  try {
    assertEquals(
      await service.fetch<void>("user-1", "/v1/resource", { method: "DELETE" }),
      undefined,
    );
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider preserves existing authorization endpoint query parameters", async () => {
  const provider = new OAuthProvider(
    { ...TEST_CONFIG, authorizationUrl: "https://provider.test/auth?audience=existing" },
    (key) => ENV[key],
  );

  const result = await provider.createAuthorizationUrl({
    redirectUri: "https://app.test/callback",
    scopes: ["read"],
  });
  const url = new URL(result.url);

  assertEquals(url.searchParams.get("audience"), "existing");
  assertEquals(url.searchParams.get("client_id"), "test-id");
  assertEquals(url.searchParams.get("state"), result.state.state);
});

Deno.test("OAuthProvider rejects reserved authorization parameter overrides", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);

  await assertRejects(
    () =>
      provider.createAuthorizationUrl({
        redirectUri: "https://app.test/callback",
        additionalParams: {
          state: "attacker-controlled",
          redirect_uri: "https://attacker.test/callback",
        },
      }),
    Error,
    "reserved OAuth authorization parameter",
  );
});

Deno.test("OAuthProvider enforces explicit PKCE capability modes", async () => {
  const unsupportedConfig = { ...TEST_CONFIG, pkceMode: "unsupported" as const };
  const unsupported = new OAuthProvider(unsupportedConfig, (key) => ENV[key]);
  const noPkce = await unsupported.createAuthorizationUrl({
    redirectUri: "https://app.test/callback",
  });
  assertEquals(new URL(noPkce.url).searchParams.has("code_challenge"), false);
  assertEquals(noPkce.state.codeVerifier, undefined);
  await assertRejects(
    () =>
      unsupported.createAuthorizationUrl({
        redirectUri: "https://app.test/callback",
        usePkce: true,
      }),
    Error,
    "does not support PKCE",
  );

  const requiredConfig = { ...TEST_CONFIG, pkceMode: "required" as const };
  const required = new OAuthProvider(requiredConfig, (key) => ENV[key]);
  await assertRejects(
    () =>
      required.createAuthorizationUrl({
        redirectUri: "https://app.test/callback",
        usePkce: false,
      }),
    Error,
    "requires PKCE",
  );

  const originalFetch = globalThis.fetch;
  let tokenRequestCount = 0;
  globalThis.fetch = (() => {
    tokenRequestCount++;
    return Promise.resolve(Response.json({ access_token: "unexpected" }));
  }) as typeof fetch;
  try {
    await assertRejects(
      () =>
        required.exchangeCode({
          code: "code",
          redirectUri: "https://app.test/callback",
        }),
      Error,
      "requires a PKCE code verifier",
    );
    await assertRejects(
      () =>
        unsupported.exchangeCode({
          code: "code",
          redirectUri: "https://app.test/callback",
          codeVerifier: "a".repeat(43),
        }),
      Error,
      "does not support PKCE code verifiers",
    );
    assertEquals(tokenRequestCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("OAuthProvider rejects reserved config-level parameter overrides eagerly", () => {
  for (const key of ["client_id", "CLIENT_ID"]) {
    assertThrows(
      () =>
        new OAuthProvider(
          {
            ...TEST_CONFIG,
            additionalAuthParams: { [key]: "wrong-client" },
          },
          (name) => ENV[name],
        ),
      Error,
      "reserved OAuth authorization parameter",
    );
  }

  for (const key of ["grant_type", "GRANT_TYPE"]) {
    assertThrows(
      () =>
        new OAuthProvider(
          {
            ...TEST_CONFIG,
            additionalTokenParams: { [key]: "password" },
          },
          (name) => ENV[name],
        ),
      Error,
      "reserved OAuth token parameter",
    );
  }
});

Deno.test("OAuthProvider bounds configuration-controlled wire fields", () => {
  for (
    const config of [
      { ...TEST_CONFIG, providerId: "provider id" },
      { ...TEST_CONFIG, clientIdEnvVar: "INVALID-NAME" },
      { ...TEST_CONFIG, additionalAuthParams: { ["x".repeat(129)]: "value" } },
      { ...TEST_CONFIG, additionalTokenParams: { audience: "x".repeat(4_097) } },
      { ...TEST_CONFIG, tokenRequestHeaders: { "X-Large": "x".repeat(8_193) } },
      { ...TEST_CONFIG, tokenResponseMapping: { accessToken: "" } },
      {
        ...TEST_CONFIG,
        tokenResponseMapping: { accessToken: "token", refreshToken: "token" },
      },
    ]
  ) {
    assertThrows(
      () => new OAuthProvider(config as OAuthServiceConfig, (key) => ENV[key]),
      Error,
    );
  }
});

Deno.test("OAuthProvider snapshots authorization parameters before asynchronous PKCE work", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  const additionalParams: Record<string, string> = { audience: "original" };

  const pending = provider.createAuthorizationUrl({
    redirectUri: "https://app.test/callback",
    additionalParams,
  });
  additionalParams.audience = "mutated";
  additionalParams.state = "attacker-controlled";

  const url = new URL((await pending).url);
  assertEquals(url.searchParams.get("audience"), "original");
  assertNotEquals(url.searchParams.get("state"), "attacker-controlled");
});

Deno.test("OAuthProvider snapshots nested configuration values", async () => {
  const defaultScopes = ["read"];
  const additionalAuthParams = { audience: "original" };
  const config: OAuthServiceConfig = {
    ...TEST_CONFIG,
    defaultScopes,
    additionalAuthParams,
  };
  const service = new OAuthService(config, undefined, (key) => ENV[key]);
  defaultScopes[0] = "mutated";
  additionalAuthParams.audience = "mutated";

  const result = await service.createAuthorizationUrl({
    redirectUri: "https://app.test/callback",
  });
  const url = new URL(result.url);
  assertEquals(url.searchParams.get("scope"), "read");
  assertEquals(url.searchParams.get("audience"), "original");
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

Deno.test("OAuthService.fetch: rejects endpoint credentials and fragments before fetch", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  const captured: string[] = [];

  await withStubbedFetch(captured, async () => {
    for (
      const endpoint of [
        "https://user:password@api.provider.test/v1/me",
        "https://api.provider.test/v1/me#secret",
      ]
    ) {
      await assertRejects(
        () => service.fetch<unknown>("user-1", endpoint),
        Error,
        "credentials or a fragment",
      );
    }
  });

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
    assertEquals((thrown as { slug?: unknown }).slug, "network-error");
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

Deno.test("OAuthProvider uses form-encoded UTF-8 credentials for HTTP Basic auth", async () => {
  const provider = new OAuthProvider(
    { ...TEST_CONFIG, useBasicAuth: true },
    (key) => key === TEST_CONFIG.clientIdEnvVar ? "user: ä" : "s%écret",
  );
  const original = globalThis.fetch;
  let requestHeaders: Headers | undefined;
  let requestBody = "";
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    requestHeaders = new Headers(init?.headers);
    requestBody = String(init?.body ?? "");
    return Promise.resolve(Response.json({ access_token: "token" }));
  }) as typeof fetch;

  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/callback",
    });
    assertEquals(result.success, true);
    assertEquals(
      requestHeaders?.get("authorization"),
      "Basic dXNlciUzQSslQzMlQTQ6cyUyNSVDMyVBOWNyZXQ=",
    );
    const body = new URLSearchParams(requestBody);
    assertEquals(body.has("client_id"), false);
    assertEquals(body.has("client_secret"), false);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider supports JSON token bodies and required static headers", async () => {
  const config = {
    ...TEST_CONFIG,
    useBasicAuth: true,
    tokenRequestFormat: "json" as const,
    tokenRequestHeaders: { "X-Provider-Version": "2026-01-01" },
  };
  const provider = new OAuthProvider(config, (key) => ENV[key]);
  const original = globalThis.fetch;
  let requestHeaders: Headers | undefined;
  let requestBody = "";
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    requestHeaders = new Headers(init?.headers);
    requestBody = String(init?.body ?? "");
    return Promise.resolve(Response.json({ access_token: "token" }));
  }) as typeof fetch;

  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/callback",
    });
    assertEquals(result.success, true);
    assertEquals(requestHeaders?.get("content-type"), "application/json");
    assertEquals(requestHeaders?.get("x-provider-version"), "2026-01-01");
    assertEquals(JSON.parse(requestBody), {
      grant_type: "authorization_code",
      code: "code",
      redirect_uri: "https://app.test/callback",
    });
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider rejects malformed runtime config instead of silently changing protocol", () => {
  for (
    const [field, value, expectedMessage] of [
      ["tokenRequestFormat", "xml", "tokenRequestFormat"],
      ["useBasicAuth", "yes", "useBasicAuth"],
      ["additionalAuthParams", null, "authorization parameter"],
      ["additionalTokenParams", [], "token parameter"],
      ["tokenRequestHeaders", null, "token request header"],
      ["apiHeaders", [], "API header"],
      ["tokenResponseMapping", null, "tokenResponseMapping"],
      ["userInfoUrl", null, "userInfoUrl"],
      ["revocationUrl", null, "revocationUrl"],
    ] as const
  ) {
    assertThrows(
      () =>
        new OAuthProvider(
          { ...TEST_CONFIG, [field]: value } as unknown as OAuthServiceConfig,
          (key) => ENV[key],
        ),
      Error,
      expectedMessage,
    );
  }

  for (
    const [field, value] of [
      ["defaultScopes", "read"],
      ["serviceId", 42],
    ] as const
  ) {
    assertThrows(
      () =>
        new OAuthService(
          { ...TEST_CONFIG, [field]: value } as unknown as OAuthServiceConfig,
          makeAuthedTokenStore(),
          (key) => ENV[key],
        ),
      Error,
      field,
    );
  }
});

Deno.test("OAuthProvider rejects malformed authorization options without coercion", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  const redirectUri = "https://app.test/callback";

  for (
    const [options, expectedMessage] of [
      [{ redirectUri, state: 42 }, "state"],
      [{ redirectUri, scopes: "read" }, "scopes"],
      [{ redirectUri, usePkce: "false" }, "usePkce"],
      [{ redirectUri, additionalParams: null }, "authorization parameter"],
    ] as const
  ) {
    await assertRejects(
      () => provider.createAuthorizationUrl(options as unknown as AuthorizationUrlOptions),
      Error,
      expectedMessage,
    );
  }
});

Deno.test("OAuthProvider treats malformed credential reader values as unconfigured", () => {
  const provider = new OAuthProvider(
    TEST_CONFIG,
    (() => 42) as unknown as (key: string) => string | undefined,
  );

  assertEquals(provider.getClientId(), null);
  assertEquals(provider.getClientSecret(), null);
  assertEquals(provider.isConfigured(), false);
});

Deno.test("OAuthProvider rejects static headers that override transport ownership", () => {
  for (const field of ["tokenRequestHeaders", "apiHeaders"] as const) {
    assertThrows(
      () =>
        new OAuthProvider(
          { ...TEST_CONFIG, [field]: { Authorization: "Bearer wrong" } },
          (key) => ENV[key],
        ),
      Error,
      "reserved",
    );
  }
});

Deno.test("OAuthProvider rejects token responses larger than its configured bound", async () => {
  const provider = new OAuthProvider(
    { ...TEST_CONFIG, maxTokenResponseBytes: 32 },
    (key) => ENV[key],
  );
  const original = globalThis.fetch;
  globalThis.fetch =
    (() => Promise.resolve(Response.json({ access_token: "x".repeat(1_024) }))) as typeof fetch;

  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/callback",
    });
    assertEquals(result.success, false);
    assertEquals(result.error, "invalid_token_response");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider accepts a valid token response exactly at its configured bound", async () => {
  const body = JSON.stringify({ access_token: "token" });
  const provider = new OAuthProvider(
    { ...TEST_CONFIG, maxTokenResponseBytes: new TextEncoder().encode(body).byteLength },
    (key) => ENV[key],
  );
  const original = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response(body, { status: 200 }))) as typeof fetch;

  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/callback",
    });
    assertEquals(result.success, true);
    assertEquals(result.tokens?.accessToken, "token");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider aborts token requests at the configured timeout", async () => {
  const provider = new OAuthProvider(
    { ...TEST_CONFIG, requestTimeoutMs: 5 },
    (key) => ENV[key],
  );
  const original = globalThis.fetch;
  globalThis.fetch =
    ((_input: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          reject(new Error("expected a request timeout signal"));
          return;
        }
        const rejectWithReason = () => reject(signal.reason);
        if (signal.aborted) rejectWithReason();
        else signal.addEventListener("abort", rejectWithReason, { once: true });
      })) as typeof fetch;

  try {
    const result = await provider.exchangeCode({
      code: "code",
      redirectUri: "https://app.test/callback",
    });
    assertEquals(result.success, false);
    assertEquals(result.error, "network_error");
    assertEquals(result.errorDescription, "OAuth token request timed out");
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthProvider validates security-sensitive token request inputs", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);

  await assertRejects(
    () => provider.exchangeCode({ code: " ", redirectUri: "https://app.test/callback" }),
    Error,
    "authorization code",
  );
  await assertRejects(
    () =>
      provider.exchangeCode({
        code: "code",
        redirectUri: "https://app.test/callback",
        codeVerifier: "too-short",
      }),
    Error,
    "PKCE",
  );
  await assertRejects(() => provider.refreshTokens(" "), Error, "refresh token");
});

Deno.test("OAuthProvider requires HTTPS provider endpoints", () => {
  for (const field of ["authorizationUrl", "tokenUrl", "apiBaseUrl"] as const) {
    assertThrows(
      () =>
        new OAuthService(
          { ...TEST_CONFIG, [field]: `http://provider.test/${field}` },
          makeAuthedTokenStore(),
          (key) => ENV[key],
        ),
      Error,
      "HTTPS",
    );
  }
});

Deno.test("OAuthProvider rejects reserved token endpoint query parameters", () => {
  assertThrows(
    () =>
      new OAuthProvider(
        {
          ...TEST_CONFIG,
          tokenUrl: "https://provider.test/token?grant_type=password&client_secret=attacker",
        },
        (key) => ENV[key],
      ),
    Error,
    "reserved OAuth token parameter",
  );
});

Deno.test("OAuthProvider rejects cross-origin HTTP redirects for secret-bearing requests", async () => {
  const provider = new OAuthProvider(
    { ...TEST_CONFIG, revocationUrl: "https://provider.test/revoke" },
    (key) => ENV[key],
  );
  const original = globalThis.fetch;
  const redirects: Array<RequestRedirect | undefined> = [];
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    redirects.push(init?.redirect);
    return Promise.resolve(Response.json({ access_token: "token" }));
  }) as typeof fetch;

  try {
    await provider.exchangeCode({ code: "code", redirectUri: "https://app.test/callback" });
    await provider.revokeToken("token");
  } finally {
    globalThis.fetch = original;
  }

  assertEquals(redirects, ["error", "error"]);
});

Deno.test("OAuthProvider bounds revocation tokens before fetch and releases response bodies", async () => {
  const provider = new OAuthProvider(
    { ...TEST_CONFIG, revocationUrl: "https://provider.test/revoke" },
    (key) => ENV[key],
  );
  const original = globalThis.fetch;
  let fetchCalls = 0;
  let responseCancelled = false;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(
      new Response(
        new ReadableStream({
          cancel() {
            responseCancelled = true;
          },
        }),
      ),
    );
  }) as typeof fetch;

  try {
    await assertRejects(
      () => provider.revokeToken("x".repeat(MAX_OAUTH_TOKEN_VALUE_LENGTH + 1)),
      Error,
      "too long",
    );
    assertEquals(fetchCalls, 0);
    assertEquals(await provider.revokeToken("token"), true);
    assertEquals(fetchCalls, 1);
    assertEquals(responseCancelled, true);
  } finally {
    globalThis.fetch = original;
  }
});

Deno.test("OAuthService.fetch cannot be configured to follow redirects", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  const original = globalThis.fetch;
  let redirect: RequestRedirect | undefined;
  globalThis.fetch = ((_input: string | URL | Request, init?: RequestInit) => {
    redirect = init?.redirect;
    return Promise.resolve(Response.json({ ok: true }));
  }) as typeof fetch;

  try {
    await service.fetch("alice", "/me", { redirect: "follow" });
  } finally {
    globalThis.fetch = original;
  }

  assertEquals(redirect, "error");
});

Deno.test("OAuthService rejects oversized authorization codes before fetch", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  const original = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(Response.json({ access_token: "token" }));
  }) as typeof fetch;

  try {
    await assertRejects(
      () =>
        provider.exchangeCode({
          code: "x".repeat(4_097),
          redirectUri: "https://app.test/callback",
        }),
      Error,
      "authorization code",
    );
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = original;
  }
});

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
    let revision = 1;
    const tokenStore: TokenStore = {
      getTokens(): Promise<OAuthTokens | null> {
        return Promise.resolve(storedTokens);
      },
      setTokens(_serviceId: string, _userId: string, tokens: OAuthTokens): Promise<void> {
        setTokenCalls++;
        storedTokens = tokens;
        revision++;
        return Promise.resolve();
      },
      getTokenSnapshot: () =>
        Promise.resolve({ tokens: { ...storedTokens }, revision: String(revision) }),
      compareAndSetTokens: (_serviceId, _userId, expectedRevision, tokens) => {
        if (expectedRevision !== String(revision)) return Promise.resolve(false);
        setTokenCalls++;
        storedTokens = tokens;
        revision++;
        return Promise.resolve(true);
      },
      withTokenRefreshLock: (_serviceId, _userId, operation) => operation(),
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

Deno.test("OAuthService.getAccessToken treats an epoch expiry as expired", async () => {
  const store = makeAuthedTokenStore();
  store.getTokens = () => Promise.resolve({ accessToken: "expired", expiresAt: 0 });
  const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);

  assertEquals(await service.getAccessToken("alice"), null);
});

Deno.test("OAuthService.getAccessToken uses a non-refreshable token until its real expiry", async () => {
  const store = makeAuthedTokenStore();
  store.getTokens = () =>
    Promise.resolve({
      accessToken: "still-valid",
      expiresAt: Date.now() + 60_000,
    });
  const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);

  assertEquals(await service.getAccessToken("alice"), "still-valid");
});

Deno.test(
  "OAuthService.getAccessToken fails before refresh when the store lacks revisioned CAS",
  async () => {
    const expired: OAuthTokens = {
      accessToken: "expired",
      refreshToken: "refresh",
      expiresAt: Date.now() - 1,
    };
    const store = makeAuthedTokenStore();
    store.getTokens = () => Promise.resolve(expired);
    const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);
    const original = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (() => {
      fetchCalls++;
      return Promise.resolve(Response.json({ access_token: "unexpected" }));
    }) as typeof fetch;

    try {
      await assertRejects(() => service.getAccessToken("alice"), Error, "atomic token refresh");
      assertEquals(fetchCalls, 0);
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  "OAuthService.getAccessToken keeps a still-valid token after transient proactive refresh failure",
  async () => {
    const store = new MemoryTokenStore();
    await store.setTokens(TEST_CONFIG.serviceId, "alice", {
      accessToken: "still-valid",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
    });
    const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);

    await withTokenFetch(503, { error: "temporarily_unavailable" }, async () => {
      assertEquals(await service.getAccessToken("alice"), "still-valid");
    });
  },
);

Deno.test(
  "OAuthService.getAccessToken cannot overwrite reauthorization during the atomic replace boundary",
  async () => {
    let row: { revision: string; tokens: OAuthTokens } | null = {
      revision: "revision-1",
      tokens: {
        accessToken: "expired",
        refreshToken: "refresh",
        expiresAt: Date.now() - 1,
      },
    };
    let resolveCasEntered!: () => void;
    const casEntered = new Promise<void>((resolve) => {
      resolveCasEntered = resolve;
    });
    let releaseCas!: () => void;
    const casRelease = new Promise<void>((resolve) => {
      releaseCas = resolve;
    });
    const store: TokenStore = {
      getTokens: () => Promise.resolve(row ? { ...row.tokens } : null),
      getTokenSnapshot: () =>
        Promise.resolve(row ? { revision: row.revision, tokens: { ...row.tokens } } : null),
      setTokens: (_serviceId, _userId, tokens) => {
        row = { revision: `revision-${Number(row?.revision.slice(-1) ?? 0) + 1}`, tokens };
        return Promise.resolve();
      },
      compareAndSetTokens: async (_serviceId, _userId, expectedRevision, tokens) => {
        resolveCasEntered();
        await casRelease;
        if (!row || row.revision !== expectedRevision) return false;
        row = { revision: "revision-cas", tokens };
        return true;
      },
      withTokenRefreshLock: (_serviceId, _userId, operation) => operation(),
      clearTokens: () => {
        row = null;
        return Promise.resolve();
      },
      setState: () => Promise.resolve(),
      consumeState: () => Promise.resolve(null),
    };
    const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);

    await withTokenFetch(200, { access_token: "stale-refresh", expires_in: 3_600 }, async () => {
      const result = service.getAccessToken("alice");
      let timeoutId: number | undefined;
      try {
        await Promise.race([
          casEntered,
          new Promise<never>((_resolve, reject) => {
            timeoutId = setTimeout(() => reject(new Error("atomic replace was not used")), 100);
          }),
        ]);
      } finally {
        clearTimeout(timeoutId);
      }
      await store.setTokens(TEST_CONFIG.serviceId, "alice", {
        accessToken: "new-authorization",
        refreshToken: "new-refresh",
        expiresAt: Date.now() + 3_600_000,
      });
      releaseCas();

      assertEquals(await result, "new-authorization");
      assertEquals(row?.tokens.accessToken, "new-authorization");
    });
  },
);

Deno.test("OAuthService.getAccessToken rejects malformed persistent-store rows", async () => {
  const store = makeAuthedTokenStore();
  store.getTokens = () => Promise.resolve({ accessToken: "   " });
  const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);

  await assertRejects(
    () => service.getAccessToken("alice"),
    Error,
    "invalid OAuth token row",
  );
});

Deno.test("OAuthService.getAccessToken rejects oversized user IDs before store access", async () => {
  const store = makeAuthedTokenStore();
  let reads = 0;
  store.getTokens = () => {
    reads++;
    return Promise.resolve({ accessToken: "token" });
  };
  const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);

  await assertRejects(
    () => service.getAccessToken("u".repeat(MAX_OAUTH_USER_ID_LENGTH + 1)),
    Error,
    "userId",
  );
  assertEquals(reads, 0);
});

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
    let storedTokens: OAuthTokens = {
      accessToken: "old-token",
      refreshToken: "refresh-token",
      tokenType: "Bearer",
      scope: "read",
      idToken: undefined,
      expiresAt: Date.now() - 1_000,
    };
    let setCount = 0;
    let revision = 1;
    const store: TokenStore = {
      getTokens: () => Promise.resolve({ ...storedTokens }),
      getTokenSnapshot: () =>
        Promise.resolve({ tokens: { ...storedTokens }, revision: String(revision) }),
      setTokens: (_serviceId, _userId, tokens) => {
        setCount++;
        storedTokens = tokens;
        revision++;
        return Promise.resolve();
      },
      compareAndSetTokens: (_serviceId, _userId, expectedRevision, tokens) => {
        if (expectedRevision !== String(revision)) return Promise.resolve(false);
        setCount++;
        storedTokens = tokens;
        revision++;
        return Promise.resolve(true);
      },
      withTokenRefreshLock: (_serviceId, _userId, operation) => operation(),
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
  "OAuthService.getAccessToken: separate store wrappers dedupe through the shared backend lock",
  async () => {
    const backend = new MemoryTokenStore();
    await backend.setTokens(TEST_CONFIG.serviceId, "alice", {
      accessToken: "expired-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 1_000,
    });
    const createWrapper = (): TokenStore => ({
      getTokens: (serviceId, userId) => backend.getTokens(serviceId, userId),
      getTokenSnapshot: (serviceId, userId) => backend.getTokenSnapshot(serviceId, userId),
      setTokens: (serviceId, userId, tokens) => backend.setTokens(serviceId, userId, tokens),
      compareAndSetTokens: (serviceId, userId, revision, tokens) =>
        backend.compareAndSetTokens(serviceId, userId, revision, tokens),
      withTokenRefreshLock: (serviceId, userId, operation) =>
        backend.withTokenRefreshLock(serviceId, userId, operation),
      clearTokens: (serviceId, userId) => backend.clearTokens(serviceId, userId),
      setState: (state, meta) => backend.setState(state, meta),
      consumeState: (state) => backend.consumeState(state),
    });
    const firstService = new OAuthService(TEST_CONFIG, createWrapper(), (key) => ENV[key]);
    const secondService = new OAuthService(TEST_CONFIG, createWrapper(), (key) => ENV[key]);
    const original = globalThis.fetch;
    let refreshCalls = 0;
    globalThis.fetch = (() => {
      refreshCalls++;
      return Promise.resolve(Response.json({
        access_token: "new-token",
        refresh_token: "new-refresh-token",
        expires_in: 3_600,
      }));
    }) as typeof fetch;

    try {
      assertEquals(
        await Promise.all([
          firstService.getAccessToken("alice"),
          secondService.getAccessToken("alice"),
        ]),
        ["new-token", "new-token"],
      );
      assertEquals(refreshCalls, 1);
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  "OAuthService.getAccessToken: separate token stores do not share refresh promises",
  async () => {
    function makeExpiredStore(refreshToken: string): TokenStore {
      let storedTokens: OAuthTokens = {
        accessToken: `old-${refreshToken}`,
        refreshToken,
        tokenType: "Bearer",
        scope: "read",
        idToken: undefined,
        expiresAt: Date.now() - 1_000,
      };
      let revision = 1;
      return {
        getTokens: () => Promise.resolve({ ...storedTokens }),
        getTokenSnapshot: () =>
          Promise.resolve({ tokens: { ...storedTokens }, revision: String(revision) }),
        setTokens: (_serviceId, _userId, tokens) => {
          storedTokens = tokens;
          revision++;
          return Promise.resolve();
        },
        compareAndSetTokens: (_serviceId, _userId, expectedRevision, tokens) => {
          if (expectedRevision !== String(revision)) return Promise.resolve(false);
          storedTokens = tokens;
          revision++;
          return Promise.resolve(true);
        },
        withTokenRefreshLock: (_serviceId, _userId, operation) => operation(),
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
  "OAuthService.getAccessToken: a completed refresh cannot resurrect a disconnected slot",
  async () => {
    let storedTokens: OAuthTokens | null = {
      accessToken: "expired-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() - 1_000,
    };
    let setCalls = 0;
    let revision = 1;
    const store: TokenStore = {
      getTokens: () => Promise.resolve(storedTokens),
      setTokens: (_serviceId, _userId, value) => {
        setCalls++;
        storedTokens = value;
        revision++;
        return Promise.resolve();
      },
      getTokenSnapshot: () =>
        Promise.resolve(
          storedTokens ? { tokens: { ...storedTokens }, revision: String(revision) } : null,
        ),
      compareAndSetTokens: (_serviceId, _userId, expectedRevision, value) => {
        if (!storedTokens || expectedRevision !== String(revision)) return Promise.resolve(false);
        setCalls++;
        storedTokens = value;
        revision++;
        return Promise.resolve(true);
      },
      withTokenRefreshLock: (_serviceId, _userId, operation) => operation(),
      clearTokens: () => {
        storedTokens = null;
        revision++;
        return Promise.resolve();
      },
      setState: () => Promise.resolve(),
      consumeState: () => Promise.resolve(null),
    };
    const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);
    let resolveFetch!: (response: Response) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      markStarted();
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as typeof fetch;

    try {
      const accessToken = service.getAccessToken("user-1");
      await started;
      await store.clearTokens(TEST_CONFIG.serviceId, "user-1");
      resolveFetch(Response.json({ access_token: "refreshed-token", expires_in: 3600 }));

      assertEquals(await accessToken, null);
      assertEquals(storedTokens, null);
      assertEquals(setCalls, 0);
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test(
  "OAuthService.getAccessToken: a completed refresh cannot overwrite a newer authorization",
  async () => {
    let storedTokens: OAuthTokens = {
      accessToken: "expired-token",
      refreshToken: "shared-refresh-token",
      expiresAt: Date.now() - 1_000,
    };
    let setCalls = 0;
    let revision = 1;
    const store: TokenStore = {
      getTokens: () => Promise.resolve(storedTokens),
      setTokens: (_serviceId, _userId, value) => {
        setCalls++;
        storedTokens = value;
        revision++;
        return Promise.resolve();
      },
      getTokenSnapshot: () =>
        Promise.resolve({ tokens: { ...storedTokens }, revision: String(revision) }),
      compareAndSetTokens: (_serviceId, _userId, expectedRevision, value) => {
        if (expectedRevision !== String(revision)) return Promise.resolve(false);
        setCalls++;
        storedTokens = value;
        revision++;
        return Promise.resolve(true);
      },
      withTokenRefreshLock: (_serviceId, _userId, operation) => operation(),
      clearTokens: () => Promise.resolve(),
      setState: () => Promise.resolve(),
      consumeState: () => Promise.resolve(null),
    };
    const service = new OAuthService(TEST_CONFIG, store, (key) => ENV[key]);
    let resolveFetch!: (response: Response) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      markStarted();
      return new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      });
    }) as typeof fetch;

    try {
      const accessToken = service.getAccessToken("user-1");
      await started;
      await store.setTokens(TEST_CONFIG.serviceId, "user-1", {
        accessToken: "newer-authorization-token",
        refreshToken: "shared-refresh-token",
        expiresAt: Date.now() + 60_000,
      });
      resolveFetch(Response.json({ access_token: "stale-refresh-result", expires_in: 3600 }));

      assertEquals(await accessToken, "newer-authorization-token");
      assertEquals(storedTokens.accessToken, "newer-authorization-token");
      assertEquals(setCalls, 1);
    } finally {
      globalThis.fetch = original;
    }
  },
);

Deno.test("OAuthService.exchangeCode: expires_in zero remains immediately expired", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  const before = Date.now();
  let result: Awaited<ReturnType<typeof service.exchangeCode>> | undefined;

  await withTokenFetch(200, { access_token: "token", expires_in: 0 }, async () => {
    result = await service.exchangeCode({ code: "code", redirectUri: "https://app.test/cb" });
  });

  assertEquals(result?.success, true);
  assert(
    result?.tokens?.expiresAt !== undefined &&
      result.tokens.expiresAt >= before &&
      result.tokens.expiresAt <= Date.now(),
  );
});

Deno.test("OAuthService.exchangeCode: rejects malformed token expiry values", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);

  for (const expiresIn of [-1, 1.5, "", "not-a-number", "1e9999"]) {
    let result: Awaited<ReturnType<typeof service.exchangeCode>> | undefined;
    await withTokenFetch(200, { access_token: "token", expires_in: expiresIn }, async () => {
      result = await service.exchangeCode({ code: "code", redirectUri: "https://app.test/cb" });
    });
    assertEquals(result?.success, false, `expires_in=${String(expiresIn)} must fail closed`);
    assertEquals(result?.error, "invalid_token_response");
  }
});

Deno.test("OAuthService.exchangeCode: rejects whitespace-only access tokens", async () => {
  const service = new OAuthService(TEST_CONFIG, makeAuthedTokenStore(), (key) => ENV[key]);
  let result: Awaited<ReturnType<typeof service.exchangeCode>> | undefined;

  await withTokenFetch(200, { access_token: "   " }, async () => {
    result = await service.exchangeCode({ code: "code", redirectUri: "https://app.test/cb" });
  });

  assertEquals(result?.success, false);
  assertEquals(result?.error, "invalid_token_response");
});

Deno.test("OAuthProvider rejects present-but-malformed optional token fields", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  for (
    const body of [
      { access_token: "token", refresh_token: " " },
      { access_token: "token", token_type: "" },
      { access_token: "token", scope: null },
      { access_token: "token", id_token: 42 },
    ]
  ) {
    await withTokenFetch(200, body, async () => {
      const result = await provider.refreshTokens("existing-refresh-token");
      assertEquals(result.success, false);
      assertEquals(result.error, "invalid_token_response");
    });
  }
});

Deno.test("OAuthProvider treats an explicit null refresh token as deliberate absence", async () => {
  const provider = new OAuthProvider(TEST_CONFIG, (key) => ENV[key]);
  await withTokenFetch(200, { access_token: "token", refresh_token: null }, async () => {
    const result = await provider.refreshTokens("existing-refresh-token");
    assertEquals(result.success, true);
    assertEquals(result.tokens?.accessToken, "token");
    assertEquals(result.tokens?.refreshToken, undefined);
  });
});
