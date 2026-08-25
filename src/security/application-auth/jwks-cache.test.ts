import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { observeFetchRequestInit, withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { testDelay } from "#veryfront/testing/timing.ts";
import { createJwksCache } from "./jwks-cache.ts";

const JWKS_URI = "https://issuer.example.com/jwks.json";

const RSA_KEY = Object.freeze({
  kty: "RSA",
  kid: "rsa-1",
  use: "sig",
  alg: "RS256",
  n: "yRWj5-3TOxVFOTvZdh4XCPcg75sLUg8otZsE2FgxJmaQHemSlOtYb3yUzko7uNTn_S2u1Z3W3mitk93Ekmf_IFp8TAyQ830ODnfjIjE_XFXI-4g9iiJHWmD3Qa_3Pztp6pUBFEdpblQYNZaZrzJ9ttGHdye6PBs1MlYN6J33rsf1OnuirpN1zUXqVwFXa9ojs83R3_RIMq3oWw91e5CuCtoGNgRftxiIlK4BS5UccUcZjArShrpDElH_MU7ewHMpXJI45UlBwWK3P57jjoLR69xKBZ5CvJBozxsAny-kKK2-N85OiDnxgaoonss0AMNXoi2E_wnKSJqm33HRa0sfaw",
  e: "AQAB",
});

const RSA_ROTATED_KEY = Object.freeze({
  ...RSA_KEY,
  n: "0J7UmD-aZ5jEhhyKSOQDNN6S21hUxGSOIiHwQb9TUdYjjMplaDuYjnkja1Wwh88RHzZhA640vGh8p1_rauaboAP1Xr1-Jpc92hmWUyzr2q2KHaHSkLNkTlZ_m1vJ1hiquHMb6PwICJLi3JDl5fbi-6_-hWep5ABCp-4y4ZVyomm0k2nJWkVkvJbVND6svb4uxPAsBSV1F2rr170Om5bECsZjsy7vfpiWyEWoUeu4n5iZlVtFuxiaobAMHAn9uSgjAdOI0rOw1UtpKkMHAZAOEokJM5gWc6Nh8rWM788STOt0KzjH8Qk6MLI8dJR5UzYMw5uY6JtnkGo5xSUpJglXOQ",
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

interface GeneratedJwkSet {
  readonly rsa2048: JsonWebKey;
  readonly rsa1024: JsonWebKey;
  readonly ecP256: JsonWebKey;
}

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
  kid = "rsa-1",
  alg = "RS256",
): Promise<void> {
  const cache = createJwksCache();
  await assertRejects(
    () =>
      withMockFetch(
        () => Promise.resolve(jsonResponse(body, init)),
        () => cache.getKey({ jwksUri: JWKS_URI, kid, alg }),
      ),
    TypeError,
    message,
  );
}

describe("security/application-auth JWKS cache", () => {
  let generatedKeysPromise: Promise<GeneratedJwkSet> | undefined;

  function generatedKeys(): Promise<GeneratedJwkSet> {
    generatedKeysPromise ??= generateJwkSet();
    return generatedKeysPromise;
  }

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
      await expectJwksRejects(jwks([key]), message, {}, String(key.kid));
    }
  });

  it("validates RSA and EC public key material before caching signing keys", async () => {
    const keys = await generatedKeys();
    const validRsa = { ...keys.rsa2048, kid: "rsa-generated", alg: "RS256", use: "sig" };
    const validEc = { ...keys.ecP256, kid: "ec-generated", alg: "ES256", use: "sig" };

    const cache = createJwksCache();
    const [rsaKey, ecKey] = await withMockFetch(
      () => Promise.resolve(jsonResponse(jwks([validRsa, validEc]))),
      async () =>
        await Promise.all([
          cache.getKey({ jwksUri: JWKS_URI, kid: "rsa-generated", alg: "RS256" }),
          cache.getKey({ jwksUri: JWKS_URI, kid: "ec-generated", alg: "ES256" }),
        ]),
    );

    await crypto.subtle.importKey(
      "jwk",
      jwkForImport(rsaKey),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    await crypto.subtle.importKey(
      "jwk",
      jwkForImport(ecKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );

    for (
      const [key, message] of [
        [{ ...keys.rsa1024, kid: "rsa-small", alg: "RS256", use: "sig" }, "2048"],
        [{ ...validRsa, kid: "rsa-exponent", e: "Aw" }, "exponent"],
        [{ ...validRsa, kid: "rsa-malformed", n: "AQ" }, "2048"],
        [{ ...validEc, kid: "ec-short-x", x: "AQ" }, "coordinate"],
        [{ ...validEc, kid: "ec-short-y", y: "AQ" }, "coordinate"],
      ] satisfies ReadonlyArray<readonly [Record<string, unknown>, string]>
    ) {
      await expectJwksRejects(
        jwks([key]),
        message,
        {},
        String(key.kid),
        typeof key.alg === "string" ? key.alg : "RS256",
      );
    }

    const originalImportKey = crypto.subtle.importKey;
    let importAttempted = false;
    crypto.subtle.importKey = function (): Promise<CryptoKey> {
      importAttempted = true;
      return Promise.reject(new DOMException("forced import failure", "DataError"));
    };
    try {
      await expectJwksRejects(
        jwks([{ ...validEc, kid: "ec-not-importable" }]),
        "import",
        {},
        "ec-not-importable",
        "ES256",
      );
    } finally {
      crypto.subtle.importKey = originalImportKey;
    }
    assertEquals(importAttempted, true);
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

    let forcedMissingCalls = 0;
    await assertRejects(
      () =>
        withMockFetch(
          () => {
            forcedMissingCalls += 1;
            return Promise.resolve(jsonResponse(jwks([EC_KEY])));
          },
          () =>
            createJwksCache().getKey({
              jwksUri: JWKS_URI,
              kid: "missing",
              alg: "RS256",
              forceRefresh: true,
            }),
        ),
      TypeError,
      "kid",
    );
    assertEquals(forcedMissingCalls, 1);
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

  it("keeps pending JWKS loads coalesced under cache capacity pressure", async () => {
    const cache = createJwksCache({ ttlSeconds: 60, maxEntries: 1 });
    const resolvers = new Map<string, (response: Response) => void>();
    const fetches: string[] = [];
    const uriA = "https://pending-a.example.com/jwks";
    const uriB = "https://pending-b.example.com/jwks";

    const [firstA, secondA] = await withMockFetch(
      (input: RequestInfo | URL) => {
        const uri = String(input);
        fetches.push(uri);
        return new Promise<Response>((resolve) => {
          resolvers.set(uri, resolve);
        });
      },
      async () => {
        const firstLoadA = cache.getKey({ jwksUri: uriA, kid: "rsa-1", alg: "RS256" });
        const loadB = cache.getKey({ jwksUri: uriB, kid: "rsa-1", alg: "RS256" });
        const secondLoadA = cache.getKey({ jwksUri: uriA, kid: "rsa-1", alg: "RS256" });
        await testDelay(1);
        assertEquals(fetches, [uriA, uriB]);
        resolvers.get(uriA)?.(jsonResponse(jwks([RSA_KEY])));
        resolvers.get(uriB)?.(jsonResponse(jwks([RSA_KEY])));
        await loadB;
        return await Promise.all([firstLoadA, secondLoadA]);
      },
    );

    assertEquals(firstA, secondA);
    assertEquals(fetches, [uriA, uriB]);
  });
});

async function generateJwkSet(): Promise<GeneratedJwkSet> {
  const rsa2048Pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const rsa1024Pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 1024,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const ecP256Pair = await crypto.subtle.generateKey(
    {
      name: "ECDSA",
      namedCurve: "P-256",
    },
    true,
    ["sign", "verify"],
  );
  return {
    rsa2048: await crypto.subtle.exportKey("jwk", rsa2048Pair.publicKey),
    rsa1024: await crypto.subtle.exportKey("jwk", rsa1024Pair.publicKey),
    ecP256: await crypto.subtle.exportKey("jwk", ecP256Pair.publicKey),
  };
}

function jwkForImport(key: {
  readonly kty: "RSA" | "EC";
  readonly n?: string;
  readonly e?: string;
  readonly crv?: string;
  readonly x?: string;
  readonly y?: string;
}): JsonWebKey {
  if (key.kty === "RSA") {
    assert(typeof key.n === "string");
    assert(typeof key.e === "string");
    return { kty: "RSA", n: key.n, e: key.e };
  }
  assert(typeof key.crv === "string");
  assert(typeof key.x === "string");
  assert(typeof key.y === "string");
  return { kty: "EC", crv: key.crv, x: key.x, y: key.y };
}
