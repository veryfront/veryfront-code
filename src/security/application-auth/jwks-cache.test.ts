import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createJwksCache } from "./jwks-cache.ts";

const JWKS_URI = "https://issuer.example.com/jwks.json";

const RSA_KEY = Object.freeze({
  kty: "RSA",
  kid: "rsa-1",
  use: "sig",
  alg: "RS256",
  n: "sXchW0hn5SEGBkvMkNhm8JBJoYczLbrq3IypvTXqRvhBQmV0hnVzpyWenjsAl4Wt",
  e: "AQAB",
});

const RSA_ROTATED_KEY = Object.freeze({
  ...RSA_KEY,
  n: "vQv6P7aFZZqrkeRBHT6wIMSMJ5zflpOD9cEfK-Xt0DPZTymhvL6uJoVFvR-Gyt5K",
});

const EC_KEY = Object.freeze({
  kty: "EC",
  kid: "ec-1",
  use: "sig",
  alg: "ES256",
  crv: "P-256",
  x: "f83OJ3D2xF4qdt2CbzZ9FZcNCQVryDwJo6VXYiTT4j8",
  y: "x_FEzRu9d2QUQWGWxqskFZp8JjX3xq6M5J7mPcUixkU",
});

function jwks(keys: readonly Record<string, unknown>[]): string {
  return JSON.stringify({ keys });
}

function jsonResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json", ...init.headers },
    ...init,
  });
}

async function expectJwksRejects(
  body: string,
  message: string,
  init: ResponseInit = {},
): Promise<void> {
  const cache = createJwksCache();
  await assertRejects(
    () =>
      withMockFetch(
        () => Promise.resolve(jsonResponse(body, init)),
        () => cache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" }),
      ),
    TypeError,
    message,
  );
}

describe("security/application-auth JWKS cache", () => {
  it("fetches, clones, freezes, and returns only compatible public signing keys", async () => {
    const cache = createJwksCache();
    const calls: Array<RequestInit | undefined> = [];
    const key = await withMockFetch(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(init);
        return Promise.resolve(jsonResponse(jwks([RSA_KEY, EC_KEY])));
      },
      () => cache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" }),
    );

    assertEquals(key, RSA_KEY);
    assertEquals(Object.isFrozen(key), true);
    assertNotStrictEquals(key, RSA_KEY);
    assertEquals(calls.length, 1);
    assertEquals(
      new Headers(observeFetchRequestInit(calls[0]).headers).get("accept"),
      "application/json",
    );

    const cached = await withMockFetch(
      () => Promise.resolve(jsonResponse(jwks([{ ...RSA_KEY, n: "mutated" }]))),
      () => cache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" }),
    );
    assertEquals(cached.n, RSA_KEY.n);
  });

  it("rejects malformed JWKS documents and duplicate or missing key ids", async () => {
    for (
      const [body, message] of [
        [JSON.stringify({ keys: [] }), "1 through 100"],
        [JSON.stringify({ keys: [RSA_KEY], extra: true }), "top-level"],
        [jwks([{ ...RSA_KEY, kid: undefined }]), "kid"],
        [jwks([{ ...RSA_KEY, kid: "" }]), "kid"],
        [jwks([{ ...RSA_KEY, kid: "k".repeat(257) }]), "kid"],
        [jwks([{ ...RSA_KEY }, { ...RSA_KEY }]), "duplicate"],
        [
          `{"keys":[{"kty":"RSA","kid":"rsa-1","kid":"rsa-2","n":"abc","e":"AQAB"}]}`,
          "duplicate",
        ],
      ] satisfies ReadonlyArray<readonly [string, string]>
    ) {
      await expectJwksRejects(body, message);
    }
  });

  it("rejects unsupported, private, symmetric, and algorithm-incompatible keys", async () => {
    for (
      const [key, message] of [
        [{ ...RSA_KEY, kty: "oct", k: "secret" }, "public signing"],
        [{ ...RSA_KEY, d: "private" }, "private"],
        [{ ...RSA_KEY, use: "enc" }, "use"],
        [{ ...RSA_KEY, alg: "ES256" }, "compatible"],
        [{ ...RSA_KEY, key_ops: ["verify", "sign"] }, "private"],
        [{ ...EC_KEY, crv: "P-256K" }, "curve"],
        [{ ...EC_KEY, alg: "RS256" }, "compatible"],
        [{ ...EC_KEY, x: "" }, "malformed"],
      ] satisfies ReadonlyArray<readonly [Record<string, unknown>, string]>
    ) {
      await expectJwksRejects(jwks([key]), message);
    }
  });

  it("rejects non-JSON, malformed JSON, redirects, oversize bodies, and sanitized fetch failures", async () => {
    await expectJwksRejects(jwks([RSA_KEY]), "JSON", {
      headers: { "content-type": "text/html" },
    });
    await expectJwksRejects("{", "valid JSON");
    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(new Response("", { status: 301 })),
          () => createJwksCache().getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" }),
        ),
      TypeError,
      "redirect",
    );

    let canceled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(513 * 1024));
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
          () => createJwksCache().getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" }),
        ),
      TypeError,
      "size",
    );
    assertEquals(canceled, true);

    const error = await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(new Response("secret body", { status: 500 })),
          () =>
            createJwksCache().getKey({
              jwksUri: `${JWKS_URI}?token=secret`,
              kid: "rsa-1",
              alg: "RS256",
            }),
        ),
      TypeError,
      "failed",
    );
    assert(error instanceof Error);
    assertEquals(error.message.includes("secret body"), false);
    assertEquals(error.message.includes("token=secret"), false);
  });

  it("misses refresh exactly once, converges after rotation, and fails incompatible same-kid keys", async () => {
    const cache = createJwksCache({ ttlSeconds: 60 });
    let calls = 0;
    const key = await withMockFetch(
      () => {
        calls += 1;
        return Promise.resolve(
          jsonResponse(calls === 1 ? jwks([EC_KEY]) : jwks([RSA_ROTATED_KEY])),
        );
      },
      () => cache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" }),
    );

    assertEquals(calls, 2);
    assertEquals(key.n, RSA_ROTATED_KEY.n);

    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(jsonResponse(jwks([{ ...RSA_ROTATED_KEY, alg: "PS256" }]))),
          () => cache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256", forceRefresh: true }),
        ),
      TypeError,
      "compatible",
    );

    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(jsonResponse(jwks([EC_KEY]))),
          () => cache.getKey({ jwksUri: JWKS_URI, kid: "missing", alg: "RS256" }),
        ),
      TypeError,
      "kid",
    );
  });

  it("expires stale entries, evicts failed loads, bounds LRU entries, coalesces concurrency, and stays per-instance", async () => {
    let now = 1_000;
    let calls = 0;
    const cache = createJwksCache({ ttlSeconds: 1, maxEntries: 2, now: () => now });
    await withMockFetch(
      () => {
        calls += 1;
        return Promise.resolve(jsonResponse(jwks([RSA_KEY])));
      },
      async () => {
        await cache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" });
        await cache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" });
        now += 1_001;
        await cache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" });
      },
    );
    assertEquals(calls, 2);

    const failureCache = createJwksCache({ ttlSeconds: 60, now: () => now });
    let fail = true;
    await assertRejects(
      () =>
        withMockFetch(
          () =>
            fail
              ? Promise.resolve(new Response("bad", { status: 503 }))
              : Promise.resolve(jsonResponse(jwks([RSA_KEY]))),
          () => failureCache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" }),
        ),
      TypeError,
      "failed",
    );
    fail = false;
    const recovered = await withMockFetch(
      () => Promise.resolve(jsonResponse(jwks([RSA_KEY]))),
      () => failureCache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" }),
    );
    assertEquals(recovered.kid, "rsa-1");

    const lruCache = createJwksCache({ ttlSeconds: 60, maxEntries: 2, now: () => now });
    let lruCalls = 0;
    await withMockFetch(
      () => {
        lruCalls += 1;
        return Promise.resolve(jsonResponse(jwks([RSA_KEY])));
      },
      async () => {
        await lruCache.getKey({
          jwksUri: "https://a.example.com/jwks",
          kid: "rsa-1",
          alg: "RS256",
        });
        await lruCache.getKey({
          jwksUri: "https://b.example.com/jwks",
          kid: "rsa-1",
          alg: "RS256",
        });
        await lruCache.getKey({
          jwksUri: "https://a.example.com/jwks",
          kid: "rsa-1",
          alg: "RS256",
        });
        await lruCache.getKey({
          jwksUri: "https://c.example.com/jwks",
          kid: "rsa-1",
          alg: "RS256",
        });
        await lruCache.getKey({
          jwksUri: "https://b.example.com/jwks",
          kid: "rsa-1",
          alg: "RS256",
        });
      },
    );
    assertEquals(lruCalls, 4);

    const coalescingCache = createJwksCache({ ttlSeconds: 60, now: () => now });
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
        const firstLoad = coalescingCache.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" });
        const secondLoad = coalescingCache.getKey({
          jwksUri: JWKS_URI,
          kid: "rsa-1",
          alg: "RS256",
        });
        resolveFetch?.(jsonResponse(jwks([RSA_KEY])));
        return await Promise.all([firstLoad, secondLoad]);
      },
    );
    assertEquals(coalescedCalls, 1);
    assertEquals(first, second);

    const coldA = createJwksCache({ ttlSeconds: 60, now: () => now });
    const coldB = createJwksCache({ ttlSeconds: 60, now: () => now });
    let coldCalls = 0;
    await withMockFetch(
      () => {
        coldCalls += 1;
        return Promise.resolve(jsonResponse(jwks([RSA_KEY])));
      },
      async () => {
        await coldA.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" });
        await coldB.getKey({ jwksUri: JWKS_URI, kid: "rsa-1", alg: "RS256" });
      },
    );
    assertEquals(coldCalls, 2);
  });
});
