/**
 * Unit tests for interactive wizard
 * @module cli/commands/init/interactive-wizard.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { shouldRunWizard } from "./interactive-wizard.ts";

describe("interactive-wizard", () => {
  describe("shouldRunWizard", () => {
    it("should return true when no template specified", () => {
      assertEquals(shouldRunWizard({}), true);
    });

    it("should return true when template is undefined", () => {
      assertEquals(shouldRunWizard({ template: undefined }), true);
    });

    it("should return false when template is specified", () => {
      assertEquals(shouldRunWizard({ template: "chat" }), false);
    });

    it("should return false when template is minimal", () => {
      assertEquals(shouldRunWizard({ template: "minimal" }), false);
    });
  });
});
