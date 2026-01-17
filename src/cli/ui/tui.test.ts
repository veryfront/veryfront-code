/**
 * Tests for CLI TUI
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import type { TuiState } from "./tui.ts";

describe("tui", () => {
  describe("createTui", () => {
    it("exports createTui function", async () => {
      const mod = await import("./tui.ts");
      assertExists(mod.createTui);
      assertEquals(typeof mod.createTui, "function");
    });

    it("exports interceptConsole function", async () => {
      const mod = await import("./tui.ts");
      assertExists(mod.interceptConsole);
      assertEquals(typeof mod.interceptConsole, "function");
    });

    it("exports handleInput function", async () => {
      const mod = await import("./tui.ts");
      assertExists(mod.handleInput);
      assertEquals(typeof mod.handleInput, "function");
    });
  });

  describe("TuiState interface", () => {
    it("defines correct state structure", () => {
      const state: TuiState = {
        status: "test",
        statusType: "info",
        steps: [{ label: "Step 1", done: false }],
        currentStep: 0,
        info: { key: "value" },
        logs: ["log1"],
        logsExpanded: false,
        logScroll: 0,
      };
      assertEquals(state.status, "test");
      assertEquals(state.steps.length, 1);
      assertEquals(state.info["key"], "value");
    });

    it("supports all status types", () => {
      const types: TuiState["statusType"][] = ["loading", "success", "error", "info"];
      assertEquals(types.length, 4);
    });
  });
});

// Note: Full interactive tests require TTY/stdin mocking
// Run manual tests with: deno task cli dev --tui
