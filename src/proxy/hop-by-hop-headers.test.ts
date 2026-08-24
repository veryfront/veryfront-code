import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createProxyEndToEndHeaders } from "./hop-by-hop-headers.ts";

describe("proxy hop-by-hop headers", () => {
  it("removes hop-by-hop headers", () => {
    const headers = createProxyEndToEndHeaders(
      new Headers({
        Connection: "keep-alive, x-connection-owned",
        "Keep-Alive": "timeout=5",
        "Proxy-Authenticate": 'Basic realm="upstream"',
        "Proxy-Authorization": "Basic secret",
        "Proxy-Connection": "keep-alive",
        TE: "trailers",
        Trailer: "x-checksum",
        "Transfer-Encoding": "chunked",
        Upgrade: "h2c",
        "X-Connection-Owned": "remove",
        "X-End-To-End": "preserve",
      }),
    );

    assertEquals(
      [...headers],
      [["x-end-to-end", "preserve"]],
      "only end-to-end headers may survive the hop",
    );
  });

  it("ignores a malformed Connection token", () => {
    const headers = createProxyEndToEndHeaders(
      new Headers({
        // The client chooses this value, and "a b" is not a valid HTTP token, so
        // handing it to Headers.delete() would throw and turn an attacker-chosen
        // header into a 500.
        Connection: "keep-alive, a b, x-connection-owned",
        "Keep-Alive": "timeout=5",
        "X-Connection-Owned": "remove",
        "X-End-To-End": "preserve",
      }),
    );

    assertEquals(
      [...headers],
      [["x-end-to-end", "preserve"]],
      "a malformed connection token must be skipped, not raised as an error",
    );
  });
});
