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
});
