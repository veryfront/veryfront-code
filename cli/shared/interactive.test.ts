import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isInteractive, setNonInteractive, resetInteractiveMode, detectCI } from "./interactive.ts";

describe("interactive", () => {
  describe("isInteractive", () => {
    it("defaults to true", () => {
      resetInteractiveMode();
      assertEquals(isInteractive(), true);
    });

    it("returns false after setNonInteractive", () => {
      setNonInteractive(true);
      assertEquals(isInteractive(), false);
      resetInteractiveMode(); // cleanup
    });
  });

  describe("detectCI", () => {
    it("returns a boolean", () => {
      assertEquals(typeof detectCI(), "boolean");
    });
  });
});
