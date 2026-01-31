import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { TuiState } from "./tui.ts";

describe("tui", () => {
  describe("createTui", () => {
    it("exports createTui function", async () => {
      const { createTui } = await import("./tui.ts");
      assertExists(createTui);
      assertEquals(typeof createTui, "function");
    });

    it("exports interceptConsole function", async () => {
      const { interceptConsole } = await import("./tui.ts");
      assertExists(interceptConsole);
      assertEquals(typeof interceptConsole, "function");
    });

    it("exports handleInput function", async () => {
      const { handleInput } = await import("./tui.ts");
      assertExists(handleInput);
      assertEquals(typeof handleInput, "function");
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
      assertEquals(state.info.key, "value");
    });

    it("supports all status types", () => {
      const types: TuiState["statusType"][] = ["loading", "success", "error", "info"];
      assertEquals(types.length, 4);
    });
  });
});
