import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import type { WizardResult } from "./interactive-wizard.ts";

describe("interactive-wizard", () => {
  describe("runInteractiveWizard", () => {
    it("should export runInteractiveWizard function", async () => {
      const module = await import("./interactive-wizard.ts");
      assertExists(module.runInteractiveWizard);
      assertEquals(typeof module.runInteractiveWizard, "function");
    });
  });

  describe("shouldRunWizard", () => {
    it("should export shouldRunWizard function", async () => {
      const module = await import("./interactive-wizard.ts");
      assertExists(module.shouldRunWizard);
      assertEquals(typeof module.shouldRunWizard, "function");
    });

    it("should return true when no options provided", async () => {
      const module = await import("./interactive-wizard.ts");
      const result = module.shouldRunWizard({});

      assertEquals(result, true);
    });

    it("should return false when template is provided", async () => {
      const module = await import("./interactive-wizard.ts");
      const result = module.shouldRunWizard({ template: "minimal" });

      assertEquals(result, false);
    });

    it("should return false when integrations are provided", async () => {
      const module = await import("./interactive-wizard.ts");
      const result = module.shouldRunWizard({ integrations: ["github"] });

      assertEquals(result, false);
    });
  });

  describe("WizardResult interface", () => {
    it("should define the correct structure", () => {
      const result: WizardResult = {
        template: "minimal",
        integrations: ["github", "slack"],
        skipped: false,
      };

      assertEquals(result.template, "minimal");
      assertEquals(result.integrations.length, 2);
      assertEquals(result.skipped, false);
    });

    it("should support different templates", () => {
      const templates = ["ai", "app", "blog", "docs", "minimal"];

      for (const template of templates) {
        const result: WizardResult = {
          template: template as any,
          integrations: [],
          skipped: false,
        };

        assertEquals(result.template, template);
      }
    });

    it("should allow empty integrations", () => {
      const result: WizardResult = {
        template: "minimal",
        integrations: [],
        skipped: false,
      };

      assertEquals(result.integrations.length, 0);
    });
  });
});
