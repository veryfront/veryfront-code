import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  bindSameProcessProxyContext,
  getRequestPeerProvenance,
  getSameProcessProxyContext,
  inheritRequestPeerProvenance,
  isRequestFromLoopbackPeer,
  isSameProcessProxyRequest,
  recordRequestPeerFromTransport,
  recordSameProcessProxyRequest,
  type RequestPeerRuntime,
} from "./request-peer.ts";

function requestFromPeer(hostname?: string, runtime: RequestPeerRuntime = "node"): Request {
  const request = new Request("http://localhost/");
  if (hostname !== undefined) {
    recordRequestPeerFromTransport(request, {
      runtime,
      transport: "tcp",
      hostname,
      protocol: "http:",
    });
  }
  return request;
}

describe("runtime request peer provenance", () => {
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
      protocol: "http:",
    });
    assertEquals(Object.isFrozen(first), true);

    assertEquals(
      recordRequestPeerFromTransport(request, {
        runtime: "node",
        transport: "tcp",
        hostname: "203.0.113.9",
        protocol: "https:",
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

  it("binds same-process proxy trust only to a transport-backed replacement", () => {
    const source = requestFromPeer("127.0.0.1", "deno");
    const replacement = new Request(source);

    assertStrictEquals(recordSameProcessProxyRequest(source, replacement), replacement);
    assertEquals(isSameProcessProxyRequest(source), false);
    assertEquals(isSameProcessProxyRequest(replacement), true);
    assertStrictEquals(
      getRequestPeerProvenance(replacement),
      getRequestPeerProvenance(source),
    );
    assertEquals(bindSameProcessProxyContext(source, replacement), true);
    assertStrictEquals(getSameProcessProxyContext(source), replacement);
    assertEquals(isSameProcessProxyRequest(source), true);

    const unrelatedReplacement = new Request(source);
    assertEquals(bindSameProcessProxyContext(source, unrelatedReplacement), false);
    assertEquals(getSameProcessProxyContext(source), undefined);
    assertEquals(isSameProcessProxyRequest(source), false);

    const constructedSource = requestFromPeer();
    const constructedReplacement = requestFromPeer("203.0.113.9");
    recordSameProcessProxyRequest(constructedSource, constructedReplacement);
    assertEquals(isSameProcessProxyRequest(constructedReplacement), false);
    assertEquals(getRequestPeerProvenance(constructedReplacement), undefined);
    assertEquals(
      bindSameProcessProxyContext(constructedSource, constructedReplacement),
      false,
    );
    assertEquals(getSameProcessProxyContext(constructedSource), undefined);

    recordSameProcessProxyRequest(source, source);
    assertEquals(isSameProcessProxyRequest(source), false);
  });
});
