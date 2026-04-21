import { assertEquals, assertRejects } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { SignJWT } from "jose";
import { verifySessionJwt } from "./verify-session-jwt.ts";

const SECRET_STR = "test-secret-for-verify-session-jwt-tests";
const OTHER_SECRET_STR = "a-different-secret-that-must-not-verify";

function secret(str = SECRET_STR): Uint8Array {
  return new TextEncoder().encode(str);
}

async function signHS256(
  payload: Record<string, unknown>,
  opts: {
    expirationTime?: string | number;
    issuer?: string;
    audience?: string;
    secretStr?: string;
  } = {},
): Promise<string> {
  let jwt = new SignJWT(payload).setProtectedHeader({ alg: "HS256" });
  if (opts.expirationTime !== undefined) jwt = jwt.setExpirationTime(opts.expirationTime);
  if (opts.issuer !== undefined) jwt = jwt.setIssuer(opts.issuer);
  if (opts.audience !== undefined) jwt = jwt.setAudience(opts.audience);
  return await jwt.sign(secret(opts.secretStr));
}

function reqWithCookie(cookie: string): Request {
  return new Request("http://localhost/", { headers: { cookie } });
}

describe("ext-jwt/verify-session-jwt", () => {
  describe("verifySessionJwt", () => {
    it("returns claims for a valid HS256 token", async () => {
      const token = await signHS256({ sub: "user123", role: "user" }, {
        expirationTime: "1h",
      });
      const req = reqWithCookie(`session=${token}`);

      const result = await verifySessionJwt(req, { secret: secret() });
      assertEquals(result?.sub, "user123");
      assertEquals(result?.role, "user");
    });

    it("rejects a forged token (no real signature)", async () => {
      const fakePayload = btoa(JSON.stringify({ sub: "victim", role: "admin" }));
      const forged = `eyJhbGciOiJIUzI1NiJ9.${fakePayload}.not-a-real-signature`;
      const req = reqWithCookie(`session=${forged}`);

      await assertRejects(() => verifySessionJwt(req, { secret: secret() }));
    });

    it("rejects an expired token", async () => {
      // Set expiration to 1 second ago.
      const expired = await signHS256({ sub: "user123" }, {
        expirationTime: Math.floor(Date.now() / 1000) - 1,
      });
      const req = reqWithCookie(`session=${expired}`);

      await assertRejects(() => verifySessionJwt(req, { secret: secret() }));
    });

    it("rejects an alg:none attack attempt", async () => {
      // Manually build an `alg: "none"` token: header.payload. (empty signature)
      const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const payload = btoa(JSON.stringify({ sub: "victim", role: "admin" }))
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const noneToken = `${header}.${payload}.`;
      const req = reqWithCookie(`session=${noneToken}`);

      await assertRejects(() => verifySessionJwt(req, { secret: secret() }));
    });

    it("rejects a token whose issuer does not match", async () => {
      const token = await signHS256({ sub: "u" }, {
        expirationTime: "1h",
        issuer: "someone-else",
      });
      const req = reqWithCookie(`session=${token}`);

      await assertRejects(() =>
        verifySessionJwt(req, { secret: secret(), issuer: "expected-issuer" })
      );
    });

    it("rejects a token whose audience does not match", async () => {
      const token = await signHS256({ sub: "u" }, {
        expirationTime: "1h",
        audience: "wrong-aud",
      });
      const req = reqWithCookie(`session=${token}`);

      await assertRejects(() =>
        verifySessionJwt(req, { secret: secret(), audience: "expected-aud" })
      );
    });

    it("returns null when the session cookie is missing", async () => {
      const req = new Request("http://localhost/");
      const result = await verifySessionJwt(req, { secret: secret() });
      assertEquals(result, null);
    });

    it("supports a custom cookie name", async () => {
      const token = await signHS256({ id: 42 }, { expirationTime: "1h" });
      const req = reqWithCookie(`auth=${token}`);

      const result = await verifySessionJwt(req, {
        secret: secret(),
        cookieName: "auth",
      });
      assertEquals(result?.id, 42);
    });

    it("returns null when the custom-named cookie is missing", async () => {
      const token = await signHS256({ id: 1 }, { expirationTime: "1h" });
      const req = reqWithCookie(`session=${token}`);

      const result = await verifySessionJwt(req, {
        secret: secret(),
        cookieName: "auth",
      });
      assertEquals(result, null);
    });

    it("throws when the secret option is missing", async () => {
      const req = new Request("http://localhost/");
      await assertRejects(
        // deno-lint-ignore no-explicit-any -- intentionally bypassing type to test runtime guard.
        () => verifySessionJwt(req, {} as any),
        Error,
        "secret is required",
      );
    });

    it("rejects a tampered payload (signature no longer matches)", async () => {
      const token = await signHS256({ sub: "user", role: "user" }, {
        expirationTime: "1h",
      });
      const [header, _payload, signature] = token.split(".");
      const tamperedPayload = btoa(JSON.stringify({ sub: "user", role: "admin" }))
        .replace(/=+$/, "")
        .replace(/\+/g, "-")
        .replace(/\//g, "_");
      const tampered = `${header}.${tamperedPayload}.${signature}`;
      const req = reqWithCookie(`session=${tampered}`);

      await assertRejects(() => verifySessionJwt(req, { secret: secret() }));
    });

    it("rejects an HS256 token signed with a different secret", async () => {
      const token = await signHS256({ sub: "u" }, {
        expirationTime: "1h",
        secretStr: OTHER_SECRET_STR,
      });
      const req = reqWithCookie(`session=${token}`);

      await assertRejects(() => verifySessionJwt(req, { secret: secret() }));
    });

    it("rejects when a non-HS256 algorithm is used and algorithms is left as default", async () => {
      // Default algorithms should be ["HS256"]. Build a token whose header declares HS512
      // but is (validly) signed with HS512 — verification should still reject because the
      // configured algorithms list does not include HS512.
      const token = await new SignJWT({ sub: "u" })
        .setProtectedHeader({ alg: "HS512" })
        .setExpirationTime("1h")
        .sign(secret());
      const req = reqWithCookie(`session=${token}`);

      await assertRejects(() => verifySessionJwt(req, { secret: secret() }));
    });
  });
});
