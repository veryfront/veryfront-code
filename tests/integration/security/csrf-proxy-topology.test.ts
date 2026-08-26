/**
 * Integration coverage for the trusted-proxy arm of `applyCsrfCookie`.
 *
 * This case cannot live beside the unit under test: `applyCsrfCookie` resolves
 * the proxy-topology decision through `isProxyTopologyTrusted()`, which reads
 * `VERYFRONT_TRUST_FORWARDED_HEADERS` from the process environment on every
 * call. Neither `CsrfConfig` nor `applyCsrfCookie` exposes a trust override, so
 * the only way to exercise the trusted arm is to mutate real process env — a
 * host effect that colocated unit tests are not allowed to perform. Every
 * hermetic CSRF assertion, including the untrusted-topology arm of this same
 * branch, stays in src/security/csrf/helpers.test.ts.
 */

import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { withEnv } from "#veryfront/testing";
import { applyCsrfCookie } from "#veryfront/security/csrf/helpers.ts";

describe("security/csrf/helpers applyCsrfCookie proxy topology", () => {
  it("should honour x-forwarded-proto once the proxy topology is trusted", async () => {
    await withEnv({ VERYFRONT_TRUST_FORWARDED_HEADERS: "1" }, () => {
      const req = new Request("http://localhost/", {
        headers: { "x-forwarded-proto": "https", accept: "text/html" },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, { cookieName: "vf_csrf" });

      assertEquals(
        headers.get("set-cookie")!.includes("Secure"),
        true,
        "a trusted proxy topology must let x-forwarded-proto mark the cookie Secure",
      );
      return Promise.resolve();
    });
  });

  it("marks both custom CSRF cookies Secure for a trusted forwarded chain", async () => {
    await withEnv({ VERYFRONT_TRUST_FORWARDED_HEADERS: "1" }, () => {
      const req = new Request("http://csrf-internal.service/page", {
        headers: {
          accept: "text/html",
          "x-forwarded-host": "app.example.com, csrf-internal.service",
          "x-forwarded-proto": "https, http",
        },
      });
      const headers = new Headers();
      applyCsrfCookie(req, headers, {
        cookieName: "vf_csrf",
        headerName: "x-vf-csrf",
      });

      const cookies = headers.getSetCookie();
      assertEquals(cookies.length, 2, "custom names publish a token and an advertisement");
      assertEquals(
        cookies.every((cookie) => cookie.includes("; Secure")),
        true,
        "the normalized public HTTPS origin must secure both browser-facing cookies",
      );
      return Promise.resolve();
    });
  });
});
