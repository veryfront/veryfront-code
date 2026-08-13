import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import {
  createLocalControlAccessDeniedResponse,
  hasProxyForwardingHeaders,
  hasTrustedLocalControlAuthority,
  isTrustedLocalControlRequest,
} from "./local-control-request.ts";

function requestFromPeer(hostname?: string, headers: HeadersInit = {}): Request {
  const finalHeaders = new Headers(headers);
  if (!finalHeaders.has("host")) finalHeaders.set("host", "localhost");
  const request = new Request("http://localhost/_dev", { headers: finalHeaders });
  if (hostname !== undefined) {
    recordRequestPeerFromTransport(request, {
      runtime: "node",
      transport: "tcp",
      hostname,
    });
  }
  return request;
}

describe("local control request admission", () => {
  it("prevents content sniffing on access-denied responses", () => {
    const response = createLocalControlAccessDeniedResponse(requestFromPeer("127.0.0.1"));

    assertEquals(response.status, 403);
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  });

  it("requires transport-authenticated loopback provenance", () => {
    assertEquals(
      isTrustedLocalControlRequest(requestFromPeer("127.0.0.2"), {
        proxyTopologyTrusted: false,
      }),
      true,
    );
    assertEquals(
      isTrustedLocalControlRequest(requestFromPeer("192.168.1.25"), {
        proxyTopologyTrusted: false,
      }),
      false,
    );
    assertEquals(
      isTrustedLocalControlRequest(requestFromPeer(), { proxyTopologyTrusted: false }),
      false,
    );
  });

  it("rejects configured and header-declared proxy paths", () => {
    assertEquals(
      isTrustedLocalControlRequest(requestFromPeer("::1"), {
        proxyTopologyTrusted: true,
      }),
      false,
    );

    for (
      const header of [
        "forwarded",
        "via",
        "x-forwarded-for",
        "x-forwarded-host",
        "x-forwarded-port",
        "x-forwarded-proto",
        "x-real-ip",
      ]
    ) {
      const request = requestFromPeer("::1", { [header]: "for=203.0.113.8" });
      assertEquals(hasProxyForwardingHeaders(request), true, header);
      assertEquals(
        isTrustedLocalControlRequest(request, { proxyTopologyTrusted: false }),
        false,
        header,
      );
    }
  });

  it("admits direct and same-origin fetches but rejects sibling or cross-site browser work", () => {
    for (const fetchSite of [undefined, "none", "same-origin"] as const) {
      const headers: HeadersInit = fetchSite === undefined ? {} : { "sec-fetch-site": fetchSite };
      assertEquals(
        isTrustedLocalControlRequest(requestFromPeer("127.0.0.1", headers), {
          proxyTopologyTrusted: false,
        }),
        true,
        String(fetchSite),
      );
    }

    for (
      const fetchSite of [
        "same-site",
        "cross-site",
        "invalid",
        "same-origin".repeat(100),
      ]
    ) {
      assertEquals(
        isTrustedLocalControlRequest(
          requestFromPeer("127.0.0.1", { "sec-fetch-site": fetchSite }),
          { proxyTopologyTrusted: false },
        ),
        false,
        fetchSite,
      );
    }
  });

  it("allows only exact canonical local-control authorities", () => {
    for (
      const url of [
        "http://localhost:3000/_dev",
        "http://127.0.0.1:3000/_dev",
        "http://127.255.255.255:3000/_dev",
        "http://[::1]:3000/_dev",
        "http://[::ffff:7f00:1]:3000/_dev",
        "http://project.localhost:3000/_dev",
        "http://project.preview.localhost:3000/_dev",
        "http://lvh.me:3000/_dev",
        "http://project.lvh.me:3000/_dev",
        "http://project.preview.lvh.me:3000/_dev",
      ]
    ) {
      const parsed = new URL(url);
      assertEquals(
        hasTrustedLocalControlAuthority(
          new Request(parsed, { headers: { host: parsed.host } }),
        ),
        true,
        url,
      );
    }

    for (
      const url of [
        "http://lvh.me.attacker.example:3000/_dev",
        "http://veryfront.dev:3000/_dev",
        "http://project.veryfront.dev:3000/_dev",
        "http://production.lvh.me:3000/_dev",
        "http://project.production.lvh.me:3000/_dev",
        "http://project.staging.lvh.me:3000/_dev",
        "http://example.com.prod.lvh.me:3000/_dev",
        "http://project.unknown.lvh.me:3000/_dev",
        // `localhost` is a single label, so it has no registrable domain to key
        // the shape check on. It still gets the same shape check as the
        // two-label roots: moving the printed dev hostname onto it must not
        // promote production, staging, custom-domain simulation, unknown
        // namespaces, or arbitrarily deep names into control authorities.
        "http://production.localhost:3000/_dev",
        "http://staging.localhost:3000/_dev",
        "http://project.production.localhost:3000/_dev",
        "http://project.staging.localhost:3000/_dev",
        "http://project.unknown.localhost:3000/_dev",
        "http://example.com.prod.localhost:3000/_dev",
        "http://a.b.c.localhost:3000/_dev",
        "http://localhost.attacker.example:3000/_dev",
        "http://attacker.example:3000/_dev",
      ]
    ) {
      const parsed = new URL(url);
      assertEquals(
        hasTrustedLocalControlAuthority(
          new Request(parsed, { headers: { host: parsed.host } }),
        ),
        false,
        url,
      );
    }

    assertEquals(
      hasTrustedLocalControlAuthority(
        new Request("http://localhost:3000/_dev", {
          headers: { host: "LOCALHOST:3000" },
        }),
      ),
      false,
    );
  });
});
