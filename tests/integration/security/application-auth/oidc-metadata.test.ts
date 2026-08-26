import "#veryfront/schemas/_test-setup.ts";
import {
  HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV,
  HOST_INTERNAL_EGRESS_OVERRIDE_ENV,
} from "#veryfront/security/http/outbound-fetch.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { testDelay } from "#veryfront/testing/timing.ts";
import {
  createOidcMetadataCache,
  fetchOidcMetadata,
  type OidcMetadata,
  parseStrictJsonObject,
} from "../../../../src/security/application-auth/oidc-metadata.ts";

const TestArrayPrototypeSort = Array.prototype.sort;
const TestJSONParse = JSON.parse;
const TestJSONStringify = JSON.stringify;
const TestMapPrototypeGet = Map.prototype.get;
const TestMapPrototypeHas = Map.prototype.has;
const TestObjectDefineProperty = Object.defineProperty;
const TestObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const TestPromisePrototypeThen = Promise.prototype.then;
const TestPromiseResolve = Promise.resolve;
const TestReflectApply = Reflect.apply;
const TestReflectDeleteProperty = Reflect.deleteProperty;
const TestStringPrototypeSlice = String.prototype.slice;

const ISSUER = "https://issuer.example.com/tenant";
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

function replacePropertyForTest(target: object, key: PropertyKey, value: unknown): () => void {
  const descriptor = TestReflectApply(
    TestObjectGetOwnPropertyDescriptor,
    undefined,
    [target, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined) throw new Error(`Expected ${String(key)} descriptor`);
  TestReflectApply(TestObjectDefineProperty, undefined, [
    target,
    key,
    { ...descriptor, value },
  ]);
  return () => {
    TestReflectApply(TestObjectDefineProperty, undefined, [target, key, descriptor]);
  };
}

function replaceGetterForTest(target: object, key: PropertyKey, get: () => unknown): () => void {
  const descriptor = TestReflectApply(
    TestObjectGetOwnPropertyDescriptor,
    undefined,
    [target, key],
  ) as PropertyDescriptor | undefined;
  if (descriptor === undefined) throw new Error(`Expected ${String(key)} descriptor`);
  TestReflectApply(TestObjectDefineProperty, undefined, [target, key, { ...descriptor, get }]);
  return () => {
    TestReflectApply(TestObjectDefineProperty, undefined, [target, key, descriptor]);
  };
}

function metadata(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    issuer: ISSUER,
    authorization_endpoint: `${ISSUER}/authorize`,
    token_endpoint: `${ISSUER}/token`,
    jwks_uri: `${ISSUER}/jwks.json`,
    ...overrides,
  });
}

function metadataFor(issuer: string): string {
  return JSON.stringify({
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks.json`,
  });
}

function jsonResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

async function expectDiscoveryRejects(
  body: string,
  message: string,
  init: ResponseInit = {},
): Promise<Error> {
  const error = await assertRejects(
    () =>
      withMockFetch(
        () => Promise.resolve(jsonResponse(body, init)),
        () => fetchOidcMetadata({ issuer: ISSUER }),
      ),
    TypeError,
    message,
  );
  assert(error instanceof Error);
  return error;
}

describe("security/application-auth OIDC metadata", () => {
  it("exposes the strict JSON object parser used by discovery and JWKS consumers", () => {
    const parsed = parseStrictJsonObject('{"issuer":"https://issuer.example.com"}', "JWT claims");
    assertEquals(parsed, { issuer: "https://issuer.example.com" });
    assertEquals(Object.getPrototypeOf(parsed), null);

    for (
      const [body, message] of [
        ['{"kid":"a","kid":"b"}', "duplicate"],
        ['{"kid":"a"} trailing', "valid JSON"],
        ["[]", "plain JSON object"],
        ['{"__proto__":{}}', "reserved"],
        ['{"constructor":{}}', "reserved"],
        ['{"prototype":{}}', "reserved"],
      ] satisfies ReadonlyArray<readonly [string, string]>
    ) {
      assertThrows(
        () => parseStrictJsonObject(body, "JWT claims"),
        TypeError,
        message,
      );
    }
  });

  it("does not let a poisoned string slice bypass duplicate JSON key rejection", () => {
    const body = '{"iss":"attacker","iss":"trusted"}';
    let keySlices = 0;
    const restore = replacePropertyForTest(
      String.prototype,
      "slice",
      function (this: string, start?: number, end?: number): string {
        const actual = TestReflectApply(TestStringPrototypeSlice, this, [start, end]) as string;
        if (this === body && actual === '"iss"') {
          keySlices += 1;
          if (keySlices === 2) return '"different"';
        }
        return actual;
      },
    );

    try {
      assertThrows(
        () => parseStrictJsonObject(body, "JWT claims"),
        TypeError,
        "duplicate",
      );
    } finally {
      restore();
    }
  });

  it("does not accept inherited OIDC discovery fields", async () => {
    const inherited = {
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/token`,
      jwks_uri: `${ISSUER}/jwks.json`,
    };
    const installed: string[] = [];
    try {
      for (const [key, value] of Object.entries(inherited)) {
        TestReflectApply(TestObjectDefineProperty, Object, [
          Object.prototype,
          key,
          { value, configurable: true },
        ]);
        installed[installed.length] = key;
      }
      await assertRejects(
        () =>
          withMockFetch(
            () => Promise.resolve(jsonResponse("{}")),
            () => fetchOidcMetadata({ issuer: ISSUER }),
          ),
        TypeError,
        "issuer",
      );
    } finally {
      for (let index = 0; index < installed.length; index += 1) {
        TestReflectApply(TestReflectDeleteProperty, Reflect, [Object.prototype, installed[index]!]);
      }
    }
  });

  it("fetches the configured issuer discovery document through guarded JSON transport", async () => {
    const calls: Array<{ readonly url: string; readonly init: RequestInit | undefined }> = [];
    const result = await withMockFetch(
      (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return Promise.resolve(jsonResponse(metadata()));
      },
      () => fetchOidcMetadata({ issuer: ISSUER }),
    );

    assertEquals(result, {
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/authorize`,
      tokenEndpoint: `${ISSUER}/token`,
      jwksUri: `${ISSUER}/jwks.json`,
    });
    assertEquals(Object.isFrozen(result), true);
    assertEquals(calls.length, 1);
    assertEquals(calls[0]?.url, DISCOVERY_URL);
    const init = observeFetchRequestInit(calls[0]?.init);
    assertEquals(new Headers(init.headers).get("accept"), "application/json");
  });

  it("rejects unsafe configured issuers before any request is sent", async () => {
    for (
      const [issuer, message] of [
        ["https://user:pass@issuer.example.com", "credentials"],
        ["https://issuer.example.com/path?tenant=evil", "query"],
        ["https://issuer.example.com/path#fragment", "fragment"],
        ["https://issuer.example.com/" + "a".repeat(2_049), "issuer"],
        ["http://issuer.example.com", "HTTPS"],
      ] satisfies ReadonlyArray<readonly [string, string]>
    ) {
      let calls = 0;
      await assertRejects(
        () =>
          withMockFetch(
            () => {
              calls += 1;
              return Promise.resolve(jsonResponse(metadata()));
            },
            () => fetchOidcMetadata({ issuer }),
          ),
        TypeError,
        message,
      );
      assertEquals(calls, 0);
    }
  });

  it("allows only explicit insecure loopback development issuers", async () => {
    const loopback = "http://127.0.0.1:8787";
    const priorOverride = Deno.env.get(HOST_INTERNAL_EGRESS_OVERRIDE_ENV);
    Deno.env.set(HOST_INTERNAL_EGRESS_OVERRIDE_ENV, "1");
    let result: OidcMetadata;
    try {
      result = await withMockFetch(
        () =>
          Promise.resolve(
            jsonResponse(metadata({
              issuer: loopback,
              authorization_endpoint: `${loopback}/authorize`,
              token_endpoint: `${loopback}/token`,
              jwks_uri: `${loopback}/jwks.json`,
            })),
          ),
        () => fetchOidcMetadata({ issuer: loopback, allowInsecureLoopback: true }),
      );
    } finally {
      if (priorOverride === undefined) {
        Deno.env.delete(HOST_INTERNAL_EGRESS_OVERRIDE_ENV);
      } else {
        Deno.env.set(HOST_INTERNAL_EGRESS_OVERRIDE_ENV, priorOverride);
      }
    }

    assertEquals(result.issuer, loopback);

    let internalHttpsCalls = 0;
    await assertRejects(
      () =>
        withMockFetch(
          () => {
            internalHttpsCalls += 1;
            return Promise.resolve(jsonResponse(metadataFor("https://127.0.0.1:8787")));
          },
          () =>
            fetchOidcMetadata({
              issuer: "https://127.0.0.1:8787",
              allowInsecureLoopback: true,
            }),
        ),
      TypeError,
      "request failed",
    );
    assertEquals(internalHttpsCalls, 0);

    const internalHttpsIssuer = "https://127.0.0.1:8787";
    const priorAllowedOrigins = Deno.env.get(HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV);
    Deno.env.set(HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV, internalHttpsIssuer);
    try {
      const allowed = await withMockFetch(
        () => Promise.resolve(jsonResponse(metadataFor(internalHttpsIssuer))),
        () => fetchOidcMetadata({ issuer: internalHttpsIssuer }),
      );
      assertEquals(allowed.issuer, internalHttpsIssuer);
    } finally {
      if (priorAllowedOrigins === undefined) {
        Deno.env.delete(HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV);
      } else {
        Deno.env.set(HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS_ENV, priorAllowedOrigins);
      }
    }

    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(jsonResponse(metadata())),
          () =>
            fetchOidcMetadata({
              issuer: "http://dev.internal:8787",
              allowInsecureLoopback: true,
            }),
        ),
      TypeError,
      "loopback",
    );
  });

  it("requires exact issuer metadata and bounded canonical endpoints", async () => {
    for (
      const [overrides, message] of [
        [{ issuer: `${ISSUER}/` }, "exactly match"],
        [{ authorization_endpoint: "https://user@issuer.example.com/authorize" }, "credentials"],
        [{ token_endpoint: `${ISSUER}/token#frag` }, "fragment"],
        [{ jwks_uri: "/jwks.json" }, "absolute"],
        [{ jwks_uri: "https://evil.example.com/jwks.json" }, "trusted"],
      ] satisfies ReadonlyArray<readonly [Record<string, unknown>, string]>
    ) {
      await expectDiscoveryRejects(metadata(overrides), message);
    }
  });

  it("allows canonical trusted HTTPS endpoint origins without weakening issuer matching", async () => {
    const metadataView = await withMockFetch(
      () =>
        Promise.resolve(
          jsonResponse(metadata({
            token_endpoint: "https://tokens.example.net/oauth/token",
            jwks_uri: "https://keys.example.net/jwks",
          })),
        ),
      () =>
        fetchOidcMetadata({
          issuer: ISSUER,
          trustedEndpointOrigins: ["https://tokens.example.net", "https://keys.example.net"],
        }),
    );

    assertEquals(metadataView.tokenEndpoint, "https://tokens.example.net/oauth/token");
    assertEquals(metadataView.jwksUri, "https://keys.example.net/jwks");
  });

  it("rejects redirects, non-JSON, malformed JSON, duplicate fields, and oversized records", async () => {
    await assertRejects(
      () =>
        withMockFetch(
          () =>
            Promise.resolve(
              new Response("", {
                status: 302,
                headers: { location: "https://issuer.example.com/next" },
              }),
            ),
          () => fetchOidcMetadata({ issuer: ISSUER }),
        ),
      TypeError,
      "redirect",
    );
    await expectDiscoveryRejects(metadata(), "JSON", { headers: { "content-type": "text/plain" } });
    await expectDiscoveryRejects("{", "valid JSON");
    await expectDiscoveryRejects(
      `{"issuer":"${ISSUER}","issuer":"${ISSUER}","authorization_endpoint":"${ISSUER}/authorize","token_endpoint":"${ISSUER}/token","jwks_uri":"${ISSUER}/jwks.json"}`,
      "duplicate",
    );
    await expectDiscoveryRejects(
      `{"issuer":"${ISSUER}","authorization_endpoint":"${ISSUER}/authorize","token_endpoint":"${ISSUER}/token","jwks_uri":"${ISSUER}/jwks.json","nested":{"value":1,"value":2}}`,
      "duplicate",
    );
    await expectDiscoveryRejects(
      metadata(Object.fromEntries(
        Array.from({ length: 65 }, (_, index) => [`x${index}`, "value"]),
      )),
      "field limit",
    );
    await expectDiscoveryRejects(metadata({ x: "x".repeat(4_097) }), "string");
  });

  it("does not let poisoned JSON.parse inject OIDC metadata", async () => {
    const body = metadata();
    const restore = replacePropertyForTest(
      JSON,
      "parse",
      function (text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) {
        if (text === body) {
          return {
            issuer: ISSUER,
            authorization_endpoint: `${ISSUER}/injected-authorize`,
            token_endpoint: `${ISSUER}/injected-token`,
            jwks_uri: `${ISSUER}/injected-jwks`,
          };
        }
        return TestReflectApply(TestJSONParse, JSON, [text, reviver]);
      },
    );

    try {
      const discovered = await withMockFetch(
        () => Promise.resolve(jsonResponse(body)),
        () => fetchOidcMetadata({ issuer: ISSUER }),
      );
      assertEquals(discovered.tokenEndpoint, `${ISSUER}/token`);
    } finally {
      restore();
    }
  });

  it("aborts slow discovery requests without leaking URL queries in errors", async () => {
    const error = await assertRejects(
      () =>
        withMockFetch(
          (_input: RequestInfo | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              const signal = observeFetchRequestInit(init).signal;
              signal?.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
              );
            }),
          () => fetchOidcMetadata({ issuer: ISSUER, timeoutMs: 1 }),
        ),
      TypeError,
      "timed out",
    );
    assert(error instanceof Error);
    assertEquals(error.message.includes("?"), false);
  });

  it("aborts and cancels discovery response bodies that stall below the size bound", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        canceled = true;
      },
    });

    let fallbackTimer: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<string>((resolve) => {
      fallbackTimer = setTimeout(() => resolve("stalled"), 50);
    });
    const outcome = await Promise.race([
      withMockFetch(
        () =>
          Promise.resolve(
            new Response(stream, { headers: { "content-type": "application/json" } }),
          ),
        () => fetchOidcMetadata({ issuer: ISSUER, timeoutMs: 1 }),
      ).then(
        () => "resolved",
        (error: unknown) => error instanceof Error ? error.message : String(error),
      ),
      stalled,
    ]);
    if (fallbackTimer !== undefined) {
      clearTimeout(fallbackTimer);
    }

    assertEquals(outcome, "OIDC discovery request timed out");
    assertEquals(canceled, true);
  });

  it("cancels streaming bodies that exceed the discovery size bound", async () => {
    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(300 * 1024));
      },
      cancel() {
        canceled = true;
      },
    });

    await assertRejects(
      () =>
        withMockFetch(
          () =>
            Promise.resolve(
              new Response(stream, { headers: { "content-type": "application/json" } }),
            ),
          () => fetchOidcMetadata({ issuer: ISSUER }),
        ),
      TypeError,
      "size",
    );
    assertEquals(canceled, true);
  });

  it("caches validated metadata per instance with expiry, failed-load eviction, LRU bounds, and coalescing", async () => {
    let now = 1_000;
    let calls = 0;
    const cache = createOidcMetadataCache({ ttlSeconds: 1, maxEntries: 2, now: () => now });

    const fetcher = () =>
      withMockFetch(
        () => {
          calls += 1;
          return Promise.resolve(jsonResponse(metadata()));
        },
        () => cache.get({ issuer: ISSUER }),
      );

    assertEquals(await fetcher(), await fetcher());
    assertEquals(calls, 1);
    now += 1_001;
    await fetcher();
    assertEquals(calls, 2);

    const failingCache = createOidcMetadataCache({ ttlSeconds: 60, now: () => now });
    let failed = true;
    await assertRejects(
      () =>
        withMockFetch(
          () => {
            if (failed) return Promise.resolve(new Response("no", { status: 500 }));
            return Promise.resolve(jsonResponse(metadata()));
          },
          () => failingCache.get({ issuer: ISSUER }),
        ),
      TypeError,
      "failed",
    );
    failed = false;
    const recovered = await withMockFetch(
      () => Promise.resolve(jsonResponse(metadata())),
      () => failingCache.get({ issuer: ISSUER }),
    );
    assertEquals(recovered.issuer, ISSUER);

    const lruCache = createOidcMetadataCache({ ttlSeconds: 60, maxEntries: 2, now: () => now });
    const issuerA = "https://a.example.com";
    const issuerB = "https://b.example.com";
    const issuerC = "https://c.example.com";
    let lruCalls = 0;
    await withMockFetch(
      (input: RequestInfo | URL) => {
        lruCalls += 1;
        const issuer = String(input).replace("/.well-known/openid-configuration", "");
        return Promise.resolve(jsonResponse(metadataFor(issuer)));
      },
      async () => {
        await lruCache.get({ issuer: issuerA });
        await lruCache.get({ issuer: issuerB });
        await lruCache.get({ issuer: issuerA });
        await lruCache.get({ issuer: issuerC });
        await lruCache.get({ issuer: issuerB });
      },
    );
    assertEquals(lruCalls, 4);

    const coalescingCache = createOidcMetadataCache({ ttlSeconds: 60, now: () => now });
    let resolveFetch: ((response: Response) => void) | undefined;
    const pendingResponse = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    let coalescedCalls = 0;
    const [first, second] = await withMockFetch(
      () => {
        coalescedCalls += 1;
        return pendingResponse;
      },
      async () => {
        const firstLoad = coalescingCache.get({ issuer: ISSUER });
        const secondLoad = coalescingCache.get({ issuer: ISSUER });
        resolveFetch?.(jsonResponse(metadata()));
        return await Promise.all([firstLoad, secondLoad]);
      },
    );
    assertEquals(coalescedCalls, 1);
    assertEquals(first, second);

    const coldA = createOidcMetadataCache({ ttlSeconds: 60, now: () => now });
    const coldB = createOidcMetadataCache({ ttlSeconds: 60, now: () => now });
    let coldCalls = 0;
    await withMockFetch(
      () => {
        coldCalls += 1;
        return Promise.resolve(jsonResponse(metadata()));
      },
      async () => {
        await coldA.get({ issuer: ISSUER });
        await coldB.get({ issuer: ISSUER });
      },
    );
    assertEquals(coldCalls, 2);
  });

  it("isolates shared metadata entries by cache TTL policy", async () => {
    const cache = createOidcMetadataCache();
    let calls = 0;
    await withMockFetch(
      () => {
        calls += 1;
        return Promise.resolve(jsonResponse(metadata()));
      },
      async () => {
        await cache.get({ issuer: ISSUER }, 60);
        await cache.get({ issuer: ISSUER }, 60);
        await cache.get({ issuer: ISSUER }, 120);
      },
    );

    assertEquals(calls, 2);
  });

  it("preserves metadata tenant isolation after JSON serialization is poisoned", async () => {
    const issuerA = "https://primordial-a.example.com";
    const issuerB = "https://primordial-b.example.com";
    const bodyA = metadataFor(issuerA);
    const bodyB = metadataFor(issuerB);
    const cache = createOidcMetadataCache();
    const fetches: string[] = [];
    const restore = replacePropertyForTest(
      JSON,
      "stringify",
      function (value: unknown, ...args: unknown[]): string | undefined {
        if (
          value !== null && typeof value === "object" &&
          "issuer" in value && "trustedEndpointOrigins" in value && "ttlMs" in value
        ) {
          return '"attacker-controlled-cache-key"';
        }
        return TestReflectApply(TestJSONStringify, JSON, [value, ...args]) as string | undefined;
      },
    );

    try {
      const [metadataA, metadataB] = await withMockFetch(
        (input: RequestInfo | URL) => {
          const issuer = String(input).replace("/.well-known/openid-configuration", "");
          fetches.push(issuer);
          return Promise.resolve(jsonResponse(issuer === issuerA ? bodyA : bodyB));
        },
        async () => [
          await cache.get({ issuer: issuerA }),
          await cache.get({ issuer: issuerB }),
        ],
      );

      assertEquals(metadataA.issuer, issuerA);
      assertEquals(metadataB.issuer, issuerB);
      assertEquals(fetches, [issuerA, issuerB]);
    } finally {
      restore();
    }
  });

  it("does not let poisoned Map.get inject cached OIDC metadata", async () => {
    const cache = createOidcMetadataCache();
    const injected = {
      expiresAt: Number.POSITIVE_INFINITY,
      value: {
        issuer: ISSUER,
        authorizationEndpoint: `${ISSUER}/injected-authorize`,
        tokenEndpoint: `${ISSUER}/injected-token`,
        jwksUri: `${ISSUER}/injected-jwks`,
      },
    };
    const restore = replacePropertyForTest(
      Map.prototype,
      "get",
      function (this: Map<unknown, unknown>, key: unknown): unknown {
        if (typeof key === "string" && key.includes("oidc-metadata-cache-v1")) return injected;
        return TestReflectApply(TestMapPrototypeGet, this, [key]);
      },
    );
    let calls = 0;

    try {
      const discovered = await withMockFetch(
        () => {
          calls += 1;
          return Promise.resolve(jsonResponse(metadata()));
        },
        () => cache.get({ issuer: ISSUER }),
      );
      assertEquals(discovered.tokenEndpoint, `${ISSUER}/token`);
      assertEquals(calls, 1);
    } finally {
      restore();
    }
  });

  it("does not let poisoned Promise.resolve replace revalidated cached metadata", async () => {
    const cache = createOidcMetadataCache();
    await withMockFetch(
      () => Promise.resolve(jsonResponse(metadata())),
      () => cache.get({ issuer: ISSUER }),
    );
    const injected: OidcMetadata = {
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/injected-authorize`,
      tokenEndpoint: `${ISSUER}/injected-token`,
      jwksUri: `${ISSUER}/injected-jwks`,
    };
    const restore = replacePropertyForTest(
      Promise,
      "resolve",
      function (value: unknown): Promise<unknown> {
        const resolved = value !== null && typeof value === "object" && "issuer" in value
          ? injected
          : value;
        return TestReflectApply(TestPromiseResolve, Promise, [resolved]) as Promise<unknown>;
      },
    );

    try {
      const discovered = await cache.get({ issuer: ISSUER });
      assertEquals(discovered.tokenEndpoint, `${ISSUER}/token`);
    } finally {
      restore();
    }
  });

  it("does not let poisoned Promise.then bypass metadata validation", async () => {
    const cache = createOidcMetadataCache();
    const injected: OidcMetadata = {
      issuer: ISSUER,
      authorizationEndpoint: `${ISSUER}/injected-authorize`,
      tokenEndpoint: `${ISSUER}/injected-token`,
      jwksUri: `${ISSUER}/injected-jwks`,
    };

    const discovered = await withMockFetch(
      () => Promise.resolve(jsonResponse(metadata())),
      async () => {
        const restore = replacePropertyForTest(
          Promise.prototype,
          "then",
          function (
            this: Promise<unknown>,
            onFulfilled?: ((value: unknown) => unknown) | null,
            onRejected?: ((reason: unknown) => unknown) | null,
          ): Promise<unknown> {
            return TestReflectApply(TestPromisePrototypeThen, this, [
              (value: unknown) => {
                const replacement = value !== null && typeof value === "object" &&
                    "tokenEndpoint" in value
                  ? injected
                  : value;
                return typeof onFulfilled === "function" ? onFulfilled(replacement) : replacement;
              },
              onRejected,
            ]) as Promise<unknown>;
          },
        );
        try {
          return await cache.get({ issuer: ISSUER });
        } finally {
          restore();
        }
      },
    );

    assertEquals(discovered.tokenEndpoint, `${ISSUER}/token`);
  });

  it("does not cache mutable metadata after Object.freeze is poisoned", async () => {
    const cache = createOidcMetadataCache();
    const restore = replacePropertyForTest(Object, "freeze", <T>(value: T): T => value);
    let discovered: OidcMetadata;
    try {
      discovered = await withMockFetch(
        () => Promise.resolve(jsonResponse(metadata())),
        () => cache.get({ issuer: ISSUER }),
      );
    } finally {
      restore();
    }

    try {
      TestReflectApply(TestObjectDefineProperty, undefined, [
        discovered,
        "tokenEndpoint",
        { value: `${ISSUER}/mutated-token` },
      ]);
    } catch {
      // A captured Object.freeze keeps the provider metadata immutable.
    }
    const cached = await cache.get({ issuer: ISSUER });
    assertEquals(cached.tokenEndpoint, `${ISSUER}/token`);
    assertEquals(Object.isFrozen(cached), true);
  });

  it("revalidates cached endpoints after trusted-origin sorting is poisoned", async () => {
    const originA = "https://keys-a.example.net";
    const originB = "https://keys-b.example.net";
    const bodyA = metadata({
      token_endpoint: `${originA}/token`,
      jwks_uri: `${originA}/jwks`,
    });
    const bodyB = metadata({
      token_endpoint: `${originB}/token`,
      jwks_uri: `${originB}/jwks`,
    });
    const cache = createOidcMetadataCache();
    let calls = 0;
    const restore = replacePropertyForTest(
      Array.prototype,
      "sort",
      function (this: unknown[], ...args: unknown[]): unknown[] {
        for (let index = 0; index < this.length; index += 1) {
          if (this[index] === originA || this[index] === originB) {
            this.length = 0;
            return this;
          }
        }
        return TestReflectApply(TestArrayPrototypeSort, this, args) as unknown[];
      },
    );

    try {
      const [metadataA, metadataB] = await withMockFetch(
        () => {
          calls += 1;
          return Promise.resolve(jsonResponse(calls === 1 ? bodyA : bodyB));
        },
        async () => [
          await cache.get({ issuer: ISSUER, trustedEndpointOrigins: [originA] }),
          await cache.get({ issuer: ISSUER, trustedEndpointOrigins: [originB] }),
        ],
      );

      assertEquals(metadataA.jwksUri, `${originA}/jwks`);
      assertEquals(metadataB.jwksUri, `${originB}/jwks`);
      assertEquals(calls, 2);
    } finally {
      restore();
    }
  });

  it("bounds pending metadata loads while coalescing the admitted key and recovering after settle", async () => {
    const cache = createOidcMetadataCache({ ttlSeconds: 60, maxEntries: 1 });
    const resolvers = new Map<string, (response: Response) => void>();
    const fetches: string[] = [];
    const issuerA = "https://pending-a.example.com";
    const issuerB = "https://pending-b.example.com";

    const result = await withMockFetch(
      (input: RequestInfo | URL) => {
        const issuer = String(input).replace("/.well-known/openid-configuration", "");
        fetches.push(issuer);
        return new Promise<Response>((resolve) => {
          resolvers.set(issuer, resolve);
        });
      },
      async () => {
        const firstLoadA = cache.get({ issuer: issuerA });
        const secondLoadA = cache.get({ issuer: issuerA });
        const saturatedB = cache.get({ issuer: issuerB }).then(
          () => "resolved" as const,
          (error: unknown) => error,
        );
        await testDelay(1);
        const fetchesAtCapacity = fetches.slice();
        resolvers.get(issuerA)?.(jsonResponse(metadataFor(issuerA)));
        resolvers.get(issuerB)?.(jsonResponse(metadataFor(issuerB)));
        const [firstA, secondA, saturatedOutcome] = await Promise.all([
          firstLoadA,
          secondLoadA,
          saturatedB,
        ]);

        const recoveredB = cache.get({ issuer: issuerB });
        await testDelay(1);
        resolvers.get(issuerB)?.(jsonResponse(metadataFor(issuerB)));
        return {
          firstA,
          secondA,
          saturatedOutcome,
          recoveredB: await recoveredB,
          fetchesAtCapacity,
        };
      },
    );

    assertEquals(result.firstA, result.secondA);
    assert(result.saturatedOutcome instanceof TypeError);
    assertEquals(
      result.saturatedOutcome.message,
      "OIDC metadata cache pending load capacity reached",
    );
    assertEquals(result.recoveredB.issuer, issuerB);
    assertEquals(result.fetchesAtCapacity, [issuerA]);
    assertEquals(fetches, [issuerA, issuerB]);
  });

  it("does not let poisoned Map.has or size bypass pending metadata capacity", async () => {
    const cacheTtlSeconds = 60;
    const requestTimeoutMs = 5_000;
    const cache = createOidcMetadataCache({ ttlSeconds: cacheTtlSeconds, maxEntries: 1 });
    const issuerA = "https://pending-primordial-a.example.com";
    const issuerB = "https://pending-primordial-b.example.com";
    const issuerBCacheKey = [
      "oidc-metadata-cache-v1",
      issuerB,
      "https-only",
      `${requestTimeoutMs}`,
      `${cacheTtlSeconds * 1_000}`,
      "0",
    ].reduce((key, field) => `${key}${field.length}:${field}`, "");
    let releaseFirst: ((response: Response) => void) | undefined;
    const firstResponse = new Promise<Response>((resolve) => {
      releaseFirst = resolve;
    });
    let fetches = 0;

    await withMockFetch(
      () => {
        fetches += 1;
        return fetches === 1 ? firstResponse : Promise.resolve(jsonResponse(metadataFor(issuerB)));
      },
      async () => {
        const first = cache.get({ issuer: issuerA });
        await testDelay(1);
        const restore = [
          replacePropertyForTest(
            Map.prototype,
            "has",
            function (this: Map<unknown, unknown>, key: unknown): boolean {
              if (key === issuerBCacheKey) return true;
              return TestReflectApply(TestMapPrototypeHas, this, [key]) as boolean;
            },
          ),
          replaceGetterForTest(Map.prototype, "size", () => 0),
        ];
        try {
          await assertRejects(
            () => cache.get({ issuer: issuerB, timeoutMs: requestTimeoutMs }),
            TypeError,
            "capacity",
          );
        } finally {
          for (let index = restore.length - 1; index >= 0; index -= 1) restore[index]?.();
          releaseFirst?.(jsonResponse(metadataFor(issuerA)));
        }
        await first;
      },
    );

    assertEquals(fetches, 1);
  });
});
