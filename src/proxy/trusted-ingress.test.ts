import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import {
  canonicalizeProxyIp,
  parseTrustedIngressProxyIps,
  ProxyIngressProvenanceError,
  resolveProxyIngressProvenance,
} from "./trusted-ingress.ts";

function requestFromPeer(
  peerIp: string,
  headers: HeadersInit = {},
  protocol: "http:" | "https:" = "http:",
): Request {
  const request = new Request("http://proxy.internal/", { headers });
  recordRequestPeerFromTransport(request, {
    runtime: "deno",
    transport: "tcp",
    hostname: peerIp,
    protocol,
  });
  return request;
}

describe("trusted proxy ingress provenance", () => {
  it("canonicalizes strict IPv4 and IPv6 literals", () => {
    assertEquals(canonicalizeProxyIp("203.0.113.8"), "203.0.113.8");
    assertEquals(canonicalizeProxyIp("2001:0db8::1"), "2001:db8::1");
    assertEquals(canonicalizeProxyIp("203.0.113.008"), null);
    assertEquals(canonicalizeProxyIp("203.0.113.8, 198.51.100.1"), null);
    assertEquals(canonicalizeProxyIp(" 203.0.113.8"), null);
  });

  it("parses only explicit exact trusted ingress peers", () => {
    assertEquals(
      [...parseTrustedIngressProxyIps("127.0.0.1, 2001:db8::1")],
      ["127.0.0.1", "2001:db8::1"],
    );
    assertThrows(
      () => parseTrustedIngressProxyIps("edge.internal"),
      ProxyIngressProvenanceError,
      "only valid IP addresses",
    );
  });

  it("ignores forwarded metadata from peers outside the allowlist", () => {
    const request = requestFromPeer("203.0.113.10", {
      "x-forwarded-for": "198.51.100.99",
      "x-forwarded-proto": "https",
    });
    assertEquals(
      resolveProxyIngressProvenance(request, new Set(["203.0.113.11"])),
      { clientIp: "203.0.113.10", publicProtocol: "http" },
    );
  });

  it("preserves native TLS state for a direct peer", () => {
    const request = requestFromPeer(
      "203.0.113.10",
      {
        "x-forwarded-for": "198.51.100.99",
        "x-forwarded-proto": "http",
      },
      "https:",
    );
    assertEquals(
      resolveProxyIngressProvenance(request, new Set()),
      { clientIp: "203.0.113.10", publicProtocol: "https" },
    );
  });

  it("accepts replaced public identity only from an allowlisted native peer", () => {
    const request = requestFromPeer("203.0.113.10", {
      "x-forwarded-for": "198.51.100.99",
      "x-forwarded-proto": "https",
    });
    assertEquals(
      resolveProxyIngressProvenance(request, new Set(["203.0.113.10"])),
      { clientIp: "198.51.100.99", publicProtocol: "https" },
    );
  });

  it("fails closed when ingress trust is configured without native peer provenance", () => {
    assertThrows(
      () =>
        resolveProxyIngressProvenance(
          new Request("http://proxy.internal/", {
            headers: {
              "x-forwarded-for": "198.51.100.99",
              "x-forwarded-proto": "https",
            },
          }),
          new Set(["203.0.113.10"]),
        ),
      ProxyIngressProvenanceError,
      "Native proxy peer provenance is required",
    );
  });

  it("fails closed on missing, appended, or malformed trusted metadata", () => {
    const cases: HeadersInit[] = [
      { "x-forwarded-for": "198.51.100.99" },
      { "x-forwarded-for": "198.51.100.99", "x-forwarded-proto": "HTTPS" },
      {
        "x-forwarded-for": "198.51.100.99, 203.0.113.8",
        "x-forwarded-proto": "https",
      },
    ];
    for (const headers of cases) {
      const request = requestFromPeer("203.0.113.10", headers);
      assertThrows(
        () => resolveProxyIngressProvenance(request, new Set(["203.0.113.10"])),
        ProxyIngressProvenanceError,
      );
    }
  });
});
