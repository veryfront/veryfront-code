import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getRequestPeerProvenance,
  inheritRequestPeerProvenance,
  isRequestFromLoopbackPeer,
  recordDenoServeRequestPeer,
  recordHandlerRequestPeer,
  recordRequestPeerFromTransport,
  type RequestPeerRuntime,
} from "./request-peer.ts";

function requestFromPeer(hostname?: string, runtime: RequestPeerRuntime = "node"): Request {
  const request = new Request("http://localhost/");
  if (hostname !== undefined) {
    recordRequestPeerFromTransport(request, { runtime, transport: "tcp", hostname });
  }
  return request;
}

describe("runtime request peer provenance", () => {
  it("records a Deno.serve peer before a portable handler reads the request", () => {
    const request = new Request("http://localhost/_projects");

    assertEquals(
      recordDenoServeRequestPeer(request, {
        remoteAddr: {
          transport: "tcp",
          hostname: "::1",
          port: 52_000,
        },
      }),
      true,
    );
    assertEquals(getRequestPeerProvenance(request), {
      runtime: "deno",
      transport: "tcp",
      hostname: "::1",
    });
    assertEquals(isRequestFromLoopbackPeer(request), true);
  });

  it("records a framework-hosted Node request from its native transport", () => {
    const request = new Request("http://localhost/_projects");

    assertEquals(
      recordHandlerRequestPeer(request, {
        socket: { remoteAddress: "127.0.0.1" },
      }),
      true,
    );
    assertEquals(getRequestPeerProvenance(request), {
      runtime: "node",
      transport: "tcp",
      hostname: "127.0.0.1",
    });
    assertEquals(isRequestFromLoopbackPeer(request), true);
  });

  it("recognizes loopback peers across canonical transport representations", () => {
    for (
      const hostname of [
        "127.0.0.1",
        "127.0.0.2",
        "127.255.255.255",
        "::1",
        "0:0:0:0:0:0:0:1",
        "::ffff:127.0.0.1",
        "::ffff:127.255.255.255",
        "::ffff:7f00:1",
        "0:0:0:0:0:ffff:7f00:1",
      ]
    ) {
      assertEquals(isRequestFromLoopbackPeer(requestFromPeer(hostname)), true, hostname);
    }
  });

  it("rejects private, public, mapped non-loopback, malformed, and missing peers", () => {
    for (
      const hostname of [
        "10.0.0.1",
        "192.168.1.25",
        "203.0.113.8",
        "::ffff:10.0.0.1",
        "::ffff:192.168.1.25",
        "::ffff:c0a8:119",
        "2001:db8::1",
        "::127.0.0.1",
        "127.1",
        "127.00.0.1",
        "127.0.0.256",
        "[::1]",
        "fe80::1%lo0",
        "not-an-address",
      ]
    ) {
      assertEquals(isRequestFromLoopbackPeer(requestFromPeer(hostname)), false, hostname);
    }
    assertEquals(isRequestFromLoopbackPeer(requestFromPeer()), false);
  });

  it("records an immutable first transport observation", () => {
    const request = requestFromPeer("127.0.0.1", "deno");
    const first = getRequestPeerProvenance(request);
    assertEquals(first, {
      runtime: "deno",
      transport: "tcp",
      hostname: "127.0.0.1",
    });
    assertEquals(Object.isFrozen(first), true);

    assertEquals(
      recordRequestPeerFromTransport(request, {
        runtime: "node",
        transport: "tcp",
        hostname: "203.0.113.9",
      }),
      false,
    );
    assertStrictEquals(getRequestPeerProvenance(request), first);
  });

  it("copies existing authority and clears authority when the source has none", () => {
    const source = requestFromPeer("::ffff:127.0.0.1", "bun");
    const target = requestFromPeer("203.0.113.9");
    assertStrictEquals(inheritRequestPeerProvenance(source, target), target);
    assertStrictEquals(getRequestPeerProvenance(target), getRequestPeerProvenance(source));
    assertEquals(isRequestFromLoopbackPeer(target), true);

    const untrustedSource = requestFromPeer();
    inheritRequestPeerProvenance(untrustedSource, target);
    assertEquals(getRequestPeerProvenance(target), undefined);
    assertEquals(isRequestFromLoopbackPeer(target), false);
  });
});
