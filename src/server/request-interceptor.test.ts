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

  it("isolates provenance when overlapping calls reuse one replacement request", async () => {
    const remoteRequest = new Request("http://localhost/");
    recordRequestPeerFromTransport(remoteRequest, {
      runtime: "deno",
      transport: "tcp",
      hostname: "192.0.2.10",
    });
    const localRequest = new Request("http://localhost/");
    recordRequestPeerFromTransport(localRequest, {
      runtime: "deno",
      transport: "tcp",
      hostname: "127.0.0.1",
    });
    const sharedReplacement = new Request("http://localhost/", {
      method: "POST",
      body: "payload",
    });
    const interceptor = () => sharedReplacement;

    const remoteIntercepted = await runRequestInterceptor(remoteRequest, interceptor);
    const localIntercepted = await runRequestInterceptor(localRequest, interceptor);

    assert(remoteIntercepted !== localIntercepted);
    assertEquals(isRequestFromLoopbackPeer(remoteIntercepted), false);
    assertEquals(isRequestFromLoopbackPeer(localIntercepted), true);
    assertEquals(isRequestFromLoopbackPeer(sharedReplacement), false);
    assertEquals(
      await Promise.all([
        remoteIntercepted.text(),
        localIntercepted.text(),
        sharedReplacement.text(),
      ]),
      ["payload", "payload", "payload"],
    );
  });
});
