import {
  assert,
  assertEquals,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
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

  it("does not tee a one-owner streaming replacement body", async () => {
    const request = new Request("http://localhost/");
    recordRequestPeerFromTransport(request, {
      runtime: "deno",
      transport: "tcp",
      hostname: "127.0.0.1",
    });
    const replacement = new Request("http://localhost/", {
      method: "POST",
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("payload"));
          controller.close();
        },
      }),
    });

    const intercepted = await runRequestInterceptor(request, () => replacement);

    assertStrictEquals(intercepted, replacement);
    assertEquals(await intercepted.text(), "payload");
  });

  it("rejects reuse before a replacement request can change provenance", async () => {
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

    assertStrictEquals(remoteIntercepted, sharedReplacement);
    assertEquals(isRequestFromLoopbackPeer(remoteIntercepted), false);
    assertEquals(isRequestFromLoopbackPeer(sharedReplacement), false);
    await assertRejects(
      () => runRequestInterceptor(localRequest, interceptor),
      TypeError,
      "Request interceptors must return a fresh replacement Request",
    );
    assertEquals(isRequestFromLoopbackPeer(remoteIntercepted), false);
    assertEquals(await remoteIntercepted.text(), "payload");
  });
});
