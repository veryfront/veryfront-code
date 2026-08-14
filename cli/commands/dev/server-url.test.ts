import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serverDisplayUrl } from "./server-url.ts";

describe("cli/commands/dev/server-url", () => {
  describe("serverDisplayUrl", () => {
    it("names the address the server actually bound, not `localhost`", () => {
      // The dev server binds LOCALHOST.IPV4. `localhost` resolves to ::1 first
      // on a dual-stack host, so printing the name points at an address the
      // server is not listening on.
      assertEquals(serverDisplayUrl("127.0.0.1", 3000), "http://127.0.0.1:3000");
    });

    it("brackets an IPv6 address so the URL is valid", () => {
      assertEquals(serverDisplayUrl("::1", 3000), "http://[::1]:3000");
    });

    it("shows a loopback address when the server bound a wildcard", () => {
      // A wildcard is a bind target, not somewhere to browse to.
      assertEquals(serverDisplayUrl("0.0.0.0", 3000), "http://127.0.0.1:3000");
      assertEquals(serverDisplayUrl("::", 3000), "http://[::1]:3000");
    });

    it("keeps a specific non-loopback address", () => {
      assertEquals(serverDisplayUrl("192.168.1.5", 3000), "http://192.168.1.5:3000");
    });
  });
});
