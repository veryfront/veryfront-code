/**
 * ext-jwt extension tests.
 *
 * @module extensions/ext-jwt/test
 */

import { assertEquals } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JSONWebKeySet,
  SignJWT,
} from "jose";

import factory, { type JwksResolver } from "./index.ts";

const TEST_SECRET = "test-secret-for-ext-jwt-tests";

describe("ext-jwt factory", () => {
  it("produces an Extension with name ext-jwt and an AuthProvider in provides", () => {
    const ext = factory({ secret: TEST_SECRET });
    assertEquals(ext.name, "ext-jwt");
    assertEquals(typeof ext.version, "string");
    assertEquals(Array.isArray(ext.capabilities), true);

    const provides = ext.provides;
    if (!provides) throw new Error("Expected provides to be defined");
    const auth = provides.AuthProvider as Record<string, unknown>;

    assertEquals(typeof auth.sign, "function");
    assertEquals(typeof auth.verify, "function");
    assertEquals(typeof auth.verifyWithJwks, "function");
    assertEquals(typeof auth.decode, "function");
  });
});

describe("ext-jwt AuthProvider", () => {
  it("sign → verify round-trip returns the original subject", async () => {
    const ext = factory({ secret: TEST_SECRET });
    const auth = ext.provides!.AuthProvider as {
      sign: (payload: { sub: string; [k: string]: unknown }) => Promise<string>;
      verify: (token: string) => Promise<{ sub: string; [k: string]: unknown }>;
    };

    const token = await auth.sign({ sub: "user-42", role: "admin" }, {
      expiresIn: "1h",
    });
    assertEquals(typeof token, "string");

    const payload = await auth.verify(token);
    assertEquals(payload.sub, "user-42");
    assertEquals(payload.role, "admin");
  });

  it("verify throws on tokens signed with a different secret", async () => {
    const ext = factory({ secret: TEST_SECRET });
    const auth = ext.provides!.AuthProvider as {
      verify: (token: string) => Promise<unknown>;
    };

    const foreign = await new SignJWT({ sub: "x" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("some-other-secret"));

    let threw = false;
    try {
      await auth.verify(foreign);
    } catch {
      threw = true;
    }
    assertEquals(threw, true);
  });

  it("verifyWithJwks verifies an RS256 token against an injected JWKS resolver", async () => {
    const kid = "test-rs256-key";
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const token = await new SignJWT({ sub: "user-jwks", userId: "user-123" })
      .setProtectedHeader({ alg: "RS256", kid })
      .setExpirationTime("1h")
      .sign(privateKey);

    const jwk = await exportJWK(publicKey);
    const jwks: JSONWebKeySet = {
      keys: [{ ...jwk, kid, alg: "RS256", use: "sig" }],
    };

    let factoryCalls = 0;
    const resolverFactory = (url: string): JwksResolver => {
      factoryCalls += 1;
      assertEquals(url, "https://example.test/.well-known/jwks.json");
      return createLocalJWKSet(jwks) as unknown as JwksResolver;
    };

    const ext = factory({
      secret: TEST_SECRET,
      jwksResolverFactory: resolverFactory,
    });
    const auth = ext.provides!.AuthProvider as {
      verifyWithJwks: (
        token: string,
        url: string,
        opts?: { algorithms?: string[] },
      ) => Promise<{ sub: string; userId?: string }>;
    };

    const payload = await auth.verifyWithJwks(
      token,
      "https://example.test/.well-known/jwks.json",
      { algorithms: ["RS256"] },
    );
    assertEquals(payload.sub, "user-jwks");
    assertEquals(payload.userId, "user-123");

    // Second verify against the same URL must reuse the cached resolver.
    const payload2 = await auth.verifyWithJwks(
      token,
      "https://example.test/.well-known/jwks.json",
      { algorithms: ["RS256"] },
    );
    assertEquals(payload2.sub, "user-jwks");
    assertEquals(factoryCalls, 1);
  });

  it("decode returns the protected header for a well-formed token", async () => {
    const token = await new SignJWT({ sub: "x" })
      .setProtectedHeader({ alg: "HS256", kid: "abc" })
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(TEST_SECRET));

    const ext = factory({ secret: TEST_SECRET });
    const auth = ext.provides!.AuthProvider as {
      decode: (t: string) => { alg?: string; kid?: string } | undefined;
    };

    const header = auth.decode(token);
    if (!header) throw new Error("Expected header to be defined");
    assertEquals(header.alg, "HS256");
    assertEquals(header.kid, "abc");
  });

  it("decode returns undefined for malformed input", () => {
    const ext = factory({ secret: TEST_SECRET });
    const auth = ext.provides!.AuthProvider as {
      decode: (t: string) => unknown;
    };

    assertEquals(auth.decode("not-a-jwt"), undefined);
    assertEquals(auth.decode(""), undefined);
    assertEquals(auth.decode("a.b"), undefined);
  });
});
