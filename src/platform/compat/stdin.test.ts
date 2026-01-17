/**
 * Stdin Compat Tests
 *
 * These tests verify the cross-runtime stdin abstractions work correctly.
 * Note: Full stdin testing requires interactive terminal access, so these
 * tests focus on the API surface and non-interactive behavior.
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { getStdinReader, setRawMode, type StdinReader } from "./stdin.ts";

describe("Stdin Compat", () => {
  describe("setRawMode", () => {
    it("should not throw when setting raw mode off", () => {
      // Setting raw mode off should always be safe
      setRawMode(false);
    });

    // Note: setRawMode(true) requires stdin to be a TTY, so we can't test it
    // in non-interactive environments like CI
  });

  describe("getStdinReader", () => {
    it("should return a reader with read and releaseLock methods and can be released", () => {
      const reader = getStdinReader();

      assertExists(reader);
      assertEquals(typeof reader.read, "function");
      assertEquals(typeof reader.releaseLock, "function");

      // Type check - this test verifies the interface is correctly exported
      const typedReader: StdinReader = reader;
      assertExists(typedReader);

      // Should not throw when releasing lock
      reader.releaseLock();
    });
  });
});
