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

  it("does not add delegation to a request-derived restrictive allowlist when skills are available", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(["sleep"]),
      localToolNames: ["sleep", "load_skill", "invoke_agent"],
      availableSkillIds: ["plan"],
    });

    assertEquals(result?.has("sleep"), true, "requested tool stays allowed");
    assertEquals(result?.has("load_skill"), true, "skill loading stays available");
    assertEquals(
      result?.has("invoke_agent"),
      false,
      "request-derived selectors never gain delegation",
    );
  });

  it("keeps delegation for config-derived empty selectors when skills are available", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(),
      localToolNames: ["invoke_agent", "load_skill", "sleep"],
      configDerivedSelector: true,
      availableSkillIds: ["plan"],
    });

    assertEquals(result?.has("invoke_agent"), true, "config-derived empty set keeps delegation");
    assertEquals(result?.has("load_skill"), true, "skill loading stays available");
    assertEquals(result?.has("sleep"), false, "unconfigured tools are not added");
  });

  it("keeps delegation for config-derived non-empty selectors when skills are available", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(["sleep"]),
      localToolNames: ["invoke_agent", "load_skill", "sleep"],
      configDerivedSelector: true,
      availableSkillIds: ["plan"],
    });

    assertEquals(result?.has("sleep"), true, "configured tool stays allowed");
    assertEquals(result?.has("load_skill"), true, "skill loading stays available");
    assertEquals(
      result?.has("invoke_agent"),
      true,
      "legacy skill-enabled agents with configured tools keep delegation",
    );
  });

  it("does not add delegation to config-derived selectors when no skills are authorized", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(["sleep"]),
      localToolNames: ["invoke_agent", "load_skill", "sleep"],
      configDerivedSelector: true,
      availableSkillIds: [],
    });

    assertEquals(result?.has("sleep"), true, "configured tool stays allowed");
    assertEquals(
      result?.has("invoke_agent"),
      false,
      "skill delegation stays out without an authorized skill",
    );
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
      configDerivedSelector: true,
      availableSkillIds: [],
    });

    assertEquals(result?.has("load_skill"), false);
    assertEquals(result?.has("load_skill_reference"), false);
  });

  it("keeps skill loading for legacy unscoped config-derived empty selectors", () => {
    const result = resolveHostedRuntimeAllowedToolNames({
      allowedToolNames: new Set(),
      localToolNames: ["load_skill", "load_skill_reference"],
      configDerivedSelector: true,
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
