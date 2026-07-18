import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  detectCI,
  isAutoConfirmEnabled,
  isInteractive,
  resetInteractiveMode,
  setAutoConfirm,
  setNonInteractive,
} from "./interactive.ts";

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
    it("rejects confirmation without explicit --yes", async () => {
      const { confirmPrompt } = await import("../utils/index.ts");
      setNonInteractive(true);
      try {
        await assertRejects(
          () => confirmPrompt("Delete everything?", false),
          Error,
          "requires explicit confirmation",
        );
      } finally {
        resetInteractiveMode();
      }
    });

    it("returns true when --yes enables auto-confirm", async () => {
      const { confirmPrompt } = await import("../utils/index.ts");
      setAutoConfirm(true);
      try {
        assertEquals(isAutoConfirmEnabled(), true);
        assertEquals(await confirmPrompt("Proceed?", true), true);
        assertEquals(await confirmPrompt("Proceed?", false), true);
      } finally {
        resetInteractiveMode();
      }
    });
  });
});
