import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for interactive wizard
 * @module cli/commands/init/interactive-wizard.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { shouldRunWizard, validateProjectName } from "./interactive-wizard.ts";

describe("interactive-wizard", () => {
  describe("validateProjectName", () => {
    it("should accept a simple name", () => {
      assertEquals(validateProjectName("my-app"), null);
    });

    it("should reject forward slashes", () => {
      assertEquals(typeof validateProjectName("foo/bar"), "string");
    });

    it("should reject backslashes", () => {
      assertEquals(typeof validateProjectName("foo\\bar"), "string");
    });

    it("should reject dot-dot", () => {
      assertEquals(typeof validateProjectName(".."), "string");
    });

    it("should reject single dot", () => {
      assertEquals(typeof validateProjectName("."), "string");
    });

    it("should accept dotfiles", () => {
      assertEquals(validateProjectName(".my-app"), null);
    });
  });

  describe("shouldRunWizard", () => {
    it("should return true when no template specified", () => {
      assertEquals(shouldRunWizard({}), true);
    });

    it("should return true when template is undefined", () => {
      assertEquals(shouldRunWizard({ template: undefined }), true);
    });

    it("should return false when template is specified", () => {
      assertEquals(shouldRunWizard({ template: "ai-agent" }), false);
    });

    it("should return false when template is minimal", () => {
      assertEquals(shouldRunWizard({ template: "minimal" }), false);
    });
  });

  describe("runInteractiveWizard (non-TTY skipped path)", () => {
    it("returns runtime: 'node' by default when not interactive", async () => {
      const { runInteractiveWizard } = await import("./interactive-wizard.ts");
      // In Deno test runner `canRunWizard()` returns false; the skipped branch fires.
      const result = await runInteractiveWizard("smoke-app");
      assertEquals(result.runtime, "node");
      assertEquals(result.skipped, true);
    });

    it("honors presetRuntime even when not interactive", async () => {
      const { runInteractiveWizard } = await import("./interactive-wizard.ts");
      const result = await runInteractiveWizard("smoke-app", "bun");
      assertEquals(result.runtime, "bun");
      assertEquals(result.skipped, true);
    });

    it("honors presetRuntime: 'deno'", async () => {
      const { runInteractiveWizard } = await import("./interactive-wizard.ts");
      const result = await runInteractiveWizard("smoke-app", "deno");
      assertEquals(result.runtime, "deno");
      assertEquals(result.skipped, true);
    });
  });
});
