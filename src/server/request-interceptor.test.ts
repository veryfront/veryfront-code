import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isRequestFromLoopbackPeer,
  recordRequestPeerFromTransport,
  runRequestInterceptor,
} from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

describe("runRequestInterceptor", () => {
  it("preserves transport peer provenance when an interceptor replaces the request", async () => {
    const request = new Request("http://localhost/");
    recordRequestPeerFromTransport(request, {
      runtime: "deno",
      transport: "tcp",
      hostname: "127.0.0.1",
    });

    const intercepted = await runRequestInterceptor(
      request,
      (incoming) => new Request(incoming, { headers: { host: "localhost" } }),
    );

    assert(intercepted !== request);
    assertEquals(isRequestFromLoopbackPeer(intercepted), true);
  });
});
