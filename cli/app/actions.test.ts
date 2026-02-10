/**
 * Tests for app actions
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ActionResult,
  detectIDEs,
  getPreferredIDE,
  type IDE,
  openFileInIDE,
  openInBrowser,
  openInIDE,
  openInStudio,
  openMCPSettings,
} from "./actions.ts";

describe("app/actions", () => {
  describe("Exported functions", () => {
    it("openInBrowser is a function", () => {
      assertEquals(typeof openInBrowser, "function");
    });

    it("openInStudio is a function", () => {
      assertEquals(typeof openInStudio, "function");
    });

    it("detectIDEs is a function", () => {
      assertEquals(typeof detectIDEs, "function");
    });

    it("getPreferredIDE is a function", () => {
      assertEquals(typeof getPreferredIDE, "function");
    });

    it("openInIDE is a function", () => {
      assertEquals(typeof openInIDE, "function");
    });

    it("openFileInIDE is a function", () => {
      assertEquals(typeof openFileInIDE, "function");
    });

    it("openMCPSettings is a function", () => {
      assertEquals(typeof openMCPSettings, "function");
    });
  });

  describe("Type definitions", () => {
    it("IDE type includes expected values", () => {
      const ide1: IDE = "cursor";
      const ide2: IDE = "code";
      const ide3: IDE = "zed";
      const ide4: IDE = "idea";
      const ide5: IDE = "webstorm";

      assertEquals(ide1, "cursor");
      assertEquals(ide2, "code");
      assertEquals(ide3, "zed");
      assertEquals(ide4, "idea");
      assertEquals(ide5, "webstorm");
    });

    it("ActionResult interface has expected shape", () => {
      const successResult: ActionResult = {
        success: true,
        message: "Done",
      };

      const failResult: ActionResult = {
        success: false,
        message: "Failed",
      };

      assertEquals(successResult.success, true);
      assertEquals(failResult.success, false);
    });
  });
});
