/**
 * Tests for MCP advanced tools registry
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { advancedTools } from "./advanced-tools.ts";

describe("mcp/advanced-tools", () => {
  describe("advancedTools array", () => {
    it("is an array of MCP tools", () => {
      assertEquals(Array.isArray(advancedTools), true);
      assertEquals(advancedTools.length > 0, true);
    });

    it("each tool has required properties", () => {
      for (const tool of advancedTools) {
        assertExists(tool.name, `Tool missing name`);
        assertExists(tool.description, `Tool ${tool.name} missing description`);
        assertExists(tool.inputSchema, `Tool ${tool.name} missing inputSchema`);
        assertExists(tool.execute, `Tool ${tool.name} missing execute function`);
      }
    });

    it("tool names are unique", () => {
      const names = advancedTools.map((t) => t.name);
      const uniqueNames = new Set(names);
      assertEquals(names.length, uniqueNames.size, "Tool names must be unique");
    });

    it("includes expected tool categories", () => {
      const names = advancedTools.map((t) => t.name);

      // Skill tools
      assertEquals(names.includes("vf_get_skills"), true);
      assertEquals(names.includes("vf_get_skill_reference"), true);

      // Project tools
      assertEquals(names.includes("vf_list_local_projects"), true);
      assertEquals(names.includes("vf_get_project_context"), true);
      assertEquals(names.includes("vf_list_routes"), true);

      // Catalog tools
      assertEquals(names.includes("vf_list_examples"), true);
      assertEquals(names.includes("vf_list_templates"), true);
      assertEquals(names.includes("vf_list_integrations"), true);
      assertEquals(names.includes("vf_create_project"), true);

      // Scaffold tools
      assertEquals(names.includes("vf_get_conventions"), true);
      assertEquals(names.includes("vf_scaffold"), true);

      // Dev tools
      assertEquals(names.includes("vf_preview_route"), true);
      assertEquals(names.includes("vf_hot_reload"), true);
      assertEquals(names.includes("vf_trigger_hmr"), true);
    });
  });
});
