import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { resolveHostedRuntimeAllowedToolNames } from "./runtime-essential-tools.ts";

describe("resolveHostedRuntimeAllowedToolNames", () => {
  describe("tool discovery tools are always essential", () => {
    it("force-adds search_tools when present in localToolNames and allowedToolNames is restricted", () => {
      const result = resolveHostedRuntimeAllowedToolNames({
        allowedToolNames: new Set(["sleep"]),
        localToolNames: ["search_tools", "load_tools", "sleep"],
      });

      assertEquals(result?.has("search_tools"), true);
      assertEquals(result?.has("load_tools"), true);
      assertEquals(result?.has("sleep"), true);
    });

    it("does not add discovery tools that are absent from localToolNames", () => {
      const result = resolveHostedRuntimeAllowedToolNames({
        allowedToolNames: new Set(["sleep"]),
        localToolNames: ["sleep"],
      });

      assertEquals(result?.has("search_tools"), false);
      assertEquals(result?.has("load_tools"), false);
    });

    it("adds discovery tools even when availableSkillIds is empty", () => {
      const result = resolveHostedRuntimeAllowedToolNames({
        allowedToolNames: new Set(["sleep"]),
        localToolNames: ["search_tools", "load_tools", "sleep"],
        availableSkillIds: [],
      });

      assertEquals(result?.has("search_tools"), true);
      assertEquals(result?.has("load_tools"), true);
    });

    it("returns null (allow-all) when allowedToolNames is null", () => {
      const result = resolveHostedRuntimeAllowedToolNames({
        allowedToolNames: null,
        localToolNames: ["search_tools", "load_tools"],
      });

      assertEquals(result, null);
    });

    it("returns empty set unchanged when allowedToolNames is empty", () => {
      const result = resolveHostedRuntimeAllowedToolNames({
        allowedToolNames: new Set(),
        localToolNames: ["search_tools", "load_tools"],
      });

      assertEquals(result?.size, 0);
    });

    it("does not force-add discovery tools under deny-all even with includeRuntimeEssentialToolsWhenEmpty", () => {
      // A sandboxed agent with tools: [] must not gain load_tools/search_tools
      // even when the config-derived essential-tools flag is set. Activating tools
      // is a broader capability than running pre-configured skills (load_skill), so
      // the two are treated asymmetrically under deny-all.
      const result = resolveHostedRuntimeAllowedToolNames({
        allowedToolNames: new Set(),
        localToolNames: ["search_tools", "load_tools", "load_skill"],
        includeRuntimeEssentialToolsWhenEmpty: true,
      });

      assertEquals(result?.has("search_tools"), false);
      assertEquals(result?.has("load_tools"), false);
    });
  });
});
