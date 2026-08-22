import "#veryfront/schemas/_test-setup.ts";
/**
 * Tests for MCP dev tools
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
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

    it("keeps the canonical project host when native resolution succeeds", async () => {
      let request: Request | undefined;
      const result = await withMockFetch(
        (input, init) => {
          request = new Request(input, init);
          return Promise.resolve(Response.json({
            context: {
              projectSlug: "alpha",
              projectDir: "/project",
              requestContext: { mode: "development" },
            },
            adapter: { isMultiProjectMode: true },
          }));
        },
        () => vfGetDebugContext.execute({ port: 4321, project: "alpha" }),
      );

      assertEquals(request?.url, "http://alpha.localhost:4321/_vf_debug/context");
      assertEquals(request?.headers.get("x-project-slug"), null);
      assertEquals(result.success, true);
      assertEquals(result.context?.projectSlug, "alpha");
    });

    it("falls back to loopback after a native project-host resolution failure", async () => {
      const requests: Request[] = [];
      const result = await withMockFetch(
        (input, init) => {
          requests.push(new Request(input, init));
          if (requests.length === 1) {
            return Promise.reject(new TypeError("getaddrinfo ENOTFOUND alpha.localhost"));
          }
          return Promise.resolve(Response.json({
            context: { projectSlug: "alpha", projectDir: "/project" },
            adapter: { isMultiProjectMode: true },
          }));
        },
        () => vfGetDebugContext.execute({ port: 4321, project: "alpha" }),
      );

      assertEquals(requests.map((request) => request.url), [
        "http://alpha.localhost:4321/_vf_debug/context",
        "http://127.0.0.1:4321/_vf_debug/context",
      ]);
      assertEquals(requests[1]?.headers.get("x-project-slug"), "alpha");
      assertEquals(result.success, true);
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
