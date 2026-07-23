import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP dev tools
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { ReloadNotifier } from "veryfront/server";
import {
  vfGetDebugContext,
  vfGetFlywheelStatus,
  vfHotReload,
  vfPreviewRoute,
  vfTriggerHmr,
  vfWaitForReady,
} from "./dev-tools.ts";

afterEach(() => ReloadNotifier.reset());

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

    it("reports when no browser is connected", async () => {
      const result = await vfHotReload.execute({});
      assertEquals(result.success, false);
      assertExists(result.message);
    });

    it("triggers a reload with an optional file parameter", async () => {
      const unsubscribe = ReloadNotifier.subscribe(() => {});
      const triggerCalls = ReloadNotifier.getMetrics().triggerCalls;
      const result = await vfHotReload.execute({ file: "app/page.tsx" });

      assertEquals(result.success, true);
      assertEquals(ReloadNotifier.getMetrics().triggerCalls, triggerCalls + 1);
      unsubscribe();
    });

    it("waits for invalidation before reporting success", async () => {
      const release = Promise.withResolvers<void>();
      const unsubscribeReload = ReloadNotifier.subscribe(() => {});
      const unsubscribeInvalidate = ReloadNotifier.subscribeInvalidate(() => release.promise);
      let settled = false;

      const execution = vfHotReload.execute({ file: "app/page.tsx" }).then((result) => {
        settled = true;
        return result;
      });
      await Promise.resolve();
      assertEquals(settled, false);
      release.resolve();
      assertEquals((await execution).success, true);

      unsubscribeInvalidate();
      unsubscribeReload();
    });

    it("does not echo file paths in public output", async () => {
      const unsubscribe = ReloadNotifier.subscribe(() => {});
      const privatePath = "/private/project/secret-page.tsx";
      const result = await vfHotReload.execute({ file: privatePath });

      assertEquals(result.message.includes(privatePath), false);
      unsubscribe();
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

    it("does not echo changed paths in public output", async () => {
      const unsubscribe = ReloadNotifier.subscribe(() => {});
      const privatePath = "/private/project/secret-page.tsx";
      const result = await vfTriggerHmr.execute({ path: privatePath, port: 8080 });

      assertEquals(result.message.includes(privatePath), false);
      unsubscribe();
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
      const result = await vfGetFlywheelStatus.execute({ port: 8080 });
      assertExists(result);
      assertExists(result.server);
      assertExists(result.errors);
    });
  });
});
