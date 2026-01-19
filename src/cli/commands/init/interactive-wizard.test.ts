/**
 * Unit tests for interactive wizard
 * @module cli/commands/init/interactive-wizard.test
 */

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { shouldRunWizard } from "./interactive-wizard.ts";

describe("interactive-wizard", () => {
  describe("shouldRunWizard", () => {
    it("should return true when no template or integrations specified", () => {
      const result = shouldRunWizard({});
      assertEquals(result, true);
    });

    it("should return true when only empty integrations array specified", () => {
      const result = shouldRunWizard({ integrations: [] });
      assertEquals(result, true);
    });

    it("should return false when template is specified", () => {
      const result = shouldRunWizard({ template: "ai" });
      assertEquals(result, false);
    });

    it("should return false when template is minimal", () => {
      const result = shouldRunWizard({ template: "minimal" });
      assertEquals(result, false);
    });

    it("should return false when integrations are specified", () => {
      const result = shouldRunWizard({ integrations: ["github"] });
      assertEquals(result, false);
    });

    it("should return false when both template and integrations specified", () => {
      const result = shouldRunWizard({ template: "ai", integrations: ["github", "slack"] });
      assertEquals(result, false);
    });

    it("should return true when template is undefined and integrations is empty", () => {
      const result = shouldRunWizard({ template: undefined, integrations: [] });
      assertEquals(result, true);
    });

    it("should return false when template is undefined but integrations exist", () => {
      const result = shouldRunWizard({ template: undefined, integrations: ["slack"] });
      assertEquals(result, false);
    });
  });
});
