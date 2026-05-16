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
