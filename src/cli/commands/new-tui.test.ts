/**
 * Tests for new-tui.ts (Charm-style wizard)
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { NewTuiResult } from "./new-tui.ts";

describe("new-tui", () => {
  describe("exports", () => {
    it("exports runNewTui function", async () => {
      const mod = await import("./new-tui.ts");
      assertExists(mod.runNewTui);
      assertEquals(typeof mod.runNewTui, "function");
    });
  });

  describe("NewTuiResult interface", () => {
    it("works with ai template", () => {
      const result: NewTuiResult = {
        template: "ai",
        integrations: [],
        cancelled: false,
      };
      assertEquals(result.template, "ai");
      assertEquals(result.integrations.length, 0);
      assertEquals(result.cancelled, false);
    });

    it("works with integrations", () => {
      const result: NewTuiResult = {
        template: "app",
        integrations: ["gmail", "slack", "github"],
        cancelled: false,
      };
      assertEquals(result.template, "app");
      assertEquals(result.integrations.length, 3);
      assertEquals(result.integrations[0], "gmail");
    });

    it("works when cancelled", () => {
      const result: NewTuiResult = {
        template: "ai",
        integrations: [],
        cancelled: true,
      };
      assertEquals(result.cancelled, true);
    });

    it("supports all template types", () => {
      const templates: NewTuiResult["template"][] = ["ai", "app", "blog", "docs", "minimal"];
      assertEquals(templates.length, 5);
    });

    it("supports all integration types", () => {
      const integrations: NewTuiResult["integrations"] = [
        "gmail",
        "slack",
        "notion",
        "github",
        "calendar",
        "drive",
        "jira",
        "linear",
      ];
      assertEquals(integrations.length, 8);
    });
  });
});

// Interactive tests require manual testing:
// deno task cli new my-test-project
//
// Test checklist:
// [ ] Template selection with arrow keys (h/j/k/l and arrows)
// [ ] Template selection with mouse click
// [ ] Integration selection with arrow keys
// [ ] Integration toggle with space
// [ ] Toggle all with 'a'
// [ ] Mouse click on integrations
// [ ] Enter to confirm
// [ ] Ctrl+C to cancel
// [ ] Alt screen mode (clean exit)
