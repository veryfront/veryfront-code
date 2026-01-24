import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { setRawMode, type StdinReader } from "./stdin.ts";

describe("Stdin Compat", () => {
  describe("setRawMode", () => {
    it("should not throw when setting raw mode off", () => {
      setRawMode(false);
    });
  });

  describe("getStdinReader", () => {
    if (!isDeno) {
      it("skips stdin reader test in Node.js (would hang)", () => {
        assertEquals(true, true);
      });
      return;
    }

    it("should return a reader with read and releaseLock methods and can be released", async () => {
      const { getStdinReader } = await import("./stdin.ts");
      const reader = getStdinReader();

      assertExists(reader);
      assertEquals(typeof reader.read, "function");
      assertEquals(typeof reader.releaseLock, "function");

      const typedReader: StdinReader = reader;
      assertExists(typedReader);

      reader.releaseLock();
    });
  });
});
