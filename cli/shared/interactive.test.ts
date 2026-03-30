import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { detectCI, isInteractive, resetInteractiveMode, setNonInteractive } from "./interactive.ts";

describe("interactive", () => {
  describe("isInteractive", () => {
    it("defaults to true", () => {
      resetInteractiveMode();
      assertEquals(isInteractive(), true);
    });

    it("returns false after setNonInteractive(true)", () => {
      setNonInteractive(true);
      assertEquals(isInteractive(), false);
      resetInteractiveMode();
    });

    it("returns true after setNonInteractive(false)", () => {
      setNonInteractive(true);
      setNonInteractive(false);
      assertEquals(isInteractive(), true);
    });

    it("resetInteractiveMode restores default", () => {
      setNonInteractive(true);
      resetInteractiveMode();
      assertEquals(isInteractive(), true);
    });
  });

  describe("detectCI", () => {
    it("returns a boolean", () => {
      assertEquals(typeof detectCI(), "boolean");
    });
  });

  describe("confirmPrompt in non-interactive mode", () => {
    it("returns true when --yes is set (auto-confirm)", async () => {
      const { confirmPrompt } = await import("../utils/index.ts");
      setNonInteractive(true);
      try {
        // Even with defaultValue=false, --yes should auto-confirm
        const result = await confirmPrompt("Delete everything?", false);
        assertEquals(result, true);
      } finally {
        resetInteractiveMode();
      }
    });

    it("returns true regardless of defaultValue", async () => {
      const { confirmPrompt } = await import("../utils/index.ts");
      setNonInteractive(true);
      try {
        assertEquals(await confirmPrompt("Proceed?", true), true);
        assertEquals(await confirmPrompt("Proceed?", false), true);
      } finally {
        resetInteractiveMode();
      }
    });
  });
});
