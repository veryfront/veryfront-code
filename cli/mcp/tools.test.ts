/**
 * Tests for MCP tools registry
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  allTools,
  getTool,
  listTools,
  setServerStartTime,
  vfClearCache,
  vfClearErrors,
  vfGetErrors,
  vfGetLogs,
  vfGetStatus,
} from "./tools.ts";

describe("mcp/tools", () => {
  describe("allTools array", () => {
    it("is an array of MCP tools", () => {
      assertEquals(Array.isArray(allTools), true);
      assertEquals(allTools.length > 0, true);
    });

    it("each tool has required properties", () => {
      for (const tool of allTools) {
        assertExists(tool.name, `Tool missing name`);
        assertExists(tool.description, `Tool ${tool.name} missing description`);
        assertExists(tool.inputSchema, `Tool ${tool.name} missing inputSchema`);
        assertExists(tool.execute, `Tool ${tool.name} missing execute function`);
      }
    });

    it("tool names are unique", () => {
      const names = allTools.map((t) => t.name);
      const uniqueNames = new Set(names);
      assertEquals(names.length, uniqueNames.size, "Tool names must be unique");
    });

    it("every tool has title and annotations", () => {
      for (const tool of allTools) {
        assertExists(tool.title, `Tool ${tool.name} missing title`);
        assertEquals(typeof tool.title, "string", `Tool ${tool.name} title must be a string`);
        assertExists(tool.annotations, `Tool ${tool.name} missing annotations`);
        assertEquals(
          typeof tool.annotations,
          "object",
          `Tool ${tool.name} annotations must be an object`,
        );
      }
    });

    it("every tool explicitly sets readOnlyHint", () => {
      for (const tool of allTools) {
        assertExists(tool.annotations, `Tool ${tool.name} missing annotations`);
        assertEquals(
          typeof tool.annotations!.readOnlyHint,
          "boolean",
          `Tool ${tool.name} must explicitly set readOnlyHint`,
        );
      }
    });

    it("read-only tools are not marked destructive", () => {
      for (const tool of allTools) {
        if (tool.annotations?.readOnlyHint) {
          assertEquals(
            tool.annotations.destructiveHint ?? false,
            false,
            `Read-only tool ${tool.name} must not have destructiveHint: true`,
          );
        }
      }
    });

    it("destructive tools are not marked read-only", () => {
      for (const tool of allTools) {
        if (tool.annotations?.destructiveHint) {
          assertEquals(
            tool.annotations.readOnlyHint,
            false,
            `Destructive tool ${tool.name} must have readOnlyHint: false`,
          );
        }
      }
    });
  });

  describe("getTool", () => {
    it("returns tool by name", () => {
      const tool = getTool("vf_get_errors");
      assertExists(tool);
      assertEquals(tool.name, "vf_get_errors");
    });

    it("returns undefined for unknown tool", () => {
      const tool = getTool("unknown_tool_xyz");
      assertEquals(tool, undefined);
    });
  });

  describe("listTools", () => {
    it("returns array of tool summaries", () => {
      const tools = listTools();
      assertEquals(Array.isArray(tools), true);
      assertEquals(tools.length, allTools.length);
    });

    it("each summary has name and description", () => {
      const tools = listTools();
      for (const tool of tools) {
        assertExists(tool.name);
        assertExists(tool.description);
      }
    });
  });

  describe("vfGetErrors", () => {
    it("has correct name", () => {
      assertEquals(vfGetErrors.name, "vf_get_errors");
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetErrors.execute, "function");
    });
  });

  describe("vfGetLogs", () => {
    it("has correct name", () => {
      assertEquals(vfGetLogs.name, "vf_get_logs");
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetLogs.execute, "function");
    });
  });

  describe("vfClearCache", () => {
    it("has correct name", () => {
      assertEquals(vfClearCache.name, "vf_clear_cache");
    });

    it("has execute function", () => {
      assertEquals(typeof vfClearCache.execute, "function");
    });
  });

  describe("vfGetStatus", () => {
    it("has correct name", () => {
      assertEquals(vfGetStatus.name, "vf_get_status");
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetStatus.execute, "function");
    });
  });

  describe("vfClearErrors", () => {
    it("has correct name", () => {
      assertEquals(vfClearErrors.name, "vf_clear_errors");
    });

    it("has execute function", () => {
      assertEquals(typeof vfClearErrors.execute, "function");
    });
  });

  describe("setServerStartTime", () => {
    it("is a function", () => {
      assertEquals(typeof setServerStartTime, "function");
    });

    it("accepts a timestamp", () => {
      setServerStartTime(Date.now());
    });
  });
});
