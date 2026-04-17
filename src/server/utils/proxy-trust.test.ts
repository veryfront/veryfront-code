import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { isProxyTrusted } from "./proxy-trust.ts";

const ENV_KEY = "VERYFRONT_TRUST_FORWARDED_HEADERS";

describe("server/utils/proxy-trust", () => {
  let previousEnv: string | undefined;

  beforeEach(() => {
    previousEnv = Deno.env.get(ENV_KEY);
    Deno.env.delete(ENV_KEY);
  });

  afterEach(() => {
    if (previousEnv === undefined) {
      Deno.env.delete(ENV_KEY);
    } else {
      Deno.env.set(ENV_KEY, previousEnv);
    }
  });

  describe("isProxyTrusted", () => {
    it("returns false when no trust signals are present", () => {
      const req = new Request("http://example.com/");
      assertEquals(isProxyTrusted(req), false);
    });

    it("returns true when x-veryfront-dispatch-jws header is present", () => {
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": "eyJhbGciOi.fake.value" },
      });
      assertEquals(isProxyTrusted(req), true);
    });

    it("returns true when x-veryfront-dispatch-jws header is present with empty string value", () => {
      // Header presence is sufficient — the JWS is validated elsewhere.
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": "" },
      });
      assertEquals(isProxyTrusted(req), true);
    });

    it("is case-insensitive on the dispatch JWS header name", () => {
      const req = new Request("http://example.com/", {
        headers: { "X-Veryfront-Dispatch-JWS": "value" },
      });
      assertEquals(isProxyTrusted(req), true);
    });

    it('returns true when VERYFRONT_TRUST_FORWARDED_HEADERS === "1"', () => {
      Deno.env.set(ENV_KEY, "1");
      const req = new Request("http://example.com/");
      assertEquals(isProxyTrusted(req), true);
    });

    it('returns false when env value is "true" (strict === "1" only)', () => {
      Deno.env.set(ENV_KEY, "true");
      const req = new Request("http://example.com/");
      assertEquals(isProxyTrusted(req), false);
    });

    it('returns false when env value is "0"', () => {
      Deno.env.set(ENV_KEY, "0");
      const req = new Request("http://example.com/");
      assertEquals(isProxyTrusted(req), false);
    });

    it("returns false when env value is an empty string", () => {
      Deno.env.set(ENV_KEY, "");
      const req = new Request("http://example.com/");
      assertEquals(isProxyTrusted(req), false);
    });

    it('returns false when env value has whitespace around "1" (strict match)', () => {
      // Fail-closed: misconfiguration should not accidentally enable trust.
      Deno.env.set(ENV_KEY, " 1 ");
      const req = new Request("http://example.com/");
      assertEquals(isProxyTrusted(req), false);
    });

    it("returns false when env var is unset", () => {
      // beforeEach already deleted it; this documents the default posture.
      const req = new Request("http://example.com/");
      assertEquals(isProxyTrusted(req), false);
    });

    it("returns true when both env opt-in and dispatch header are present", () => {
      Deno.env.set(ENV_KEY, "1");
      const req = new Request("http://example.com/", {
        headers: { "x-veryfront-dispatch-jws": "anything" },
      });
      assertEquals(isProxyTrusted(req), true);
    });
  });
});
