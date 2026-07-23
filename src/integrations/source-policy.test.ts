import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertNotStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  applySourceIntegrationPolicy,
  intersectSourceIntegrationPolicies,
  isIntegrationToolAllowedBySourcePolicy,
  isSourceIntegrationPolicyManifest,
  normalizeSourceIntegrationPolicy,
  parseIntegrationToolIdentity,
  parseSourceIntegrationPolicyManifest,
  resolveSourceIntegrationPolicyManifest,
} from "./source-policy.ts";

describe("source integration policy", () => {
  it("treats an absent source policy as unrestricted", () => {
    const policy = normalizeSourceIntegrationPolicy(undefined);

    assertEquals(policy, { schemaVersion: 1, mode: "unrestricted" });
    assertEquals(
      applySourceIntegrationPolicy(["github__list_repos", "web_search"], policy),
      ["github__list_repos", "web_search"],
    );
  });

  it("uses an empty allow map to deny every integration without affecting local tools", () => {
    const policy = normalizeSourceIntegrationPolicy({ allow: {} });

    assertEquals(policy, {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {},
    });
    assertEquals(
      applySourceIntegrationPolicy(
        ["github__list_repos", "confluence__get_page", "web_search"],
        policy,
      ),
      ["web_search"],
    );
  });

  it("allows every tool for a listed integration when allowedTools is omitted", () => {
    const policy = normalizeSourceIntegrationPolicy({
      allow: { confluence: {} },
    });

    assertEquals(isIntegrationToolAllowedBySourcePolicy("confluence__get_page", policy), true);
    assertEquals(isIntegrationToolAllowedBySourcePolicy("confluence__update_page", policy), true);
    assertEquals(isIntegrationToolAllowedBySourcePolicy("github__list_repos", policy), false);
  });

  it("normalizes exact connector-local tool IDs deterministically", () => {
    const policy = normalizeSourceIntegrationPolicy({
      allow: {
        github: { allowedTools: ["list_repos", "get_repo", "list_repos"] },
        confluence: { allowedTools: [] },
      },
    });

    assertEquals(policy, {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {
        confluence: { allowedToolIds: [] },
        github: { allowedToolIds: ["get_repo", "list_repos"] },
      },
    });
    assertEquals(isIntegrationToolAllowedBySourcePolicy("github__list_repos", policy), true);
    assertEquals(isIntegrationToolAllowedBySourcePolicy("github__delete_repo", policy), false);
    assertEquals(isIntegrationToolAllowedBySourcePolicy("confluence__get_page", policy), false);
  });

  it("recognizes only canonical full integration tool names", () => {
    assertEquals(parseIntegrationToolIdentity("github__list_repos"), {
      integration: "github",
      toolId: "list_repos",
    });
    assertEquals(parseIntegrationToolIdentity("github:list_repos"), null);
    assertEquals(parseIntegrationToolIdentity("github__list__repos"), null);
    assertEquals(parseIntegrationToolIdentity("__list_repos"), null);
    assertEquals(parseIntegrationToolIdentity("github__"), null);
    assertEquals(parseIntegrationToolIdentity("GitHub__list_repos"), null);
    assertEquals(parseIntegrationToolIdentity("github__list repos"), null);
  });

  it("reserves the double-underscore namespace for fail-closed integration tools", () => {
    const policy = normalizeSourceIntegrationPolicy({ allow: { github: {} } });

    assertEquals(
      applySourceIntegrationPolicy(
        ["github__list_repos", "github__list__repos", "custom__local_tool", "local_tool"],
        policy,
      ),
      ["github__list_repos", "local_tool"],
    );
  });

  it("resolves strict internal manifests and fails malformed state closed", () => {
    const valid = {
      schemaVersion: 1 as const,
      mode: "allowlist" as const,
      integrations: { github: { allowedToolIds: ["list_repos"] } },
    };
    assertEquals(resolveSourceIntegrationPolicyManifest(undefined), undefined);
    assertEquals(resolveSourceIntegrationPolicyManifest(valid), valid);
    assertEquals(isSourceIntegrationPolicyManifest(valid), true);

    for (
      const malformed of [
        { schemaVersion: 1, mode: "unrestricted", integrations: {} },
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { github: { allowedToolIds: [""] } },
        },
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { github: { allowedToolIds: ["list_repos", "list_repos"] } },
        },
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { GitHub: { allowedToolIds: ["list_repos"] } },
        },
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { github: { allowedToolIds: ["ListRepos"] } },
        },
      ]
    ) {
      assertEquals(isSourceIntegrationPolicyManifest(malformed), false);
      assertEquals(resolveSourceIntegrationPolicyManifest(malformed), {
        schemaVersion: 1,
        mode: "allowlist",
        integrations: {},
      });
    }
  });

  it("strictly parses a fresh canonical immutable manifest", () => {
    const input = {
      schemaVersion: 1 as const,
      mode: "allowlist" as const,
      integrations: {
        github: { allowedToolIds: ["list_repos", "get_repo"] },
        confluence: { allowedToolIds: null },
      },
    };

    const parsed = parseSourceIntegrationPolicyManifest(input);

    assertEquals(parsed, {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {
        confluence: { allowedToolIds: null },
        github: { allowedToolIds: ["get_repo", "list_repos"] },
      },
    });
    assertNotStrictEquals(parsed, input);
    assertEquals(Object.isFrozen(parsed), true);
    if (parsed.mode === "allowlist") {
      assertEquals(Object.isFrozen(parsed.integrations), true);
      assertEquals(Object.isFrozen(parsed.integrations.github?.allowedToolIds), true);
    }
    assertThrows(
      () => parseSourceIntegrationPolicyManifest(undefined),
      TypeError,
      "Invalid source integration policy manifest",
    );
  });

  it("contains hostile process-boundary objects without invoking callers twice", () => {
    const throwing = new Proxy({}, {
      ownKeys() {
        throw new Error("PRIVATE_POLICY_CANARY");
      },
    });
    let modeReads = 0;
    const changing = {
      schemaVersion: 1,
      get mode() {
        modeReads++;
        return modeReads === 1 ? "unrestricted" : "allowlist";
      },
    };

    assertEquals(isSourceIntegrationPolicyManifest(throwing), false);
    assertEquals(isSourceIntegrationPolicyManifest(changing), true);
    assertEquals(modeReads, 1);
    assertThrows(
      () => parseSourceIntegrationPolicyManifest(throwing),
      TypeError,
      "Invalid source integration policy manifest",
    );
  });

  it("bounds policy manifests and rejects unknown integration identities", () => {
    const excessiveToolIds = Array.from({ length: 513 }, (_, index) => `tool_${index}`);
    const excessiveIntegrations = Object.fromEntries(
      Array.from({ length: 257 }, (_, index) => [`integration-${index}`, {
        allowedToolIds: null,
      }]),
    );

    for (
      const malformed of [
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { unknown: { allowedToolIds: null } },
        },
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { github: { allowedToolIds: excessiveToolIds } },
        },
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: excessiveIntegrations,
        },
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { github: { allowedToolIds: ["x".repeat(129)] } },
        },
      ]
    ) {
      assertEquals(isSourceIntegrationPolicyManifest(malformed), false);
    }
  });

  it("fails closed for malformed typed policies and non-string tool identities", () => {
    const inheritedRestriction = {
      schemaVersion: 1 as const,
      mode: "allowlist" as const,
      integrations: {},
    };

    assertEquals(
      isIntegrationToolAllowedBySourcePolicy("constructor__call", inheritedRestriction),
      false,
    );
    assertEquals(parseIntegrationToolIdentity(undefined as unknown as string), null);
    assertEquals(parseIntegrationToolIdentity("github__" + "x".repeat(129)), null);
  });

  it("rejects malformed direct config instead of constructing an unsafe manifest", () => {
    assertThrows(
      () => normalizeSourceIntegrationPolicy(null as never),
      TypeError,
      "Invalid source integration policy config",
    );
    assertThrows(
      () =>
        normalizeSourceIntegrationPolicy({
          allow: { unknown: {} },
        } as never),
      TypeError,
      "Invalid source integration policy config",
    );
    assertThrows(
      () =>
        normalizeSourceIntegrationPolicy({
          allow: {
            github: { allowedTools: Array.from({ length: 513 }, (_, index) => `tool_${index}`) },
          },
        }),
      TypeError,
      "Invalid source integration policy config",
    );
    assertThrows(
      () => normalizeSourceIntegrationPolicy({ allow: { unknown: undefined } } as never),
      TypeError,
      "Invalid source integration policy config",
    );

    const allowWithHiddenState = { github: {} } as Record<PropertyKey, unknown>;
    Object.defineProperty(allowWithHiddenState, "hidden", {
      value: {},
      enumerable: false,
    });
    assertThrows(
      () => normalizeSourceIntegrationPolicy({ allow: allowWithHiddenState } as never),
      TypeError,
      "Invalid source integration policy config",
    );
  });

  it("intersects independent restrictions without allowing either side to widen access", () => {
    const left = normalizeSourceIntegrationPolicy({
      allow: {
        gmail: { allowedTools: ["list_emails", "get_email"] },
        github: {},
      },
    });
    const right = normalizeSourceIntegrationPolicy({
      allow: {
        gmail: { allowedTools: ["delete_email", "list_emails"] },
        confluence: {},
      },
    });

    assertEquals(intersectSourceIntegrationPolicies(left, right), {
      schemaVersion: 1,
      mode: "allowlist",
      integrations: {
        gmail: { allowedToolIds: ["list_emails"] },
      },
    });
    assertEquals(
      intersectSourceIntegrationPolicies(
        { schemaVersion: 1, mode: "unrestricted" },
        right,
      ),
      right,
    );
  });
});
