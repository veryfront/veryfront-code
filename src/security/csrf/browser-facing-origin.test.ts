import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { browserFacingOrigin } from "./helpers.ts";

describe("security/csrf/browserFacingOrigin", () => {
  it("uses the trusted browser-facing IPv6 authority instead of the internal request origin", () => {
    const request = new Request("http://csrf-internal.service:8080/page", {
      headers: {
        "x-forwarded-host": "[2001:db8::1]:8443",
        "x-forwarded-proto": "https",
      },
    });

    assertEquals(
      browserFacingOrigin(request, true),
      "https://[2001:db8::1]:8443",
      "a trusted proxy must advertise the public IPv6 authority the browser reports",
    );
    assertEquals(
      browserFacingOrigin(request, false),
      "http://csrf-internal.service:8080",
      "untrusted forwarded headers must not override the request origin",
    );
  });

  it("falls back to Host when a trusted proxy forwards only the protocol", () => {
    const request = new Request("http://csrf-internal.service/page", {
      headers: {
        host: "app.example.com:8443",
        "x-forwarded-proto": "https",
      },
    });

    assertEquals(
      browserFacingOrigin(request, true),
      "https://app.example.com:8443",
      "the advertisement origin must match the browser host even without x-forwarded-host",
    );
  });
});
