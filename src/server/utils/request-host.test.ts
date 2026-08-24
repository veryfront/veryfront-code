import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getEffectiveRequestHost,
  getEffectiveRequestOrigin,
  parseForwardedHost,
} from "./request-host.ts";

describe("server/utils/request-host", () => {
  describe("parseForwardedHost", () => {
    it("returns undefined for null or empty values", () => {
      assertEquals(parseForwardedHost(null), undefined);
      assertEquals(parseForwardedHost(""), undefined);
      assertEquals(parseForwardedHost("   "), undefined);
    });

    it("returns the first forwarded host entry", () => {
      assertEquals(
        parseForwardedHost("preview.localhost:3000, proxy.internal"),
        "preview.localhost:3000",
      );
    });

    it("trims surrounding whitespace from the selected entry", () => {
      assertEquals(
        parseForwardedHost("  preview.localhost:3000  , proxy.internal"),
        "preview.localhost:3000",
      );
    });
  });

  describe("getEffectiveRequestHost", () => {
    it("ignores x-forwarded-host by default (untrusted) and uses the host header", () => {
      const req = new Request("http://127.0.0.1:3000/test", {
        headers: {
          "x-forwarded-host": "preview.localhost:3000, proxy.internal",
          "host": "localhost:3000",
        },
      });

      // Default is untrusted: a client-supplied x-forwarded-host must not be
      // honoured (would allow Host/origin spoofing). Fall back to Host header.
      assertEquals(getEffectiveRequestHost(req), "localhost:3000");
    });

    it("prefers x-forwarded-host over host and url host when proxy is trusted", () => {
      const req = new Request("http://127.0.0.1:3000/test", {
        headers: {
          "x-forwarded-host": "preview.localhost:3000, proxy.internal",
          "host": "localhost:3000",
        },
      });

      assertEquals(
        getEffectiveRequestHost(req, undefined, true),
        "preview.localhost:3000",
      );
    });

    it("falls back to host when x-forwarded-host is absent", () => {
      const req = new Request("http://127.0.0.1:3000/test", {
        headers: { "host": "localhost:3000" },
      });

      assertEquals(getEffectiveRequestHost(req), "localhost:3000");
    });

    it("falls back to request url host when no forwarded or host headers exist", () => {
      const req = new Request("http://preview.localhost:3000/test");

      assertEquals(getEffectiveRequestHost(req), "preview.localhost:3000");
    });
  });

  describe("getEffectiveRequestOrigin", () => {
    it("uses the forwarded protocol and host only for a trusted proxy", () => {
      const req = new Request("http://runtime.internal/test", {
        headers: {
          "host": "runtime.internal",
          "x-forwarded-host": "app.example.com:8443",
          "x-forwarded-proto": "https",
        },
      });

      assertEquals(getEffectiveRequestOrigin(req, undefined, true), "https://app.example.com:8443");
      assertEquals(getEffectiveRequestOrigin(req), "http://runtime.internal");
    });

    it("fails closed when a trusted forwarded protocol is invalid", () => {
      const req = new Request("http://runtime.internal/test", {
        headers: {
          "x-forwarded-host": "app.example.com",
          "x-forwarded-proto": "javascript",
        },
      });

      assertEquals(getEffectiveRequestOrigin(req, undefined, true), null);
    });

    it("fails closed when a trusted forwarded host carries a path", () => {
      const req = new Request("http://runtime.internal/test", {
        headers: {
          "x-forwarded-host": "app.example.com/@victim.example.com",
          "x-forwarded-proto": "https",
        },
      });

      assertEquals(
        getEffectiveRequestOrigin(req, undefined, true),
        null,
        "a redirect or CSP decision must not be made against an attacker shaped origin with a path",
      );
    });

    it("fails closed when a trusted forwarded host carries credentials", () => {
      const req = new Request("http://runtime.internal/test", {
        headers: {
          "x-forwarded-host": "user:pass@app.example.com",
          "x-forwarded-proto": "https",
        },
      });

      assertEquals(
        getEffectiveRequestOrigin(req, undefined, true),
        null,
        "embedded credentials must not yield an origin for redirect or CSP policy",
      );
    });

    it("fails closed when a trusted forwarded host carries a query", () => {
      const req = new Request("http://runtime.internal/test", {
        headers: {
          "x-forwarded-host": "app.example.com?x=1",
          "x-forwarded-proto": "https",
        },
      });

      assertEquals(
        getEffectiveRequestOrigin(req, undefined, true),
        null,
        "a query in the forwarded host must not yield an origin for redirect or CSP policy",
      );
    });

    it("fails closed when a trusted forwarded host exceeds the length limit", () => {
      const req = new Request("http://runtime.internal/test", {
        headers: {
          "x-forwarded-host": "a".repeat(3_000),
          "x-forwarded-proto": "https",
        },
      });

      assertEquals(
        getEffectiveRequestOrigin(req, undefined, true),
        null,
        "an oversized forwarded host must not yield an origin for redirect or CSP policy",
      );
    });
  });
});
