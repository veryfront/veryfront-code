import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { base64urlEncode, base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { verifyDispatchJwsSignature } from "./control-plane.ts";

const encoder = new TextEncoder();
const MAX_AGE_SECONDS = 60;
const BASE64URL_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodePem(label: string, der: ArrayBuffer): string {
  const base64 = btoa(String.fromCharCode(...new Uint8Array(der)));
  const lines = base64.match(/.{1,64}/g) ?? [base64];
  return `-----BEGIN ${label}-----\n${lines.join("\n")}\n-----END ${label}-----`;
}

async function mintDispatchJws(
  overrides: Partial<{
    algorithm: string;
    audience: string;
    exp: number;
    iat: number;
    issuer: string;
    projectId: string;
    signingKeyPair: CryptoKeyPair;
    verificationKeyPair: CryptoKeyPair;
  }> = {},
): Promise<{ jws: string; publicKeyPem: string }> {
  const signingKeyPair = overrides.signingKeyPair ??
    await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]) as CryptoKeyPair;
  const verificationKeyPair = overrides.verificationKeyPair ?? signingKeyPair;
  const publicKeyDer = await crypto.subtle.exportKey("spki", verificationKeyPair.publicKey);
  const now = Math.floor(Date.now() / 1000);
  const encodedHeader = base64urlEncode(JSON.stringify({
    alg: overrides.algorithm ?? "EdDSA",
    typ: "JWT",
  }));
  const encodedPayload = base64urlEncode(JSON.stringify({
    iss: overrides.issuer ?? "veryfront-api",
    aud: overrides.audience ?? "demo-project",
    sub: "dispatch-signature-test",
    project_id: overrides.projectId ?? "proj-1",
    platform: "slack",
    body_sha256: "n/a",
    iat: overrides.iat ?? now,
    exp: overrides.exp ?? now + MAX_AGE_SECONDS,
  }));
  const signingInput = encoder.encode(`${encodedHeader}.${encodedPayload}`);
  const signature = await crypto.subtle.sign(
    "Ed25519",
    signingKeyPair.privateKey,
    signingInput,
  );

  return {
    publicKeyPem: encodePem("PUBLIC KEY", publicKeyDer),
    jws: `${encodedHeader}.${encodedPayload}.${base64urlEncodeBytes(new Uint8Array(signature))}`,
  };
}

function makeNonCanonicalSignatureEncoding(jws: string): string {
  const parts = jws.split(".");
  const signature = parts[2] ?? "";
  const finalCharacter = signature.at(-1) ?? "";
  const canonicalIndex = BASE64URL_ALPHABET.indexOf(finalCharacter);
  if (canonicalIndex < 0 || canonicalIndex % 16 !== 0) {
    throw new Error("Expected a canonical 64-byte Ed25519 base64url signature");
  }

  const nonCanonicalFinalCharacter = BASE64URL_ALPHABET[canonicalIndex + 1];
  return `${parts[0]}.${parts[1]}.${signature.slice(0, -1)}${nonCanonicalFinalCharacter}`;
}

describe("verifyDispatchJwsSignature", () => {
  it("accepts a validly signed, fresh dispatch JWS", async () => {
    const { jws, publicKeyPem } = await mintDispatchJws();

    assertEquals(
      await verifyDispatchJwsSignature(jws, {
        publicKeyPem,
        maxAgeSeconds: MAX_AGE_SECONDS,
      }),
      true,
    );
  });

  it("authenticates only the signature and freshness, not request scope", async () => {
    const { jws, publicKeyPem } = await mintDispatchJws({
      audience: "unrelated-audience",
      projectId: "unrelated-project",
    });

    assertEquals(
      await verifyDispatchJwsSignature(jws, {
        publicKeyPem,
        maxAgeSeconds: MAX_AGE_SECONDS,
      }),
      true,
    );
  });

  it("rejects malformed and empty compact JWS values", async () => {
    const { publicKeyPem } = await mintDispatchJws();

    for (const jws of ["", "not-a-jws", "eyJhbGciOi.fake.value"]) {
      assertEquals(
        await verifyDispatchJwsSignature(jws, {
          publicKeyPem,
          maxAgeSeconds: MAX_AGE_SECONDS,
        }),
        false,
      );
    }
  });

  it("rejects a non-canonical base64url encoding of an otherwise valid signature", async () => {
    const { jws, publicKeyPem } = await mintDispatchJws();

    assertEquals(
      await verifyDispatchJwsSignature(makeNonCanonicalSignatureEncoding(jws), {
        publicKeyPem,
        maxAgeSeconds: MAX_AGE_SECONDS,
      }),
      false,
    );
  });

  it("rejects oversized compact JWS input before parsing it", async () => {
    const { publicKeyPem } = await mintDispatchJws();
    const oversized = `${"a".repeat(20_000)}.e30.AQ`;

    assertEquals(
      await verifyDispatchJwsSignature(oversized, {
        publicKeyPem,
        maxAgeSeconds: MAX_AGE_SECONDS,
      }),
      false,
    );
  });

  it("rejects a dispatch JWS signed by a different key", async () => {
    const signingKeyPair = await crypto.subtle.generateKey(
      "Ed25519",
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;
    const verificationKeyPair = await crypto.subtle.generateKey(
      "Ed25519",
      true,
      ["sign", "verify"],
    ) as CryptoKeyPair;
    const { jws, publicKeyPem } = await mintDispatchJws({
      signingKeyPair,
      verificationKeyPair,
    });

    assertEquals(
      await verifyDispatchJwsSignature(jws, {
        publicKeyPem,
        maxAgeSeconds: MAX_AGE_SECONDS,
      }),
      false,
    );
  });

  it("rejects an unexpected issuer", async () => {
    const { jws, publicKeyPem } = await mintDispatchJws({ issuer: "attacker" });

    assertEquals(
      await verifyDispatchJwsSignature(jws, {
        publicKeyPem,
        maxAgeSeconds: MAX_AGE_SECONDS,
      }),
      false,
    );
  });

  it("rejects expired and stale dispatch JWS values", async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await mintDispatchJws({
      iat: now - 120,
      exp: now - 60,
    });
    const stale = await mintDispatchJws({
      iat: now - 3600,
      exp: now + MAX_AGE_SECONDS,
    });

    assertEquals(
      await verifyDispatchJwsSignature(expired.jws, {
        publicKeyPem: expired.publicKeyPem,
        maxAgeSeconds: MAX_AGE_SECONDS,
      }),
      false,
    );
    assertEquals(
      await verifyDispatchJwsSignature(stale.jws, {
        publicKeyPem: stale.publicKeyPem,
        maxAgeSeconds: MAX_AGE_SECONDS,
      }),
      false,
    );
  });

  it("fails closed for an invalid maximum-age configuration", async () => {
    const { jws, publicKeyPem } = await mintDispatchJws();

    for (const maxAgeSeconds of [-1, 60.5, Number.MAX_SAFE_INTEGER + 1]) {
      assertEquals(
        await verifyDispatchJwsSignature(jws, {
          publicKeyPem,
          maxAgeSeconds,
        }),
        false,
      );
    }
  });
});
