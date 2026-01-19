/**
 * Stdin Compat Tests
 *
 * These tests verify the cross-runtime stdin abstractions work correctly.
 * Note: Full stdin testing requires interactive terminal access, so these
 * tests focus on the API surface and non-interactive behavior.
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { setRawMode, type StdinReader } from "./stdin.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";

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
    // Skip this test in Node.js because acquiring stdin reader keeps the event loop alive
    // even after releasing the lock, causing the test to hang
    if (isDeno) {
      it("should return a reader with read and releaseLock methods and can be released", async () => {
        const { getStdinReader } = await import("./stdin.ts");
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
    } else {
      it("skips stdin reader test in Node.js (would hang)", () => {
        // In Node.js, acquiring a stdin reader keeps the event loop alive
        // This is a known limitation - the API surface is the same, just can't test it safely
        assertEquals(true, true);
      });
    }
  });
});
