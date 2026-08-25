import "#veryfront/schemas/_test-setup.ts";
import { HOST_INTERNAL_EGRESS_OVERRIDE_ENV } from "#veryfront/security/http/outbound-fetch.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createOidcMetadataCache, fetchOidcMetadata, type OidcMetadata } from "./oidc-metadata.ts";

const ISSUER = "https://issuer.example.com/tenant";
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

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
});
