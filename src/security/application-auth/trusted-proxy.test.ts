import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { createTrustedProxyApplicationAuthRuntime } from "./trusted-proxy.ts";
import type { TrustedProxyAuthConfig } from "#veryfront/security/http/middleware/types.ts";

const APP_URL = "https://app.example.test/dashboard";
const NativeNumber = Number;
const NativeURL = URL;
const nativeNumberParseInt = Number.parseInt;
const nativeArrayIsArray = Array.isArray;
const nativeNumberIsSafeInteger = Number.isSafeInteger;
const nativeSetHas = Set.prototype.has;
const nativeSetAdd = Set.prototype.add;
const nativeArrayPush = Array.prototype.push;
const nativeObjectFreeze = Object.freeze;
const nativeObjectIsFrozen = Object.isFrozen;

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

async function withTamperedPrimordials<T>(
  tamper: () => void,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    tamper();
    return await fn();
  } finally {
    globalThis.Number = NativeNumber;
    globalThis.URL = NativeURL;
    Number.parseInt = nativeNumberParseInt;
    Array.isArray = nativeArrayIsArray;
    Number.isSafeInteger = nativeNumberIsSafeInteger;
    Set.prototype.has = nativeSetHas;
    Set.prototype.add = nativeSetAdd;
    Array.prototype.push = nativeArrayPush;
    Object.freeze = nativeObjectFreeze;
  }
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

  it("rejects wrong IPv4 peers after global Number and helper tampering", async () => {
    const runtime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["127.0.0.1"] }),
    });
    const wrongPeer = request({ "x-auth-subject": "user-123" }, "198.51.100.3");

    await withTamperedPrimordials(
      () => {
        function FakeNumber(value: unknown): number {
          if (value === "198") return 127;
          if (value === "51") return 0;
          if (value === "100") return 0;
          if (value === "3") return 1;
          return NativeNumber(value);
        }
        Object.assign(FakeNumber, NativeNumber);
        globalThis.Number = FakeNumber as NumberConstructor;
        Array.isArray = () => true;
        Number.isSafeInteger = () => true;
      },
      async () => {
        assertUnauthorized(await runtime.admitRequest(wrongPeer));
      },
    );
  });

  it("rejects wrong IPv6 peers after global URL and Number.parseInt tampering", async () => {
    const ipv6Runtime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["2001:db8::1"] }),
    });
    const mappedRuntime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["192.0.2.10"] }),
    });

    await withTamperedPrimordials(
      () => {
        class FakeURL {
          readonly hostname = "[2001:db8::1]";
          constructor(_value: string) {}
        }
        globalThis.URL = FakeURL as typeof URL;
        Number.parseInt = (value: string, radix?: number): number => {
          if (value === "c633") return 0xc000;
          if (value === "6403") return 0x020a;
          return nativeNumberParseInt(value, radix);
        };
      },
      async () => {
        assertUnauthorized(
          await ipv6Runtime.admitRequest(request({ "x-auth-subject": "user-123" }, "2001:db8::2")),
        );
        assertUnauthorized(
          await mappedRuntime.admitRequest(
            request({ "x-auth-subject": "user-123" }, "::ffff:c633:6403"),
          ),
        );
      },
    );
  });

  it("rejects wrong peers after Set.has tampering following runtime creation", async () => {
    const ipv4Runtime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["127.0.0.1"] }),
    });
    const ipv6Runtime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["2001:db8::1"] }),
    });
    const mappedRuntime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["192.0.2.10"] }),
    });

    await withTamperedPrimordials(
      () => {
        Set.prototype.has = (() => true) as typeof Set.prototype.has;
      },
      async () => {
        assertUnauthorized(
          await ipv4Runtime.admitRequest(request({ "x-auth-subject": "user-123" }, "198.51.100.3")),
        );
        assertUnauthorized(
          await ipv6Runtime.admitRequest(request({ "x-auth-subject": "user-123" }, "2001:db8::2")),
        );
        assertUnauthorized(
          await mappedRuntime.admitRequest(
            request({ "x-auth-subject": "user-123" }, "::ffff:c633:6403"),
          ),
        );
      },
    );
  });

  it("rejects wrong peers after Set.add tampering during runtime config snapshot", async () => {
    await withTamperedPrimordials(
      () => {
        Set.prototype.add = function (value: string): Set<string> {
          if (value === "ipv4:127.0.0.1") {
            return nativeSetAdd.call(this, "ipv4:198.51.100.3");
          }
          if (value === "ipv6:2001:db8::1") {
            return nativeSetAdd.call(this, "ipv6:2001:db8::2");
          }
          if (value === "ipv4:192.0.2.10") {
            return nativeSetAdd.call(this, "ipv4:198.51.100.3");
          }
          return nativeSetAdd.call(this, value);
        } as typeof Set.prototype.add;
      },
      async () => {
        const ipv4Runtime = createTrustedProxyApplicationAuthRuntime({
          config: config({ trustedPeers: ["127.0.0.1"] }),
        });
        const ipv6Runtime = createTrustedProxyApplicationAuthRuntime({
          config: config({ trustedPeers: ["2001:db8::1"] }),
        });
        const mappedRuntime = createTrustedProxyApplicationAuthRuntime({
          config: config({ trustedPeers: ["192.0.2.10"] }),
        });

        assertUnauthorized(
          await ipv4Runtime.admitRequest(request({ "x-auth-subject": "user-123" }, "198.51.100.3")),
        );
        assertUnauthorized(
          await ipv6Runtime.admitRequest(request({ "x-auth-subject": "user-123" }, "2001:db8::2")),
        );
        assertUnauthorized(
          await mappedRuntime.admitRequest(
            request({ "x-auth-subject": "user-123" }, "::ffff:c633:6403"),
          ),
        );
      },
    );
  });

  it("rejects wrong peers after Array.push tampering following runtime creation", async () => {
    const ipv4Runtime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["127.0.0.1"] }),
    });
    const ipv6Runtime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["2001:db8::1"] }),
    });
    const mappedRuntime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["192.0.2.10"] }),
    });

    await withTamperedPrimordials(
      () => {
        Array.prototype.push = function (...values: unknown[]): number {
          const rewritten = values.map((value) => {
            if (value === 198) return 127;
            if (value === 51 || value === 100 || value === 3) return value === 3 ? 1 : 0;
            if (value === 2) return 1;
            if (value === 0xc633) return 0xc000;
            if (value === 0x6403) return 0x020a;
            return value;
          });
          return nativeArrayPush.apply(this, rewritten);
        } as typeof Array.prototype.push;
      },
      async () => {
        assertUnauthorized(
          await ipv4Runtime.admitRequest(request({ "x-auth-subject": "user-123" }, "198.51.100.3")),
        );
        assertUnauthorized(
          await ipv6Runtime.admitRequest(request({ "x-auth-subject": "user-123" }, "2001:db8::2")),
        );
        assertUnauthorized(
          await mappedRuntime.admitRequest(
            request({ "x-auth-subject": "user-123" }, "::ffff:c633:6403"),
          ),
        );
      },
    );
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
        { "x-auth-subject": `${"\u00a0".repeat(1_024)}u` },
        { "x-auth-subject": "user\u0001123" },
        { "x-auth-subject": "user-123", "x-auth-email": "e".repeat(513) },
        { "x-auth-subject": "user-123", "x-auth-email": `${"\u00a0".repeat(512)}e` },
        { "x-auth-subject": "user-123", "x-auth-name": `${"\u00a0".repeat(512)}n` },
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
      groups: ["admin", "editor", "viewer"],
      roles: ["deployer", "owner"],
    });
  });

  it("returns a frozen identity after Object.freeze tampering following runtime creation", async () => {
    const runtime = createTrustedProxyApplicationAuthRuntime({
      config: config({ trustedPeers: ["127.0.0.1"] }),
    });

    await withTamperedPrimordials(
      () => {
        Object.freeze = ((value: unknown) => value) as typeof Object.freeze;
      },
      async () => {
        const result = await runtime.admitRequest(
          request({
            "x-auth-subject": "user-123",
            "x-auth-groups": "admin",
            "x-auth-roles": "owner",
          }),
        );
        Object.freeze = nativeObjectFreeze;

        assert(!(result instanceof Response));
        assertEquals(nativeObjectIsFrozen(result.identity), true);
        assertEquals(nativeObjectIsFrozen(result.identity.claims), true);
        assertEquals(nativeObjectIsFrozen(result.identity.groups), true);
        assertEquals(nativeObjectIsFrozen(result.identity.roles), true);
      },
    );
  });

  it("accepts 256 unique list entries plus duplicates and rejects 257 unique entries", async () => {
    const groups = Array.from({ length: 256 }, (_, index) => `g${index}`);
    const accepted = await admit(
      config(),
      request({
        "x-auth-subject": "user-123",
        "x-auth-groups": [...groups, "g0", "g255"].join(","),
      }),
    );
    const rejected = await admit(
      config(),
      request({
        "x-auth-subject": "user-123",
        "x-auth-roles": Array.from({ length: 257 }, (_, index) => `r${index}`).join(","),
      }),
    );

    assert(!(accepted instanceof Response));
    assertEquals(accepted.identity.groups.length, 256);
    assertEquals(accepted.identity.groups[0], "g0");
    assertEquals(accepted.identity.groups[255], "g255");
    assertUnauthorized(rejected);
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
