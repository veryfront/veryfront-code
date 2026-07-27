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
  type SourceIntegrationPolicyManifest,
} from "./source-policy.ts";
import {
  MAX_SOURCE_INTEGRATION_POLICY_INTEGRATIONS,
  MAX_SOURCE_INTEGRATION_POLICY_SEGMENT_LENGTH,
  MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS,
} from "./limits.ts";

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
    assertEquals(Object.getPrototypeOf(parsed), null);
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

  it("fails hostile manifests closed without invoking accessors", () => {
    let getterCalled = false;
    const accessorManifest: Record<string, unknown> = {
      mode: "unrestricted",
    };
    Object.defineProperty(accessorManifest, "schemaVersion", {
      enumerable: true,
      get() {
        getterCalled = true;
        throw new Error("must not run");
      },
    });
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    for (const hostile of [accessorManifest, revocable.proxy]) {
      assertEquals(isSourceIntegrationPolicyManifest(hostile), false);
      assertEquals(resolveSourceIntegrationPolicyManifest(hostile), {
        schemaVersion: 1,
        mode: "allowlist",
        integrations: {},
      });
      assertThrows(
        () => parseSourceIntegrationPolicyManifest(hostile),
        TypeError,
        "Invalid source integration policy manifest",
      );
    }
    assertEquals(getterCalled, false);
  });

  it("fails a structurally forged authorization policy closed without invoking accessors", () => {
    let getterCalled = false;
    const forgedPolicy: Record<string, unknown> = {};
    Object.defineProperty(forgedPolicy, "mode", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "unrestricted";
      },
    });

    assertEquals(
      isIntegrationToolAllowedBySourcePolicy(
        "github__list_repos",
        forgedPolicy as SourceIntegrationPolicyManifest,
      ),
      false,
    );
    assertEquals(getterCalled, false);
  });

  it("survives inherited descriptor and numeric array prototype poisoning", async () => {
    const moduleUrl = import.meta.resolve("./source-policy.ts");
    const script = `
      import {
        applySourceIntegrationPolicy,
        isIntegrationToolAllowedBySourcePolicy,
        isSourceIntegrationPolicyManifest,
        normalizeSourceIntegrationPolicy,
        resolveSourceIntegrationPolicyManifest,
      } from ${JSON.stringify(moduleUrl)};

      const config = {
        allow: {
          github: { allowedTools: ["list_repos"] },
        },
      };
      const toolNames = [
        "github__list_repos",
        "github__delete_repo",
        "local_tool",
      ];
      const accessorManifest = { mode: "unrestricted" };
      Object.defineProperty(accessorManifest, "schemaVersion", {
        enumerable: true,
        get() {
          throw new Error("manifest accessor must not run");
        },
      });

      const previousArrayIndex = Object.getOwnPropertyDescriptor(Array.prototype, "0");
      const previousDescriptorValue = Object.getOwnPropertyDescriptor(
        Object.prototype,
        "value",
      );
      let descriptorGetterCalls = 0;
      let numericSetterCalls = 0;
      let outcome;

      Object.defineProperty(Array.prototype, "0", {
        configurable: true,
        set() {
          numericSetterCalls += 1;
          throw new Error("numeric prototype setter must not run");
        },
      });
      Object.defineProperty(Object.prototype, "value", {
        configurable: true,
        get() {
          descriptorGetterCalls += 1;
          return 1;
        },
      });

      try {
        const accepted = isSourceIntegrationPolicyManifest(accessorManifest);
        const resolved = resolveSourceIntegrationPolicyManifest(accessorManifest);
        const normalized = normalizeSourceIntegrationPolicy(config);
        const allowed = applySourceIntegrationPolicy(toolNames, normalized);
        outcome = {
          accepted,
          allowed,
          descriptorGetterCalls,
          numericSetterCalls,
          resolvedIntegrationAllowed: isIntegrationToolAllowedBySourcePolicy(
            "github__list_repos",
            resolved,
          ),
        };
      } finally {
        delete Object.prototype.value;
        if (previousDescriptorValue) {
          Object.defineProperty(Object.prototype, "value", previousDescriptorValue);
        }
        delete Array.prototype[0];
        if (previousArrayIndex) {
          Object.defineProperty(Array.prototype, "0", previousArrayIndex);
        }
      }

      console.log(JSON.stringify(outcome));
    `;
    const output = await new Deno.Command(Deno.execPath(), {
      args: ["--quiet", "eval", script],
      cwd: Deno.cwd(),
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    if (!output.success) {
      throw new Error(decoder.decode(output.stderr));
    }

    assertEquals(JSON.parse(decoder.decode(output.stdout)), {
      accepted: false,
      allowed: ["github__list_repos", "local_tool"],
      descriptorGetterCalls: 0,
      numericSetterCalls: 0,
      resolvedIntegrationAllowed: false,
    });
  });

  it("bounds policy cardinality and canonical segment lengths", () => {
    const tooManyIntegrations = Object.fromEntries(
      Array.from(
        { length: MAX_SOURCE_INTEGRATION_POLICY_INTEGRATIONS + 1 },
        (_, index) => [`integration-${index}`, { allowedToolIds: null }],
      ),
    );
    const tooManyTools = Array.from(
      { length: MAX_SOURCE_INTEGRATION_POLICY_TOOL_IDS + 1 },
      (_, index) => `tool_${index}`,
    );
    const overlongSegment = "i".repeat(MAX_SOURCE_INTEGRATION_POLICY_SEGMENT_LENGTH + 1);

    for (
      const malformed of [
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: tooManyIntegrations,
        },
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { github: { allowedToolIds: tooManyTools } },
        },
        {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { [overlongSegment]: { allowedToolIds: null } },
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
    assertEquals(parseIntegrationToolIdentity(`${overlongSegment}__tool`), null);
    assertThrows(
      () =>
        normalizeSourceIntegrationPolicy({
          allow: {
            github: {
              allowedTools: tooManyTools,
            },
          },
        }),
      RangeError,
      "Source integration policy has too many tool IDs",
    );
  });

  it("uses own null-prototype restrictions for policy lookup", () => {
    const denyAll = normalizeSourceIntegrationPolicy({ allow: {} });

    assertEquals(
      isIntegrationToolAllowedBySourcePolicy("constructor__call", denyAll),
      false,
    );
    if (denyAll.mode === "allowlist") {
      assertEquals(Object.getPrototypeOf(denyAll.integrations), null);
    }
  });

  it("rejects non-string tool names at the runtime boundary", () => {
    assertEquals(parseIntegrationToolIdentity(null as unknown as string), null);
  });
});
