import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { startUpstreamServer } from "#veryfront/testing/upstream-websocket-server.ts";

describe("upstream WebSocket fixture transport ownership", () => {
  it("retires the fixture TCP transport without a peer close acknowledgment", async () => {
    const server = await startUpstreamServer();
    const peer = await Deno.connect({
      hostname: server.url.hostname,
      port: Number(server.url.port),
    });
    let teardown: Promise<void> | undefined;
    try {
      await peer.write(new TextEncoder().encode(
        `GET /_ws HTTP/1.1\r\nHost: ${server.url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`,
      ));
      const buffer = new Uint8Array(4096);
      let response = "";
      while (!response.includes("\r\n\r\n")) {
        const length = await peer.read(buffer);
        assert(length !== null, "the fixture must complete the upgrade");
        response += new TextDecoder().decode(buffer.subarray(0, length));
      }
      assert(response.startsWith("HTTP/1.1 101"));
      // Withhold close ACK: fixture teardown owns the underlying TCP connection.
      teardown = server.close();
      assertEquals(await peer.read(buffer), null, "fixture teardown must retire the TCP transport");
    } finally {
      peer.close();
      await (teardown ?? server.close());
    }
  });
});
