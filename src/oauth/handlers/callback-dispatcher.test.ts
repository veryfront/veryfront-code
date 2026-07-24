import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#std/assert";
import { createTestEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  createOAuthCallbackDispatcher as createRuntimeOAuthCallbackDispatcher,
  type OAuthCallbackDispatcherOptions,
} from "./callback-handler.ts";
import { MemoryTokenStore } from "../token-store/memory.ts";
import type { OAuthServiceConfig, StoredOAuthState } from "../types.ts";
import { MAX_OAUTH_ERROR_DESCRIPTION_LENGTH, MAX_OAUTH_SERVICE_ID_LENGTH } from "../limits.ts";

const APP_URL = "http://localhost:3000";
const CALLBACK_ROUTE_ID = "shared";
const CALLBACK_URI = `${APP_URL}/api/auth/${CALLBACK_ROUTE_ID}/callback`;
const CODE_VERIFIER = "v".repeat(64);
const TEST_ENV = createTestEnvironmentConfig({
  veryfrontEnv: "test",
  appUrl: APP_URL,
});

const ALPHA_CONFIG: OAuthServiceConfig = {
  providerId: "alpha-provider",
  serviceId: "alpha",
  displayName: "Alpha",
  clientIdEnvVar: "ALPHA_CLIENT_ID",
  clientSecretEnvVar: "ALPHA_CLIENT_SECRET",
  authorizationUrl: "https://alpha.provider.test/auth",
  tokenUrl: "https://alpha.provider.test/token",
  defaultScopes: ["alpha:read"],
  apiBaseUrl: "https://alpha.provider.test/api",
};

const BETA_CONFIG: OAuthServiceConfig = {
  providerId: "beta-provider",
  serviceId: "beta",
  displayName: "Beta",
  clientIdEnvVar: "BETA_CLIENT_ID",
  clientSecretEnvVar: "BETA_CLIENT_SECRET",
  authorizationUrl: "https://beta.provider.test/auth",
  tokenUrl: "https://beta.provider.test/token",
  defaultScopes: ["beta:read"],
  apiBaseUrl: "https://beta.provider.test/api",
  pkceMode: "unsupported",
};

const ENV: Record<string, string> = {
  ALPHA_CLIENT_ID: "alpha-id",
  ALPHA_CLIENT_SECRET: "alpha-secret",
  BETA_CLIENT_ID: "beta-id",
  BETA_CLIENT_SECRET: "beta-secret",
};

function createOAuthCallbackDispatcher(
  configs: readonly OAuthServiceConfig[],
  options: OAuthCallbackDispatcherOptions,
): (request: Request) => Promise<Response> {
  return createRuntimeOAuthCallbackDispatcher(configs, {
    env: TEST_ENV,
    ...options,
  });
}

function makeRequest(entries: readonly (readonly [string, string])[]): Request {
  const url = new URL(CALLBACK_URI);
  for (const [name, value] of entries) url.searchParams.append(name, value);
  return new Request(url);
}

function stateFor(
  serviceId: string,
  overrides: Partial<StoredOAuthState> = {},
): StoredOAuthState {
  return {
    userId: "alice",
    serviceId,
    redirectUri: CALLBACK_URI,
    scopes: [`${serviceId}:read`],
    createdAt: Date.now(),
    ...(serviceId === ALPHA_CONFIG.serviceId ? { codeVerifier: CODE_VERIFIER } : {}),
    ...overrides,
  };
}

Deno.test("callback dispatcher exchanges and stores tokens for the state-selected service", async () => {
  const store = new MemoryTokenStore();
  await store.setState("beta-state", stateFor(BETA_CONFIG.serviceId));
  const exchanges: string[] = [];
  const successes: string[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    exchanges.push(url);
    return Promise.resolve(Response.json({ access_token: "beta-access-token" }));
  }) as typeof fetch;

  try {
    const handler = createOAuthCallbackDispatcher([ALPHA_CONFIG, BETA_CONFIG], {
      callbackRouteId: CALLBACK_ROUTE_ID,
      tokenStore: store,
      baseUrl: APP_URL,
      envReader: (key) => ENV[key],
      onSuccess: (serviceId) => {
        successes.push(serviceId);
      },
    });
    const response = await handler(
      makeRequest([["code", "beta-code"], ["state", "beta-state"]]),
    );

    assertEquals(response.status, 302);
    assertEquals(
      new URL(response.headers.get("location")!).searchParams.get("connected"),
      BETA_CONFIG.serviceId,
    );
    assertEquals(exchanges, [BETA_CONFIG.tokenUrl]);
    assertEquals(successes, [BETA_CONFIG.serviceId]);
    assertEquals(
      await store.getTokens(BETA_CONFIG.serviceId, "alice"),
      {
        accessToken: "beta-access-token",
        scope: "beta:read",
      },
    );
    assertEquals(await store.getTokens(ALPHA_CONFIG.serviceId, "alice"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("callback dispatcher rejects and consumes state for a service outside its allowlist", async () => {
  const store = new MemoryTokenStore();
  const unknownServiceId = "unlisted-provider";
  await store.setState("unknown-state", stateFor(unknownServiceId));
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(Response.json({ access_token: "should-not-exist" }));
  }) as typeof fetch;

  try {
    const handler = createOAuthCallbackDispatcher([ALPHA_CONFIG, BETA_CONFIG], {
      callbackRouteId: CALLBACK_ROUTE_ID,
      tokenStore: store,
      baseUrl: APP_URL,
      envReader: (key) => ENV[key],
    });
    const response = await handler(
      makeRequest([["code", "code"], ["state", "unknown-state"]]),
    );
    const location = response.headers.get("location")!;

    assertEquals(new URL(location).searchParams.get("error"), "invalid_state");
    assertEquals(location.includes(unknownServiceId), false);
    assertEquals(fetchCalls, 0);
    assertEquals(await store.consumeState("unknown-state"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("callback dispatcher enforces the exact shared redirect binding", async () => {
  const store = new MemoryTokenStore();
  await store.setState(
    "wrong-redirect",
    stateFor(ALPHA_CONFIG.serviceId, {
      redirectUri: `${CALLBACK_URI}?service=alpha`,
    }),
  );
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(Response.json({ access_token: "should-not-exist" }));
  }) as typeof fetch;

  try {
    const handler = createOAuthCallbackDispatcher([ALPHA_CONFIG, BETA_CONFIG], {
      callbackRouteId: CALLBACK_ROUTE_ID,
      tokenStore: store,
      baseUrl: APP_URL,
      envReader: (key) => ENV[key],
    });
    const response = await handler(
      makeRequest([["code", "code"], ["state", "wrong-redirect"]]),
    );

    assertEquals(
      new URL(response.headers.get("location")!).searchParams.get("error"),
      "invalid_state",
    );
    assertEquals(fetchCalls, 0);
    assertEquals(await store.consumeState("wrong-redirect"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("callback dispatcher applies the selected service PKCE requirement", async () => {
  const store = new MemoryTokenStore();
  await store.setState(
    "missing-verifier",
    stateFor(ALPHA_CONFIG.serviceId, { codeVerifier: undefined }),
  );
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(Response.json({ access_token: "should-not-exist" }));
  }) as typeof fetch;

  try {
    const handler = createOAuthCallbackDispatcher([ALPHA_CONFIG, BETA_CONFIG], {
      callbackRouteId: CALLBACK_ROUTE_ID,
      tokenStore: store,
      baseUrl: APP_URL,
      envReader: (key) => ENV[key],
    });
    const response = await handler(
      makeRequest([["code", "code"], ["state", "missing-verifier"]]),
    );

    assertEquals(
      new URL(response.headers.get("location")!).searchParams.get("error"),
      "invalid_state",
    );
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("callback dispatcher rejects PKCE state for a service that does not support it", async () => {
  const store = new MemoryTokenStore();
  await store.setState(
    "unexpected-verifier",
    stateFor(BETA_CONFIG.serviceId, { codeVerifier: CODE_VERIFIER }),
  );
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(Response.json({ access_token: "should-not-exist" }));
  }) as typeof fetch;

  try {
    const handler = createOAuthCallbackDispatcher([ALPHA_CONFIG, BETA_CONFIG], {
      callbackRouteId: CALLBACK_ROUTE_ID,
      tokenStore: store,
      baseUrl: APP_URL,
      envReader: (key) => ENV[key],
    });
    const response = await handler(
      makeRequest([["code", "code"], ["state", "unexpected-verifier"]]),
    );

    assertEquals(
      new URL(response.headers.get("location")!).searchParams.get("error"),
      "invalid_state",
    );
    assertEquals(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("callback dispatcher rejects duplicate or oversized parameters before state access", async () => {
  const store = new MemoryTokenStore();
  await store.setState("valid-state", stateFor(ALPHA_CONFIG.serviceId));
  let consumeCalls = 0;
  const consumeState = store.consumeState.bind(store);
  store.consumeState = (state) => {
    consumeCalls++;
    return consumeState(state);
  };
  const handler = createOAuthCallbackDispatcher([ALPHA_CONFIG], {
    callbackRouteId: CALLBACK_ROUTE_ID,
    tokenStore: store,
    baseUrl: APP_URL,
    envReader: (key) => ENV[key],
  });

  for (
    const request of [
      makeRequest([
        ["code", "first"],
        ["code", "second"],
        ["state", "valid-state"],
      ]),
      makeRequest([
        ["code", "code"],
        ["state", "valid-state"],
        ["error_description", "x".repeat(MAX_OAUTH_ERROR_DESCRIPTION_LENGTH + 1)],
      ]),
    ]
  ) {
    const response = await handler(request);
    assertEquals(
      new URL(response.headers.get("location")!).searchParams.get("error"),
      "invalid_request",
    );
  }

  assertEquals(consumeCalls, 0);
  assertEquals((await consumeState("valid-state"))?.userId, "alice");
});

Deno.test("callback dispatcher relies on one-shot state consumption under concurrency", async () => {
  const store = new MemoryTokenStore();
  await store.setState("one-shot", stateFor(BETA_CONFIG.serviceId));
  let fetchCalls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (() => {
    fetchCalls++;
    return Promise.resolve(Response.json({ access_token: "beta-token" }));
  }) as typeof fetch;

  try {
    const handler = createOAuthCallbackDispatcher([BETA_CONFIG], {
      callbackRouteId: CALLBACK_ROUTE_ID,
      tokenStore: store,
      baseUrl: APP_URL,
      envReader: (key) => ENV[key],
    });
    const responses = await Promise.all([
      handler(makeRequest([["code", "first-code"], ["state", "one-shot"]])),
      handler(makeRequest([["code", "second-code"], ["state", "one-shot"]])),
    ]);
    const locations = responses.map((response) => new URL(response.headers.get("location")!));

    assertEquals(
      locations.filter((location) => location.searchParams.get("connected") === "beta").length,
      1,
    );
    assertEquals(
      locations.filter((location) => location.searchParams.get("error") === "invalid_state")
        .length,
      1,
    );
    assertEquals(fetchCalls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("callback dispatcher validates its allowlist and shared route eagerly", () => {
  const options = {
    callbackRouteId: CALLBACK_ROUTE_ID,
    tokenStore: new MemoryTokenStore(),
    baseUrl: APP_URL,
    envReader: (key: string) => ENV[key],
  };

  assertThrows(
    () => createOAuthCallbackDispatcher([], options),
    Error,
    "at least one",
  );
  assertThrows(
    () => createOAuthCallbackDispatcher([ALPHA_CONFIG, { ...ALPHA_CONFIG }], options),
    Error,
    "unique",
  );
  assertThrows(
    () =>
      createOAuthCallbackDispatcher([ALPHA_CONFIG], {
        ...options,
        callbackRouteId: "invalid/route",
      }),
    Error,
    "unsupported characters",
  );
  assertThrows(
    () =>
      createOAuthCallbackDispatcher([ALPHA_CONFIG], {
        ...options,
        callbackRouteId: "x".repeat(MAX_OAUTH_SERVICE_ID_LENGTH + 1),
      }),
    Error,
    "unsupported characters",
  );
  assertThrows(
    () =>
      createOAuthCallbackDispatcher([ALPHA_CONFIG], {
        ...options,
        // deno-lint-ignore no-explicit-any
        callbackRouteId: undefined as any,
      }),
    Error,
    "callbackRouteId",
  );
  assertThrows(
    () =>
      createOAuthCallbackDispatcher([ALPHA_CONFIG], {
        ...options,
        skipStateValidation: true,
      }),
    Error,
    "state validation cannot be disabled",
  );
});
