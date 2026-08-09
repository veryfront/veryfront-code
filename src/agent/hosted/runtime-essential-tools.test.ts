import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveHostedRuntimeAllowedToolNames } from "./runtime-essential-tools.ts";

describe("resolveHostedRuntimeAllowedToolNames", () => {
  it("keeps skill loading available under a non-empty restrictive allowlist", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(["sleep"]),
      localToolNames: [
        "sleep",
        "load_skill",
        "load_skill_reference",
        "execute_skill_script",
        "invoke_agent",
      ],
    });

    assertEquals(result?.has("load_skill"), true);
    assertEquals(result?.has("load_skill_reference"), true);
    assertEquals(result?.has("execute_skill_script"), false);
    assertEquals(result?.has("invoke_agent"), false);
  });

  it("returns null (allow-all) when allowedToolNames is null", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: null,
      localToolNames: ["sleep", "load_skill"],
    });

    assertEquals(result, null);
  });

  it("removes skill infrastructure from allow-all tools when the known skill manifest is empty", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: null,
      localToolNames: [
        "sleep",
        "load_skill",
        "load_skill_reference",
        "execute_skill_script",
      ],
      availableSkillIds: [],
    });

    assertEquals(result?.has("sleep"), true);
    assertEquals(result?.has("load_skill"), false);
    assertEquals(result?.has("load_skill_reference"), false);
    assertEquals(result?.has("execute_skill_script"), false);
  });

  it("returns empty set unchanged when allowedToolNames is empty", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(),
      localToolNames: ["sleep", "load_skill", "load_skill_reference"],
    });

    assertEquals(result?.size, 0);
  });

  it("removes skill infrastructure for a config-derived empty selector with a known empty skill manifest", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(),
      localToolNames: [
        "sleep",
        "load_skill",
        "load_skill_reference",
      ],
      includeRuntimeEssentialToolsWhenEmpty: true,
      availableSkillIds: [],
    });

    assertEquals(result?.has("load_skill"), false);
    assertEquals(result?.has("load_skill_reference"), false);
  });

  it("keeps skill loading for legacy unscoped config-derived empty selectors", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(),
      localToolNames: ["load_skill", "load_skill_reference"],
      includeRuntimeEssentialToolsWhenEmpty: true,
    });

    assertEquals(result?.has("load_skill"), true);
    assertEquals(result?.has("load_skill_reference"), true);
  });

  it("removes only skill-loading and script infrastructure for known empty skill manifests", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(["execute_skill_script", "sleep"]),
      localToolNames: ["execute_skill_script", "load_skill", "invoke_agent", "sleep"],
      availableSkillIds: [],
    });

    assertEquals(result?.has("execute_skill_script"), false);
    assertEquals(result?.has("load_skill"), false);
    assertEquals(result?.has("invoke_agent"), false);
    assertEquals(result?.has("sleep"), true);
  });

  it("preserves explicitly allowed invoke_agent for known empty skill manifests", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(["invoke_agent", "load_skill"]),
      localToolNames: ["invoke_agent", "load_skill"],
      availableSkillIds: [],
    });

    assertEquals(result?.has("invoke_agent"), true);
    assertEquals(result?.has("load_skill"), false);
  });
});
