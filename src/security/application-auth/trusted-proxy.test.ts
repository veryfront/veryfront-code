import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { createTrustedProxyApplicationAuthRuntime } from "./trusted-proxy.ts";
import type { TrustedProxyAuthConfig } from "#veryfront/security/http/middleware/types.ts";

const APP_URL = "https://app.example.test/dashboard";

function config(
  overrides: Partial<TrustedProxyAuthConfig> = {},
): TrustedProxyAuthConfig {
  return {
    trustedPeers: ["127.0.0.1"],
    headers: {
      subject: "x-auth-subject",
      email: "x-auth-email",
      name: "x-auth-name",
      groups: "x-auth-groups",
      roles: "x-auth-roles",
    },
    ...overrides,
  };
}

function request(
  headers: HeadersInit = { "x-auth-subject": "user-123" },
  peer = "127.0.0.1",
): Request {
  const request = new Request(APP_URL, { headers });
  recordRequestPeerFromTransport(request, {
    runtime: "node",
    transport: "tcp",
    hostname: peer,
  });
  return request;
}

async function admit(
  cfg: TrustedProxyAuthConfig,
  req: Request = request(),
): Promise<
  Awaited<ReturnType<ReturnType<typeof createTrustedProxyApplicationAuthRuntime>["admitRequest"]>>
> {
  return await createTrustedProxyApplicationAuthRuntime({ config: cfg }).admitRequest(req);
}

function assertUnauthorized(response: unknown): asserts response is Response {
  assert(response instanceof Response, "expected a generic unauthorized response");
  assertEquals(response.status, 401);
  assertEquals(response.headers.get("Cache-Control"), "no-store");
  assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
}

describe("security/application-auth trusted proxy runtime", () => {
  it("admits asserted identity only for exact native IPv4 peer provenance", async () => {
    const result = await admit(
      config(),
      request({
        "host": "attacker.example.test",
        "forwarded": "for=198.51.100.9",
        "x-forwarded-for": "198.51.100.9",
        "x-real-ip": "198.51.100.9",
        "x-auth-subject": "user-123",
        "x-auth-email": " user@example.test ",
        "x-auth-name": " User Name ",
      }),
    );

    assert(!(result instanceof Response));
    assertEquals(result.identity.issuer, "veryfront:trusted-proxy");
    assertEquals(result.identity.subject, "user-123");
    assertEquals(result.identity.email, "user@example.test");
    assertEquals(result.identity.name, "User Name");
    assertEquals(result.identity.groupsComplete, true);
    assertEquals(Object.isFrozen(result.identity), true);
    assertEquals(result.identityHeaderNames, [
      "x-auth-subject",
      "x-auth-email",
      "x-auth-name",
      "x-auth-groups",
      "x-auth-roles",
    ]);
    assertEquals(Object.isFrozen(result.identityHeaderNames), true);
  });

  it("canonicalizes IPv6 and mapped IPv6 peers before exact matching", async () => {
    const expanded = await admit(
      config({ trustedPeers: ["2001:db8::1"] }),
      request({ "x-auth-subject": "ipv6-user" }, "2001:0db8:0000:0000:0000:0000:0000:0001"),
    );
    const mapped = await admit(
      config({ trustedPeers: ["192.0.2.10"] }),
      request({ "x-auth-subject": "mapped-user" }, "::ffff:192.0.2.10"),
    );

    assert(!(expanded instanceof Response));
    assertEquals(expanded.identity.subject, "ipv6-user");
    assert(!(mapped instanceof Response));
    assertEquals(mapped.identity.subject, "mapped-user");
  });

  it("rejects missing, wrong, hostname, and CIDR peer provenance without consulting spoofable headers", async () => {
    const noPeer = await admit(
      config(),
      new Request(APP_URL, {
        headers: {
          host: "127.0.0.1",
          forwarded: "for=127.0.0.1",
          "x-forwarded-for": "127.0.0.1",
          "x-real-ip": "127.0.0.1",
          "x-auth-subject": "user-123",
        },
      }),
    );
    const wrongPeer = await admit(
      config(),
      request({ "x-forwarded-for": "127.0.0.1", "x-auth-subject": "user-123" }, "198.51.100.3"),
    );
    const hostnamePeer = await admit(
      config({ trustedPeers: ["proxy.internal"] }),
      request({ "x-auth-subject": "user-123" }, "proxy.internal"),
    );
    const cidrPeer = await admit(
      config({ trustedPeers: ["127.0.0.1/32"] }),
      request({ "x-auth-subject": "user-123" }),
    );

    assertUnauthorized(noPeer);
    assertUnauthorized(wrongPeer);
    assertUnauthorized(hostnamePeer);
    assertUnauthorized(cidrPeer);
  });

  it("rejects semantically duplicate configured peers", async () => {
    const result = await admit(
      config({ trustedPeers: ["192.0.2.10", "::ffff:192.0.2.10"] }),
      request({ "x-auth-subject": "user-123" }, "192.0.2.10"),
    );

    assertUnauthorized(result);
  });

  it("rejects forbidden authority header names as asserted identity headers", async () => {
    for (
      const headers of [
        { subject: "host" },
        { subject: "forwarded" },
        { subject: "via" },
        { subject: "x-real-ip" },
        { subject: "x-forwarded-user" },
      ]
    ) {
      const result = await admit(config({ headers }), request({ host: "user-123" }));
      assertUnauthorized(result);
    }
  });

  it("fails closed for accessor, prototype, and proxy-backed runtime config", async () => {
    const accessorConfig = {
      trustedPeers: ["127.0.0.1"],
      headers: Object.defineProperty({}, "subject", {
        enumerable: true,
        get() {
          throw new Error("must not invoke");
        },
      }),
    } as TrustedProxyAuthConfig;
    const inheritedConfig = Object.create({ trustedPeers: ["127.0.0.1"] });
    Object.defineProperty(inheritedConfig, "headers", {
      enumerable: true,
      value: { subject: "x-auth-subject" },
    });
    const proxyConfig = new Proxy(config(), {
      getOwnPropertyDescriptor() {
        throw new Error("must fail closed");
      },
    });

    assertUnauthorized(await admit(accessorConfig));
    assertUnauthorized(await admit(inheritedConfig));
    assertUnauthorized(await admit(proxyConfig));
  });

  it("rejects missing, oversized, and control-bearing asserted identity values", async () => {
    for (
      const headers of [
        {},
        { "x-auth-subject": "" },
        { "x-auth-subject": "u".repeat(1_025) },
        { "x-auth-subject": "user\u0001123" },
        { "x-auth-subject": "user-123", "x-auth-email": "e".repeat(513) },
        { "x-auth-subject": "user-123", "x-auth-groups": "g".repeat(257) },
        {
          "x-auth-subject": "user-123",
          "x-auth-roles": Array.from({ length: 257 }, (_, index) => `r${index}`).join(","),
        },
      ]
    ) {
      assertUnauthorized(await admit(config(), request(headers)));
    }
  });

  it("splits group and role headers into bounded normalized identity lists", async () => {
    const result = await admit(
      config(),
      request({
        "x-auth-subject": "user-123",
        "x-auth-groups": " admin, editor, admin, , viewer ",
        "x-auth-roles": " deployer, owner, deployer ",
      }),
    );

    assert(!(result instanceof Response));
    assertEquals(result.identity.groups, ["admin", "editor", "viewer"]);
    assertEquals(result.identity.roles, ["deployer", "owner"]);
    assertEquals(result.identity.claims, {
      sub: "user-123",
      groups: ["admin", "editor", "admin", "viewer"],
      roles: ["deployer", "owner", "deployer"],
    });
  });

  it("returns one normalized header name when duplicate configured identity headers differ only by case", async () => {
    const result = await admit(
      config({
        headers: {
          subject: "X-Auth-Subject",
          email: "x-auth-subject",
        },
      }),
      request({ "x-auth-subject": "user-123" }),
    );

    assert(!(result instanceof Response));
    assertEquals(result.identity.subject, "user-123");
    assertEquals(result.identity.email, "user-123");
    assertEquals(result.identityHeaderNames, ["x-auth-subject"]);
  });

  it("does not mutate the input request or add a forgeable marker header", async () => {
    const req = request({ "x-auth-subject": "user-123" });
    const originalHeaders = req.headers;
    const result = await admit(config(), req);

    assert(!(result instanceof Response));
    assertStrictEquals(req.headers, originalHeaders);
    assertEquals(req.headers.get("x-auth-subject"), "user-123");
    assertEquals(req.headers.has("x-veryfront-application-auth"), false);
  });
});
