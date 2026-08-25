import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createProxyEndToEndHeaders } from "./hop-by-hop-headers.ts";

Deno.test("proxy hop-by-hop headers", () => {
  const headers = createProxyEndToEndHeaders(
    new Headers({
      Connection: "keep-alive, x-connection-owned",
      "Keep-Alive": "timeout=5",
      "Proxy-Authorization": "Basic secret",
      TE: "trailers",
      Trailer: "x-checksum",
      "Transfer-Encoding": "chunked",
      Upgrade: "h2c",
      "X-Connection-Owned": "remove",
      "X-End-To-End": "preserve",
    }),
  );

  assertEquals([...headers], [["x-end-to-end", "preserve"]]);
});
