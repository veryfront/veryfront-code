/**
 * Tests for keyboard handler
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createKeyboardHandler } from "./keyboard.ts";

describe("keyboard", () => {
  describe("createKeyboardHandler", () => {
    it("returns a keyboard handler object", () => {
      const handler = createKeyboardHandler({});
      assertExists(handler);
      assertExists(handler.start);
      assertExists(handler.stop);
    });

    it("handler has start method", () => {
      const handler = createKeyboardHandler({});
      assertEquals(typeof handler.start, "function");
    });

    it("handler has stop method", () => {
      const handler = createKeyboardHandler({});
      assertEquals(typeof handler.stop, "function");
    });

    it("accepts callback options", () => {
      let openCalled = false;
      let clearCalled = false;
      let quitCalled = false;

      const handler = createKeyboardHandler({
        onOpen: () => {
          openCalled = true;
        },
        onClear: () => {
          clearCalled = true;
        },
        onQuit: () => {
          quitCalled = true;
        },
      });

      assertExists(handler);
      // Callbacks are stored but not called until keyboard events occur
      assertEquals(openCalled, false);
      assertEquals(clearCalled, false);
      assertEquals(quitCalled, false);
    });

    it("accepts number callback option", () => {
      let numberPressed: number | undefined;

      const handler = createKeyboardHandler({
        onNumber: (n) => {
          numberPressed = n;
        },
      });

      assertExists(handler);
      assertEquals(numberPressed, undefined);
    });

    it("accepts all callback options", () => {
      const handler = createKeyboardHandler({
        onOpen: () => {},
        onClear: () => {},
        onQuit: () => {},
        onNumber: () => {},
        onAuth: () => {},
        onSync: () => {},
        onLogs: () => {},
        onPull: () => {},
        onPush: () => {},
      });

      assertExists(handler);
    });

    // Note: Full keyboard interaction testing requires terminal access
    // These tests verify the API contract without simulating keystrokes
  });
});
