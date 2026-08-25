import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit tests for interactive wizard
 * @module cli/commands/init/interactive-wizard.test
 */

import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { formatWizardIntro, SETUP_COPY, shouldRunWizard } from "./interactive-wizard.ts";

const GETTING_STARTED_DIR = new URL("../../../docs/getting-started/", import.meta.url);

function readGettingStartedDoc(name: string): Promise<string> {
  return Deno.readTextFile(new URL(name, GETTING_STARTED_DIR));
}

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

  describe("getting-started docs match wizard behaviour", () => {
    it("keeps the quickstart create command out of the wizard", async () => {
      const quickstart = await readGettingStartedDoc("quickstart.md");
      const createCommand = quickstart
        .split("\n")
        .find((line) => line.includes("create veryfront"));
      assertExists(createCommand, "quickstart.md must show a create command");

      // shouldRunWizard() is the gate. Without --template the documented command
      // opens a blocking template/runtime/git wizard in a real terminal, which
      // the quickstart presents as a single automatic step.
      const template = /--template\s+([a-z0-9-]+)/.exec(createCommand)?.[1];
      assertEquals(shouldRunWizard({ template }), false);
    });

    it("names every wizard prompt on the create-project page", async () => {
      const createProject = await readGettingStartedDoc("create-project.md");
      for (const prompt of [SETUP_COPY.template, SETUP_COPY.runtime, SETUP_COPY.git]) {
        assertStringIncludes(createProject, prompt);
      }
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
