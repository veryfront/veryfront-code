/**
 * Unit tests for interactive wizard
 * @module cli/commands/init/interactive-wizard.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { shouldRunWizard } from "./interactive-wizard.ts";

describe("interactive-wizard", () => {
  describe("shouldRunWizard", () => {
    it("should return true when no template or integrations specified", () => {
      assertEquals(shouldRunWizard({}), true);
    });

    it("should return true when only empty integrations array specified", () => {
      assertEquals(shouldRunWizard({ integrations: [] }), true);
    });

    it("should return false when template is specified", () => {
      assertEquals(shouldRunWizard({ template: "ai" }), false);
    });

    it("should return false when template is minimal", () => {
      assertEquals(shouldRunWizard({ template: "minimal" }), false);
    });

    it("should return false when integrations are specified", () => {
      assertEquals(shouldRunWizard({ integrations: ["github"] }), false);
    });

    it("should return false when both template and integrations specified", () => {
      assertEquals(
        shouldRunWizard({ template: "ai", integrations: ["github", "slack"] }),
        false,
      );
    });

    it("should return true when template is undefined and integrations is empty", () => {
      assertEquals(shouldRunWizard({ template: undefined, integrations: [] }), true);
    });

    it("should return false when template is undefined but integrations exist", () => {
      assertEquals(shouldRunWizard({ template: undefined, integrations: ["slack"] }), false);
    });
  });
});
