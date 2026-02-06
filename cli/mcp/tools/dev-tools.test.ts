/**
 * Tests for MCP dev tools
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  vfGetDebugContext,
  vfGetFlywheelStatus,
  vfHotReload,
  vfPreviewRoute,
  vfTriggerHmr,
  vfWaitForReady,
} from "./dev-tools.ts";

describe("mcp/tools/dev-tools", () => {
  describe("vfHotReload", () => {
    it("has correct tool name", () => {
      assertEquals(vfHotReload.name, "vf_hot_reload");
    });

    it("has description", () => {
      assertExists(vfHotReload.description);
    });

    it("has execute function", () => {
      assertEquals(typeof vfHotReload.execute, "function");
    });

    it("returns success result", async () => {
      const result = await vfHotReload.execute({});
      assertEquals(result.success, true);
      assertExists(result.message);
    });

    it("accepts optional file parameter", async () => {
      const result = await vfHotReload.execute({ file: "app/page.tsx" });
      assertEquals(result.success, true);
    });
  });

  describe("vfGetDebugContext", () => {
    it("has correct tool name", () => {
      assertEquals(vfGetDebugContext.name, "vf_get_debug_context");
    });

    it("has description mentioning debugging", () => {
      assertExists(vfGetDebugContext.description);
      assertEquals(vfGetDebugContext.description.includes("debug"), true);
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetDebugContext.execute, "function");
    });
  });

  describe("vfTriggerHmr", () => {
    it("has correct tool name", () => {
      assertEquals(vfTriggerHmr.name, "vf_trigger_hmr");
    });

    it("has description", () => {
      assertExists(vfTriggerHmr.description);
    });

    it("has execute function", () => {
      assertEquals(typeof vfTriggerHmr.execute, "function");
    });
  });

  describe("vfPreviewRoute", () => {
    it("has correct tool name", () => {
      assertEquals(vfPreviewRoute.name, "vf_preview_route");
    });

    it("has description", () => {
      assertExists(vfPreviewRoute.description);
    });

    it("has execute function", () => {
      assertEquals(typeof vfPreviewRoute.execute, "function");
    });
  });

  describe("vfWaitForReady", () => {
    it("has correct tool name", () => {
      assertEquals(vfWaitForReady.name, "vf_wait_for_ready");
    });

    it("has description", () => {
      assertExists(vfWaitForReady.description);
    });

    it("has execute function", () => {
      assertEquals(typeof vfWaitForReady.execute, "function");
    });
  });

  describe("vfGetFlywheelStatus", () => {
    it("has correct tool name", () => {
      assertEquals(vfGetFlywheelStatus.name, "vf_get_flywheel_status");
    });

    it("has description", () => {
      assertExists(vfGetFlywheelStatus.description);
    });

    it("has execute function", () => {
      assertEquals(typeof vfGetFlywheelStatus.execute, "function");
    });

    it("returns flywheel status when executed", async () => {
      const result = await vfGetFlywheelStatus.execute({});
      assertExists(result);
      assertExists(result.serverReady !== undefined || result.errors !== undefined);
    });
  });
});
