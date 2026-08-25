import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createApplicationIdentity } from "./identity.ts";

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
