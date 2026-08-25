import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { createJwksCache, type JwksCache, type PublicJwk } from "./jwks-cache.ts";
import { verifyOidcIdToken } from "./id-token.ts";

const TestReflectApply = Reflect.apply;
const TestObjectDefineProperty = Object.defineProperty;
const TestObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const TestTextEncoderPrototypeEncode = TextEncoder.prototype.encode;

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

const ISSUER = "https://issuer.example.com/tenant";
const ENTRA_ISSUER = "https://login.microsoftonline.com/tenant-id/v2.0";
const CLIENT_ID = "client-123";
const NONCE = "nonce-123";
const JWKS_URI = `${ISSUER}/jwks.json`;
const NOW = 1_700_000_000;

type IdTokenAlg = "RS256" | "PS256" | "ES256";

interface KeyMaterial {
  readonly alg: IdTokenAlg;
  readonly kid: string;
  readonly publicJwk: PublicJwk;
  readonly publicKey: CryptoKey;
  readonly privateKey: CryptoKey;
}

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: ISSUER,
    sub: "user-123",
    aud: CLIENT_ID,
    exp: NOW + 300,
    iat: NOW - 10,
    nonce: NONCE,
    email: " user@example.com ",
    name: " Example User ",
    groups: ["admin", "admin", " engineering "],
    roles: ["owner"],
    ...overrides,
  };
}

function jwks(keys: readonly PublicJwk[]): string {
  return JSON.stringify({ keys });
}

function jsonResponse(body: string): Response {
  return new Response(body, { headers: { "content-type": "application/json" } });
}

describe("security/application-auth OIDC ID tokens", () => {
  let materialPromise: Promise<Record<IdTokenAlg, KeyMaterial>> | undefined;

  function material(): Promise<Record<IdTokenAlg, KeyMaterial>> {
    materialPromise ??= generateKeyMaterial();
    return materialPromise;
  }

  it("verifies a valid RS256 token before normalizing default Authelia-style claims", async () => {
    const keys = await material();
    const token = await signToken(keys.RS256, claims());

    const identity = await withMockFetch(
      () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
      () =>
        verifyOidcIdToken({
          token,
          issuer: ISSUER,
          clientId: CLIENT_ID,
          nonce: NONCE,
          jwksUri: JWKS_URI,
          jwksCache: createJwksCache(),
          now: () => NOW,
        }),
    );

    assertEquals(identity.issuer, ISSUER);
    assertEquals(identity.subject, "user-123");
    assertEquals(identity.email, "user@example.com");
    assertEquals(identity.name, "Example User");
    assertEquals(identity.groups, ["admin", "engineering"]);
    assertEquals(identity.roles, ["owner"]);
    assertEquals(identity.groupsComplete, true);
  });

  it("threads explicit loopback JWKS allowance through ID-token verification", async () => {
    const keys = await material();
    const token = await signToken(keys.RS256, claims());
    const loopbackJwksUri = "http://127.0.0.1:8787/jwks.json";

    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
          () =>
            verifyOidcIdToken({
              token,
              issuer: ISSUER,
              clientId: CLIENT_ID,
              nonce: NONCE,
              jwksUri: loopbackJwksUri,
              jwksCache: createJwksCache(),
              now: () => NOW,
            }),
        ),
      TypeError,
      "verification",
    );

    const identity = await withMockFetch(
      () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
      () =>
        verifyOidcIdToken({
          token,
          issuer: ISSUER,
          clientId: CLIENT_ID,
          nonce: NONCE,
          jwksUri: loopbackJwksUri,
          jwksCache: createJwksCache(),
          allowInsecureLoopback: true,
          now: () => NOW,
        }),
    );

    assertEquals(identity.subject, "user-123");
  });

  it("verifies configured ES256 and PS256 algorithms", async () => {
    const keys = await material();
    for (const alg of ["ES256", "PS256"] as const) {
      const token = await signToken(keys[alg], claims());
      const identity = await withMockFetch(
        () => Promise.resolve(jsonResponse(jwks([keys[alg].publicJwk]))),
        () =>
          verifyOidcIdToken({
            token,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            nonce: NONCE,
            jwksUri: JWKS_URI,
            jwksCache: createJwksCache(),
            allowedAlgorithms: [alg],
            now: () => NOW,
          }),
      );
      assertEquals(identity.subject, "user-123");
    }
  });

  it("rejects malformed, unsigned, symmetric, extension, and oversized token headers before key lookup", async () => {
    const keys = await material();
    const valid = await signToken(keys.RS256, claims());
    const validSegments = valid.split(".");
    for (
      const [token, message] of [
        [`${valid}.extra`, "three"],
        [`${validSegments[0]}..${validSegments[2]}`, "non-empty"],
        [await signToken(keys.RS256, claims(), { alg: "none" }), "algorithm"],
        [await signToken(keys.RS256, claims(), { alg: "HS256" }), "algorithm"],
        [await signToken(keys.RS256, claims(), { kid: undefined }), "kid"],
        [await signToken(keys.RS256, claims(), { kid: "" }), "kid"],
        [await signToken(keys.RS256, claims(), { kid: "k".repeat(257) }), "kid"],
        [await signToken(keys.RS256, claims(), { crit: ["exp"] }), "header"],
        [await signToken(keys.RS256, claims(), { b64: false }), "header"],
        [await signToken(keys.RS256, claims(), { jku: "https://evil.example.com/jwks" }), "header"],
        [await signToken(keys.RS256, claims(), { typ: 12 }), "typ"],
        ["a".repeat(16_385), "size"],
        [
          `${base64Url(new TextEncoder().encode("{"))}.${validSegments[1]}.${validSegments[2]}`,
          "header",
        ],
        [`${base64Url(new Uint8Array(2_049))}.${validSegments[1]}.${validSegments[2]}`, "header"],
      ] satisfies ReadonlyArray<readonly [string, string]>
    ) {
      let calls = 0;
      await assertRejects(
        () =>
          withMockFetch(
            () => {
              calls += 1;
              return Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk])));
            },
            () =>
              verifyOidcIdToken({
                token,
                issuer: ISSUER,
                clientId: CLIENT_ID,
                nonce: NONCE,
                jwksUri: JWKS_URI,
                jwksCache: createJwksCache(),
                now: () => NOW,
              }),
          ),
        TypeError,
        message,
      );
      assertEquals(calls, 0);
    }
  });

  it("rejects bad signatures and retries same-kid signature failure with one forced JWKS refresh", async () => {
    const keys = await material();
    const rotated = await generateKeyMaterial("rotated");
    const token = await signToken(keys.RS256, claims());
    const segments = token.split(".");
    const tampered = `${segments[0]}.${base64Json({ ...claims(), sub: "attacker" })}.${
      segments[2]
    }`;

    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
          () =>
            verifyOidcIdToken({
              token: tampered,
              issuer: ISSUER,
              clientId: CLIENT_ID,
              nonce: NONCE,
              jwksUri: JWKS_URI,
              jwksCache: createJwksCache(),
              now: () => NOW,
            }),
        ),
      TypeError,
      "signature",
    );

    let calls = 0;
    const identity = await withMockFetch(
      () => {
        calls += 1;
        return Promise.resolve(
          jsonResponse(jwks([calls === 1 ? rotated.RS256.publicJwk : keys.RS256.publicJwk])),
        );
      },
      () =>
        verifyOidcIdToken({
          token,
          issuer: ISSUER,
          clientId: CLIENT_ID,
          nonce: NONCE,
          jwksUri: JWKS_URI,
          jwksCache: createJwksCache(),
          now: () => NOW,
        }),
    );
    assertEquals(identity.subject, "user-123");
    assertEquals(calls, 2);
  });

  it("preserves getKey-only injected caches with one bounded forced retry", async () => {
    const keys = await material();
    const stale = await generateKeyMaterial("stale-custom-cache");
    const token = await signToken(keys.RS256, claims());
    const forceRefreshes: boolean[] = [];
    const cache: JwksCache = {
      getKey(options) {
        forceRefreshes[forceRefreshes.length] = options.forceRefresh === true;
        return Promise.resolve(
          options.forceRefresh === true ? keys.RS256.publicJwk : stale.RS256.publicJwk,
        );
      },
    };

    const identity = await verifyOidcIdToken({
      token,
      issuer: ISSUER,
      clientId: CLIENT_ID,
      nonce: NONCE,
      jwksUri: JWKS_URI,
      jwksCache: cache,
      now: () => NOW,
    });

    assertEquals(identity.subject, "user-123");
    assertEquals(forceRefreshes, [false, true]);
  });

  it("rejects a forged signature after crypto verification is poisoned", async () => {
    const keys = await material();
    const signed = await signToken(keys.RS256, claims());
    const segments = signed.split(".");
    const forged = `${segments[0]}.${base64Json({ ...claims(), sub: "attacker" })}.${segments[2]}`;
    const cache: JwksCache = {
      getKey: () => Promise.resolve(keys.RS256.publicJwk),
    };
    const originalVerify = crypto.subtle.verify;
    crypto.subtle.verify = () => Promise.resolve(true);

    try {
      await assertRejects(
        () =>
          verifyOidcIdToken({
            token: forged,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            nonce: NONCE,
            jwksUri: JWKS_URI,
            jwksCache: cache,
            now: () => NOW,
          }),
        TypeError,
        "signature",
      );
    } finally {
      crypto.subtle.verify = originalVerify;
    }
  });

  it("rejects an attacker key after crypto key import is poisoned", async () => {
    const keys = await material();
    const attacker = await generateKeyMaterial("import-attacker");
    const forged = await signToken(attacker.RS256, claims(), { kid: keys.RS256.kid });
    const cache: JwksCache = {
      getKey: () => Promise.resolve(keys.RS256.publicJwk),
    };
    const originalImportKey = crypto.subtle.importKey;
    crypto.subtle.importKey = () => Promise.resolve(attacker.RS256.publicKey);

    try {
      await assertRejects(
        () =>
          verifyOidcIdToken({
            token: forged,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            nonce: NONCE,
            jwksUri: JWKS_URI,
            jwksCache: cache,
            now: () => NOW,
          }),
        TypeError,
        "signature",
      );
    } finally {
      crypto.subtle.importKey = originalImportKey;
    }
  });

  it("rejects a wrong nonce after the TextEncoder constructor is poisoned", async () => {
    const keys = await material();
    const token = await signToken(keys.RS256, claims({ nonce: "wrong-nonce" }));
    const cache: JwksCache = {
      getKey: () => Promise.resolve(keys.RS256.publicJwk),
    };
    const nativeEncoder = new TextEncoder();
    const restore = replacePropertyForTest(
      globalThis,
      "TextEncoder",
      class PoisonedTextEncoder {
        encode(value = ""): Uint8Array {
          if (value === "wrong-nonce" || value === NONCE) return new Uint8Array([1]);
          return nativeEncoder.encode(value);
        }
      },
    );

    try {
      await assertRejects(
        () =>
          verifyOidcIdToken({
            token,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            nonce: NONCE,
            jwksUri: JWKS_URI,
            jwksCache: cache,
            now: () => NOW,
          }),
        TypeError,
        "nonce",
      );
    } finally {
      restore();
    }
  });

  it("rejects a wrong nonce after TextEncoder.encode is poisoned", async () => {
    const keys = await material();
    const token = await signToken(keys.RS256, claims({ nonce: "wrong-nonce" }));
    const cache: JwksCache = {
      getKey: () => Promise.resolve(keys.RS256.publicJwk),
    };
    const restore = replacePropertyForTest(
      TextEncoder.prototype,
      "encode",
      function (this: TextEncoder, value = ""): Uint8Array {
        const encoded = value === "wrong-nonce" || value === NONCE ? "same-nonce" : value;
        return TestReflectApply(TestTextEncoderPrototypeEncode, this, [encoded]) as Uint8Array;
      },
    );

    try {
      await assertRejects(
        () =>
          verifyOidcIdToken({
            token,
            issuer: ISSUER,
            clientId: CLIENT_ID,
            nonce: NONCE,
            jwksUri: JWKS_URI,
            jwksCache: cache,
            now: () => NOW,
          }),
        TypeError,
        "nonce",
      );
    } finally {
      restore();
    }
  });

  it("bounds forced same-kid refreshes across staggered invalid signatures", async () => {
    const keys = await material();
    const attacker = await generateKeyMaterial("staggered-attacker");
    const cache = createJwksCache({ ttlSeconds: 60 });
    const validToken = await signToken(keys.RS256, claims());
    const invalidToken = await signToken(attacker.RS256, claims(), { kid: keys.RS256.kid });
    let calls = 0;

    await withMockFetch(
      () => {
        calls += 1;
        return Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk])));
      },
      async () => {
        await verifyOidcIdToken({
          token: validToken,
          issuer: ISSUER,
          clientId: CLIENT_ID,
          nonce: NONCE,
          jwksUri: JWKS_URI,
          jwksCache: cache,
          now: () => NOW,
        });
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await assertRejects(
            () =>
              verifyOidcIdToken({
                token: invalidToken,
                issuer: ISSUER,
                clientId: CLIENT_ID,
                nonce: NONCE,
                jwksUri: JWKS_URI,
                jwksCache: cache,
                now: () => NOW,
              }),
            TypeError,
            "signature",
          );
        }
      },
    );

    assertEquals(calls, 2);
  });

  it("does not chain same-kid refreshes after a staggered verifier observes a newer generation", async () => {
    const initial = await material();
    const replacement = await generateKeyMaterial("test");
    const cache = createJwksCache({ ttlSeconds: 60 });
    const initialToken = await signToken(initial.RS256, claims());
    const replacementToken = await signToken(replacement.RS256, claims());

    await withMockFetch(
      () => Promise.resolve(jsonResponse(jwks([initial.RS256.publicJwk]))),
      () =>
        verifyOidcIdToken({
          token: initialToken,
          issuer: ISSUER,
          clientId: CLIENT_ID,
          nonce: NONCE,
          jwksUri: JWKS_URI,
          jwksCache: cache,
          now: () => NOW,
        }),
    );

    let signalRefreshStarted: (() => void) | undefined;
    const refreshStarted = new Promise<void>((resolve) => {
      signalRefreshStarted = resolve;
    });
    let releaseRefresh: (() => void) | undefined;
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve;
    });

    let refreshCalls = 0;
    try {
      const outcomes = await withMockFetch(
        async () => {
          refreshCalls += 1;
          signalRefreshStarted?.();
          await refreshGate;
          return jsonResponse(jwks([replacement.RS256.publicJwk]));
        },
        async () => {
          const verify = () =>
            verifyOidcIdToken({
              token: replacementToken,
              issuer: ISSUER,
              clientId: CLIENT_ID,
              nonce: NONCE,
              jwksUri: JWKS_URI,
              jwksCache: cache,
              now: () => NOW,
            });
          const first = verify();
          await refreshStarted;
          const second = verify();
          releaseRefresh?.();
          return await Promise.all([first, second]);
        },
      );

      assertEquals(outcomes.map((identity) => identity.subject), ["user-123", "user-123"]);
      assertEquals(refreshCalls, 1);
    } finally {
      releaseRefresh?.();
    }
  });

  it("rejects missing kids, key-type mismatches, and unknown kids without extra token-level refresh", async () => {
    const keys = await material();
    const rsaToken = await signToken(keys.RS256, claims());
    await assertRejects(
      () =>
        withMockFetch(
          () =>
            Promise.resolve(
              jsonResponse(jwks([{ ...keys.ES256.publicJwk, kid: keys.RS256.kid }])),
            ),
          () =>
            verifyOidcIdToken({
              token: rsaToken,
              issuer: ISSUER,
              clientId: CLIENT_ID,
              nonce: NONCE,
              jwksUri: JWKS_URI,
              jwksCache: createJwksCache(),
              now: () => NOW,
            }),
        ),
      TypeError,
      "key",
    );

    let calls = 0;
    const missingKidToken = await signToken(keys.RS256, claims(), { kid: "missing" });
    await assertRejects(
      () =>
        withMockFetch(
          () => {
            calls += 1;
            return Promise.resolve(jsonResponse(jwks([keys.ES256.publicJwk])));
          },
          () =>
            verifyOidcIdToken({
              token: missingKidToken,
              issuer: ISSUER,
              clientId: CLIENT_ID,
              nonce: NONCE,
              jwksUri: JWKS_URI,
              jwksCache: createJwksCache(),
              now: () => NOW,
            }),
        ),
      TypeError,
      "verification",
    );
    assertEquals(calls, 2);
  });

  it("enforces issuer, audience, azp, subject, nonce, and time claims", async () => {
    const keys = await material();
    for (
      const [overrides, message] of [
        [{ iss: `${ISSUER}/` }, "issuer"],
        [{ aud: "other-client" }, "audience"],
        [{ aud: [CLIENT_ID, "api"], azp: undefined }, "azp"],
        [{ aud: [CLIENT_ID, "api"], azp: "other-client" }, "azp"],
        [{ aud: [CLIENT_ID, CLIENT_ID] }, "audience"],
        [{ azp: "other-client" }, "azp"],
        [{ sub: "" }, "subject"],
        [{ sub: 123 }, "subject"],
        [{ sub: "line\nbreak" }, "subject"],
        [{ nonce: undefined }, "nonce"],
        [{ nonce: "wrong" }, "nonce"],
        [{ nonce: "n".repeat(257) }, "nonce"],
        [{ exp: -1 }, "exp"],
        [{ iat: -1 }, "iat"],
        [{ nbf: -1 }, "nbf"],
        [{ exp: Number.MAX_SAFE_INTEGER + 1 }, "exp"],
        [{ iat: Number.MAX_SAFE_INTEGER + 1 }, "iat"],
        [{ nbf: Number.MAX_SAFE_INTEGER + 1 }, "nbf"],
        [{ exp: NOW - 61, iat: NOW - 120 }, "expired"],
        [{ exp: NOW + 300, iat: NOW + 61 }, "issued"],
        [{ nbf: NOW + 61 }, "not yet"],
        [{ iat: NOW - 601 }, "age"],
        [{ exp: NOW - 10, iat: NOW + 10 }, "window"],
        [{ exp: NOW + 86_402, iat: NOW }, "window"],
      ] satisfies ReadonlyArray<readonly [Record<string, unknown>, string]>
    ) {
      const token = await signToken(keys.RS256, claims(overrides));
      await assertRejects(
        () =>
          withMockFetch(
            () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
            () =>
              verifyOidcIdToken({
                token,
                issuer: ISSUER,
                clientId: CLIENT_ID,
                nonce: NONCE,
                jwksUri: JWKS_URI,
                jwksCache: createJwksCache(),
                now: () => NOW,
              }),
          ),
        TypeError,
        message,
      );
    }

    const zeroToleranceToken = await signToken(keys.RS256, claims({ exp: NOW }));
    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
          () =>
            verifyOidcIdToken({
              token: zeroToleranceToken,
              issuer: ISSUER,
              clientId: CLIENT_ID,
              nonce: NONCE,
              jwksUri: JWKS_URI,
              jwksCache: createJwksCache(),
              now: () => NOW,
              clockToleranceSeconds: 0,
            }),
        ),
      TypeError,
      "expired",
    );

    const boundaryToken = await signToken(keys.RS256, claims({ exp: NOW + 60 }));
    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
          () =>
            verifyOidcIdToken({
              token: boundaryToken,
              issuer: ISSUER,
              clientId: CLIENT_ID,
              nonce: NONCE,
              jwksUri: JWKS_URI,
              jwksCache: createJwksCache(),
              now: () => NOW + 120,
            }),
        ),
      TypeError,
      "expired",
    );
  });

  it("rejects unsafe verifier inputs before token parsing or JWKS lookup", async () => {
    const keys = await material();
    const token = await signToken(keys.RS256, claims());
    for (
      const [options, message] of [
        [{ now: () => Number.NaN }, "clock"],
        [{ now: () => Number.POSITIVE_INFINITY }, "clock"],
        [{ now: () => -1 }, "clock"],
        [{ now: () => Number.MAX_SAFE_INTEGER + 1 }, "clock"],
        [{ issuer: "" }, "issuer"],
        [{ issuer: "https://issuer.example.com/" + "i".repeat(2_049) }, "issuer"],
        [{ clientId: "" }, "client ID"],
        [{ clientId: "c".repeat(2_049) }, "client ID"],
      ] satisfies ReadonlyArray<readonly [Record<string, unknown>, string]>
    ) {
      let calls = 0;
      const error = await assertRejects(
        () =>
          withMockFetch(
            () => {
              calls += 1;
              return Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk])));
            },
            () =>
              verifyOidcIdToken({
                token,
                issuer: ISSUER,
                clientId: CLIENT_ID,
                nonce: NONCE,
                jwksUri: JWKS_URI,
                jwksCache: createJwksCache(),
                ...options,
              }),
          ),
        TypeError,
        message,
      );
      assert(error instanceof Error);
      assertEquals(calls, 0);
      assertEquals(error.message.includes("issuer.example.com"), false);
      assertEquals(error.message.includes("client-123"), false);
    }
  });

  it("normalizes Microsoft Entra claims, custom claim names, optional absence, and group overage", async () => {
    const keys = await material();
    const entraClaims = claims({
      iss: ENTRA_ISSUER,
      sub: "entra-user",
      aud: [CLIENT_ID, "api://resource"],
      azp: CLIENT_ID,
      preferred_username: "entra@example.com",
      display_name: "Entra User",
      app_roles: ["Reader", "Writer"],
      security_groups: ["group-a"],
      _claim_names: { groups: "src1" },
      _claim_sources: { src1: { endpoint: "https://graph.example.com/groups" } },
      email: undefined,
      name: undefined,
      groups: undefined,
      roles: undefined,
    });
    const entraToken = await signToken(keys.RS256, entraClaims);
    const identity = await withMockFetch(
      () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
      () =>
        verifyOidcIdToken({
          token: entraToken,
          issuer: ENTRA_ISSUER,
          clientId: CLIENT_ID,
          nonce: NONCE,
          jwksUri: JWKS_URI,
          jwksCache: createJwksCache(),
          now: () => NOW,
          claimNames: {
            email: "preferred_username",
            name: "display_name",
            groups: "security_groups",
            roles: "app_roles",
          },
        }),
    );

    assertEquals(identity.email, "entra@example.com");
    assertEquals(identity.name, "Entra User");
    assertEquals(identity.groups, ["group-a"]);
    assertEquals(identity.roles, ["Reader", "Writer"]);
    assertEquals(identity.groupsComplete, false);

    const missingOptionalToken = await signToken(
      keys.RS256,
      claims({ email: undefined, name: undefined }),
    );
    const missingOptional = await withMockFetch(
      () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
      () =>
        verifyOidcIdToken({
          token: missingOptionalToken,
          issuer: ISSUER,
          clientId: CLIENT_ID,
          nonce: NONCE,
          jwksUri: JWKS_URI,
          jwksCache: createJwksCache(),
          now: () => NOW,
        }),
    );
    assertEquals(missingOptional.email, undefined);
    assertEquals(missingOptional.name, undefined);

    const invalidGroupsToken = await signToken(keys.RS256, claims({ groups: ["ok", 1] }));
    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
          () =>
            verifyOidcIdToken({
              token: invalidGroupsToken,
              issuer: ISSUER,
              clientId: CLIENT_ID,
              nonce: NONCE,
              jwksUri: JWKS_URI,
              jwksCache: createJwksCache(),
              now: () => NOW,
            }),
        ),
      TypeError,
      "groups",
    );

    const invalidEmailToken = await signToken(keys.RS256, claims({ email: 1 }));
    await assertRejects(
      () =>
        withMockFetch(
          () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
          () =>
            verifyOidcIdToken({
              token: invalidEmailToken,
              issuer: ISSUER,
              clientId: CLIENT_ID,
              nonce: NONCE,
              jwksUri: JWKS_URI,
              jwksCache: createJwksCache(),
              now: () => NOW,
            }),
        ),
      TypeError,
      "email",
    );
  });

  it("rejects malformed payload JSON, duplicate claims, non-object claims, and redacts sensitive values", async () => {
    const keys = await material();
    const valid = await signToken(keys.RS256, claims({ sub: "secret-subject" }));
    const validSegments = valid.split(".");
    assertEquals(validSegments.length, 3);
    const header = validSegments[0];
    const signature = validSegments[2];
    assert(header !== undefined);
    assert(signature !== undefined);
    const malformed = `${header}.${base64Url(new TextEncoder().encode('{"iss":'))}.${signature}`;
    const duplicate = await signRaw(keys.RS256, header, `{"iss":"${ISSUER}","iss":"${ISSUER}"}`);
    const arrayPayload = await signRaw(keys.RS256, header, "[]");

    for (const token of [malformed, duplicate, arrayPayload]) {
      const error = await assertRejects(
        () =>
          withMockFetch(
            () => Promise.resolve(jsonResponse(jwks([keys.RS256.publicJwk]))),
            () =>
              verifyOidcIdToken({
                token,
                issuer: ISSUER,
                clientId: CLIENT_ID,
                nonce: "secret-nonce",
                jwksUri: `${JWKS_URI}?token=secret`,
                jwksCache: createJwksCache(),
                now: () => NOW,
              }),
          ),
        TypeError,
      );
      assert(error instanceof Error);
      assertEquals(error.message.includes("secret"), false);
      assertEquals(error.message.includes(header), false);
    }
  });
});

async function generateKeyMaterial(prefix = "test"): Promise<Record<IdTokenAlg, KeyMaterial>> {
  const rsaPkcs = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const rsaPss = await crypto.subtle.generateKey(
    {
      name: "RSA-PSS",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  );
  const ec = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  return {
    RS256: await exportMaterial("RS256", `${prefix}-rsa`, rsaPkcs),
    PS256: await exportMaterial("PS256", `${prefix}-pss`, rsaPss),
    ES256: await exportMaterial("ES256", `${prefix}-ec`, ec),
  };
}

async function exportMaterial(
  alg: IdTokenAlg,
  kid: string,
  pair: CryptoKeyPair,
): Promise<KeyMaterial> {
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicJwk: PublicJwk = Object.freeze({
    ...(alg === "ES256"
      ? { kty: "EC" as const, crv: jwk.crv, x: jwk.x, y: jwk.y }
      : { kty: "RSA" as const, n: jwk.n, e: jwk.e }),
    kid,
    alg,
    use: "sig" as const,
  });
  return { alg, kid, publicJwk, publicKey: pair.publicKey, privateKey: pair.privateKey };
}

async function signToken(
  material: KeyMaterial,
  payload: Record<string, unknown> | Promise<Record<string, unknown>>,
  headerOverrides: Record<string, unknown> = {},
): Promise<string> {
  const header = base64Json({
    alg: material.alg,
    kid: material.kid,
    typ: "JWT",
    ...headerOverrides,
  });
  const body = base64Json(await payload);
  return await signRaw(material, header, new TextDecoder().decode(decodeBase64Url(body)));
}

async function signRaw(
  material: KeyMaterial,
  header: string,
  payloadJson: string,
): Promise<string> {
  const body = base64Url(new TextEncoder().encode(payloadJson));
  const signingInput = `${header}.${body}`;
  const signature = await crypto.subtle.sign(
    signingAlgorithm(material.alg),
    material.privateKey,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64Url(new Uint8Array(signature))}`;
}

function signingAlgorithm(alg: IdTokenAlg): AlgorithmIdentifier | RsaPssParams | EcdsaParams {
  if (alg === "PS256") return { name: "RSA-PSS", saltLength: 32 };
  if (alg === "ES256") return { name: "ECDSA", hash: "SHA-256" };
  return { name: "RSASSA-PKCS1-v1_5" };
}

function base64Json(value: unknown): string {
  return base64Url(new TextEncoder().encode(JSON.stringify(value)));
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string): Uint8Array {
  const padded = `${value.replaceAll("-", "+").replaceAll("_", "/")}${
    "=".repeat((4 - value.length % 4) % 4)
  }`;
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}
