import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for interactive wizard
 * @module cli/commands/init/interactive-wizard.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatWizardIntro, SETUP_COPY, shouldRunWizard } from "./interactive-wizard.ts";

describe("interactive-wizard", () => {
  it("starts directly with the setup task", () => {
    assertEquals(formatWizardIntro(), "\nLet's set up your project.");
  });

  it("uses concise decision prompts", () => {
    assertEquals(SETUP_COPY.location, "Create project in:");
    assertEquals(SETUP_COPY.template, "Choose a starter template:");
    assertEquals(SETUP_COPY.runtime, "Select runtime:");
    assertEquals(SETUP_COPY.git, "Initialize Git?");
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
