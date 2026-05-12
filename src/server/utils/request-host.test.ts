import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getEffectiveRequestHost, parseForwardedHost } from "./request-host.ts";

describe("server/utils/request-host", () => {
  describe("parseForwardedHost", () => {
    it("returns undefined for null or empty values", () => {
      assertEquals(parseForwardedHost(null), undefined);
      assertEquals(parseForwardedHost(""), undefined);
      assertEquals(parseForwardedHost("   "), undefined);
    });

    it("returns the first forwarded host entry", () => {
      assertEquals(
        parseForwardedHost("preview.veryfront.me:3000, proxy.internal"),
        "preview.veryfront.me:3000",
      );
    });

    it("trims surrounding whitespace from the selected entry", () => {
      assertEquals(
        parseForwardedHost("  preview.veryfront.me:3000  , proxy.internal"),
        "preview.veryfront.me:3000",
      );
    });
  });

  describe("getEffectiveRequestHost", () => {
    it("prefers x-forwarded-host over host and url host", () => {
      const req = new Request("http://127.0.0.1:3000/test", {
        headers: {
          "x-forwarded-host": "preview.veryfront.me:3000, proxy.internal",
          "host": "localhost:3000",
        },
      });

      assertEquals(getEffectiveRequestHost(req), "preview.veryfront.me:3000");
    });

    it("falls back to host when x-forwarded-host is absent", () => {
      const req = new Request("http://127.0.0.1:3000/test", {
        headers: { "host": "localhost:3000" },
      });

      assertEquals(getEffectiveRequestHost(req), "localhost:3000");
    });

    it("falls back to request url host when no forwarded or host headers exist", () => {
      const req = new Request("http://preview.veryfront.me:3000/test");

      assertEquals(getEffectiveRequestHost(req), "preview.veryfront.me:3000");
    });
  });
});
