/**
 * Tests for shortcuts component
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterAll, beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { resetColorCache } from "../colors.ts";
import {
  DEV_SHORTCUTS,
  devShortcuts,
  type Shortcut,
  shortcuts,
  shortcutsBlock,
} from "./shortcuts.ts";

describe("shortcuts", () => {
  let originalForceColor: string | undefined;
  let originalNoColor: string | undefined;

  beforeAll(() => {
    originalForceColor = getEnv("FORCE_COLOR");
    originalNoColor = getEnv("NO_COLOR");

    if (originalNoColor !== undefined) deleteEnv("NO_COLOR");
    setEnv("FORCE_COLOR", "3");
    resetColorCache();
  });

  afterAll(() => {
    if (originalForceColor !== undefined) {
      setEnv("FORCE_COLOR", originalForceColor);
    } else {
      deleteEnv("FORCE_COLOR");
    }

    if (originalNoColor !== undefined) {
      setEnv("NO_COLOR", originalNoColor);
    } else {
      deleteEnv("NO_COLOR");
    }

    resetColorCache();
  });

  describe("DEV_SHORTCUTS", () => {
    it("is an array of shortcuts", () => {
      assertEquals(Array.isArray(DEV_SHORTCUTS), true);
      assertEquals(DEV_SHORTCUTS.length, 3);
    });

    it("contains open, clear, and quit shortcuts", () => {
      const keys = DEV_SHORTCUTS.map((s) => s.key);
      assertEquals(keys, ["o", "c", "q"]);
    });

    it("has correct labels", () => {
      const labels = DEV_SHORTCUTS.map((s) => s.label);
      assertEquals(labels, ["open", "clear", "quit"]);
    });
  });

  describe("shortcuts", () => {
    it("returns formatted shortcut string", () => {
      const items: Shortcut[] = [
        { key: "a", label: "action" },
        { key: "b", label: "button" },
      ];
      const result = shortcuts(items);

      assertStringIncludes(result, "a");
      assertStringIncludes(result, "action");
      assertStringIncludes(result, "b");
      assertStringIncludes(result, "button");
    });

    it("handles single shortcut", () => {
      const items: Shortcut[] = [{ key: "q", label: "quit" }];
      const result = shortcuts(items);

      assertStringIncludes(result, "q");
      assertStringIncludes(result, "quit");
    });

    it("handles empty array", () => {
      const result = shortcuts([]);
      assertEquals(result, "  ");
    });
  });

  describe("devShortcuts", () => {
    it("returns formatted dev shortcuts", () => {
      const result = devShortcuts();

      assertStringIncludes(result, "o");
      assertStringIncludes(result, "open");
      assertStringIncludes(result, "c");
      assertStringIncludes(result, "clear");
      assertStringIncludes(result, "q");
      assertStringIncludes(result, "quit");
    });
  });

  describe("shortcutsBlock", () => {
    it("returns multi-line formatted shortcuts", () => {
      const items: Shortcut[] = [
        { key: "a", label: "action" },
        { key: "b", label: "button" },
      ];
      const result = shortcutsBlock(items);

      assertStringIncludes(result, "Shortcuts:");
      assertStringIncludes(result, "a");
      assertStringIncludes(result, "action");
      assertStringIncludes(result, "b");
      assertStringIncludes(result, "button");
    });

    it("uses custom header", () => {
      const items: Shortcut[] = [{ key: "h", label: "help" }];
      const result = shortcutsBlock(items, "Key Bindings");

      assertStringIncludes(result, "Key Bindings:");
    });

    it("contains newlines for multi-line output", () => {
      const items: Shortcut[] = [{ key: "x", label: "exit" }];
      const result = shortcutsBlock(items);

      assertStringIncludes(result, "\n");
    });
  });
});
