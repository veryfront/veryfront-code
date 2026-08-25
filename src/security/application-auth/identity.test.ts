import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createApplicationIdentity, snapshotApplicationIdentity } from "./identity.ts";

const nativeObjectFreeze = Object.freeze;
const nativeObjectIsFrozen = Object.isFrozen;
const nativeSetHas = Set.prototype.has;
const nativeSetAdd = Set.prototype.add;
const nativeArrayPush = Array.prototype.push;

function restoreIdentityPrimordials(): void {
  Object.freeze = nativeObjectFreeze;
  Set.prototype.has = nativeSetHas;
  Set.prototype.add = nativeSetAdd;
  Array.prototype.push = nativeArrayPush;
}

function createCountingArrayProxy(values: readonly unknown[]): {
  proxy: unknown[];
  counts: { get: number; ownKeys: number; getOwnPropertyDescriptor: number };
} {
  const counts = { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0 };
  const proxy = new Proxy([...values], {
    get(target, property, receiver) {
      counts.get += 1;
      return Reflect.get(target, property, receiver);
    },
    ownKeys(target) {
      counts.ownKeys += 1;
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(target, property) {
      counts.getOwnPropertyDescriptor += 1;
      return Reflect.getOwnPropertyDescriptor(target, property);
    },
  });
  return { proxy, counts };
}

describe("security/application-auth/identity", () => {
  it("requires the exact configured issuer and a non-empty subject", () => {
    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://evil.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: {},
        }),
      TypeError,
      "issuer",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "",
          claims: {},
        }),
      TypeError,
      "subject",
    );
  });

  it("bounds issuer, subject, profile claims, list entries, and total claim values", () => {
    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: `https://${"i".repeat(2_041)}.example.com`,
          expectedIssuer: `https://${"i".repeat(2_041)}.example.com`,
          subject: "user-123",
          claims: {},
        }),
      TypeError,
      "issuer",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "s".repeat(1_025),
          claims: {},
        }),
      TypeError,
      "subject",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: {
            email: "e".repeat(513),
          },
          claimNames: {
            email: "email",
          },
        }),
      TypeError,
      "email",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: {
            roles: ["r".repeat(257)],
          },
          claimNames: {
            roles: "roles",
          },
        }),
      TypeError,
      "roles",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: Object.fromEntries(
            Array.from({ length: 128 }, (_, index) => [
              `values_${index}`,
              Array.from({ length: 16 }, (_, nestedIndex) => nestedIndex),
            ]),
          ),
        }),
      TypeError,
      "total claim value limit",
    );
  });

  it("normalizes configured optional claims without changing issuer or subject", () => {
    const identity = createApplicationIdentity({
      issuer: "https://issuer.example.com/",
      expectedIssuer: "https://issuer.example.com/",
      subject: " User-ABC ",
      claims: {
        mail: "  USER@EXAMPLE.COM  ",
        display_name: "  Example User  ",
        group_names: ["admin", "admin", "editor", "  editor  "],
        role_names: ["writer", "writer", "reviewer"],
      },
      claimNames: {
        email: "mail",
        name: "display_name",
        groups: "group_names",
        roles: "role_names",
      },
    });

    assertEquals(identity.issuer, "https://issuer.example.com/");
    assertEquals(identity.subject, " User-ABC ");
    assertEquals(identity.email, "USER@EXAMPLE.COM");
    assertEquals(identity.name, "Example User");
    assertEquals(identity.groups, ["admin", "editor"]);
    assertEquals(identity.roles, ["writer", "reviewer"]);
    assertEquals(identity.groupsComplete, true);
  });

  it("deep-freezes the bounded JSON-safe claim snapshot and normalized arrays", () => {
    const identity = createApplicationIdentity({
      issuer: "https://issuer.example.com",
      expectedIssuer: "https://issuer.example.com",
      subject: "user-123",
      claims: {
        profile: { tags: ["alpha"] },
        roles: ["admin"],
      },
      claimNames: {
        roles: "roles",
      },
    });

    assertEquals(Object.isFrozen(identity), true);
    assertEquals(Object.isFrozen(identity.claims), true);
    assertEquals(Object.isFrozen(identity.claims.profile), true);
    assertEquals(
      Object.isFrozen((identity.claims.profile as { readonly tags: readonly string[] }).tags),
      true,
    );
    assertEquals(Object.isFrozen(identity.roles), true);

    assertThrows(() => {
      (identity.roles as string[]).push("owner");
    }, TypeError);
  });

  it("creates a null-prototype frozen snapshot root from serialized identity", () => {
    const identity = snapshotApplicationIdentity({
      issuer: "https://issuer.example.com",
      subject: "user-123",
      groups: ["admin"],
      roles: ["operator"],
      groupsComplete: true,
      claims: { sub: "user-123" },
    });

    assertEquals(Object.getPrototypeOf(identity), null);
    assertEquals(nativeObjectIsFrozen(identity), true);
    assertEquals(nativeObjectIsFrozen(identity.groups), true);
    assertEquals(nativeObjectIsFrozen(identity.roles), true);
    assertEquals(Object.getPrototypeOf(identity.claims), null);
    assertEquals(nativeObjectIsFrozen(identity.claims), true);
  });

  it("rejects proxy-wrapped identity arrays before invoking proxy traps", () => {
    const baseIdentity = {
      issuer: "https://issuer.example.com",
      subject: "user-123",
      groups: ["admin"],
      roles: ["operator"],
      groupsComplete: true,
      claims: { sub: "user-123" },
    };

    for (
      const { label, value } of [
        {
          label: "groups",
          value: (proxy: unknown[]) => ({ ...baseIdentity, groups: proxy }),
        },
        {
          label: "roles",
          value: (proxy: unknown[]) => ({ ...baseIdentity, roles: proxy }),
        },
        {
          label: "claims.nested",
          value: (proxy: unknown[]) => ({
            ...baseIdentity,
            claims: { nested: proxy },
          }),
        },
      ]
    ) {
      const { proxy, counts } = createCountingArrayProxy(["admin"]);
      assertThrows(
        () => snapshotApplicationIdentity(value(proxy)),
        TypeError,
        label,
      );
      assertEquals(counts, { get: 0, ownKeys: 0, getOwnPropertyDescriptor: 0 });
    }
  });

  it("deep-freezes identity data after Object.freeze and collection prototype tampering", () => {
    try {
      Object.freeze = ((value: unknown) => value) as typeof Object.freeze;
      Set.prototype.has = (() => false) as typeof Set.prototype.has;
      Set.prototype.add = function (this: Set<unknown>): Set<unknown> {
        return this;
      } as typeof Set.prototype.add;
      Array.prototype.push = function (this: unknown[]): number {
        return this.length;
      } as typeof Array.prototype.push;

      const identity = createApplicationIdentity({
        issuer: "https://issuer.example.com",
        expectedIssuer: "https://issuer.example.com",
        subject: "user-123",
        claims: {
          profile: { tags: ["alpha"] },
          groups: ["admin", "admin", "editor"],
          roles: ["owner", "owner"],
        },
        claimNames: {
          groups: "groups",
          roles: "roles",
        },
      });

      Object.freeze = nativeObjectFreeze;
      assertEquals(identity.groups, ["admin", "editor"]);
      assertEquals(identity.roles, ["owner"]);
      assertEquals(nativeObjectIsFrozen(identity), true);
      assertEquals(nativeObjectIsFrozen(identity.claims), true);
      assertEquals(nativeObjectIsFrozen(identity.groups), true);
      assertEquals(nativeObjectIsFrozen(identity.roles), true);
      assertEquals(nativeObjectIsFrozen(identity.claims.profile), true);
      assertEquals(
        nativeObjectIsFrozen(
          (identity.claims.profile as { readonly tags: readonly string[] }).tags,
        ),
        true,
      );
    } finally {
      restoreIdentityPrimordials();
    }
  });

  it("preserves own __proto__ root claims as frozen JSON-safe data", () => {
    const claims = {};
    Object.defineProperty(claims, "__proto__", {
      value: { injected: "root" },
      enumerable: true,
      configurable: true,
    });

    const identity = createApplicationIdentity({
      issuer: "https://issuer.example.com",
      expectedIssuer: "https://issuer.example.com",
      subject: "user-123",
      claims,
    });

    assertEquals(Object.getPrototypeOf(identity.claims), null);
    assertEquals(Object.hasOwn(identity.claims, "__proto__"), true);
    assertEquals(identity.claims.__proto__, { injected: "root" });
    assertEquals(Object.isFrozen(identity.claims.__proto__), true);
    assertEquals(JSON.stringify(identity.claims), '{"__proto__":{"injected":"root"}}');
  });

  it("preserves nested Microsoft overage __proto__ claims as own frozen data", () => {
    const claimNames = { groups: "src1" };
    Object.defineProperty(claimNames, "__proto__", {
      value: "claim-names-data",
      enumerable: true,
      configurable: true,
    });

    const graphSource = {
      endpoint: "https://graph.microsoft.com/v1.0/users/user-123/getMemberObjects",
    };
    Object.defineProperty(graphSource, "__proto__", {
      value: { source: "nested" },
      enumerable: true,
      configurable: true,
    });

    const claimSources = { src1: graphSource };
    Object.defineProperty(claimSources, "__proto__", {
      value: { fallback: "source" },
      enumerable: true,
      configurable: true,
    });

    const identity = createApplicationIdentity({
      issuer: "https://login.microsoftonline.com/tenant-id/v2.0",
      expectedIssuer: "https://login.microsoftonline.com/tenant-id/v2.0",
      subject: "user-123",
      claims: {
        _claim_names: claimNames,
        _claim_sources: claimSources,
      },
      claimNames: {
        groups: "groups",
      },
    });

    assertEquals(identity.groupsComplete, false);
    assertEquals(Object.getPrototypeOf(identity.claims._claim_names), null);
    assertEquals(Object.getPrototypeOf(identity.claims._claim_sources), null);
    assertEquals(
      Object.getPrototypeOf(
        (identity.claims._claim_sources as { readonly src1: { readonly endpoint: string } }).src1,
      ),
      null,
    );
    assertEquals(
      (identity.claims._claim_names as { readonly __proto__: string }).__proto__,
      "claim-names-data",
    );
    assertEquals(
      (identity.claims._claim_sources as { readonly __proto__: { readonly fallback: string } })
        .__proto__,
      { fallback: "source" },
    );
    assertEquals(
      (identity.claims._claim_sources as {
        readonly src1: { readonly __proto__: { readonly source: string } };
      }).src1.__proto__,
      { source: "nested" },
    );
    assertEquals(
      JSON.stringify(identity.claims),
      '{"_claim_names":{"groups":"src1","__proto__":"claim-names-data"},"_claim_sources":{"src1":{"endpoint":"https://graph.microsoft.com/v1.0/users/user-123/getMemberObjects","__proto__":{"source":"nested"}},"__proto__":{"fallback":"source"}}}',
    );
  });

  it("rejects unsafe or oversized claim snapshots before constructing an identity", () => {
    const withAccessor = {};
    Object.defineProperty(withAccessor, "email", {
      get() {
        return "user@example.com";
      },
      enumerable: true,
    });

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: withAccessor,
        }),
      TypeError,
      "accessor",
    );

    const withArrayAccessor: unknown[] = ["admin"];
    Object.defineProperty(withArrayAccessor, "0", {
      get() {
        return "admin";
      },
      enumerable: true,
    });

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: { groups: withArrayAccessor },
        }),
      TypeError,
      "accessor",
    );

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: cyclic,
        }),
      TypeError,
      "cycle",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: { large: "x".repeat(4097) },
        }),
      TypeError,
      "string",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: new URL("https://issuer.example.com"),
        }),
      TypeError,
      "plain object",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: Object.fromEntries(
            Array.from({ length: 129 }, (_, index) => [`claim_${index}`, index]),
          ),
        }),
      TypeError,
      "key limit",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: { a: { b: { c: { d: { e: { f: "too deep" } } } } } },
        }),
      TypeError,
      "depth",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: { groups: Array.from({ length: 257 }, (_, index) => `group-${index}`) },
        }),
      TypeError,
      "array entry limit",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: Object.fromEntries(
            Array.from({ length: 17 }, (_, index) => [`claim_${index}`, "x".repeat(4096)]),
          ),
        }),
      TypeError,
      "serialized size limit",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: Object.fromEntries(
            Array.from({ length: 23 }, (_, index) => [`claim_${index}`, "🧪".repeat(1_024)]),
          ),
        }),
      TypeError,
      "serialized size limit",
    );
  });

  it("rejects wrong mapped optional claim types", () => {
    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: {
            email: ["user@example.com"],
          },
          claimNames: {
            email: "email",
          },
        }),
      TypeError,
      "email",
    );

    assertThrows(
      () =>
        createApplicationIdentity({
          issuer: "https://issuer.example.com",
          expectedIssuer: "https://issuer.example.com",
          subject: "user-123",
          claims: {
            groups: "admin",
          },
          claimNames: {
            groups: "groups",
          },
        }),
      TypeError,
      "groups",
    );
  });

  it("marks Microsoft group overage claims as incomplete without fetching groups", () => {
    const identity = createApplicationIdentity({
      issuer: "https://login.microsoftonline.com/tenant-id/v2.0",
      expectedIssuer: "https://login.microsoftonline.com/tenant-id/v2.0",
      subject: "user-123",
      claims: {
        hasgroups: true,
        _claim_names: {
          groups: "src1",
        },
        _claim_sources: {
          src1: {
            endpoint: "https://graph.microsoft.com/v1.0/users/user-123/getMemberObjects",
          },
        },
      },
      claimNames: {
        groups: "groups",
      },
    });

    assertEquals(identity.groups, []);
    assertEquals(identity.groupsComplete, false);
  });
});
