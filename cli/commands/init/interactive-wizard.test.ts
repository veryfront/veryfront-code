/**
 * Unit tests for interactive wizard
 * @module cli/commands/init/interactive-wizard.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { shouldRunWizard } from "./interactive-wizard.ts";

describe("interactive-wizard", () => {
  describe("shouldRunWizard", () => {
    it("should return true when no template or name specified", () => {
      assertEquals(shouldRunWizard({}), true);
    });

    it("should return false when template is specified", () => {
      assertEquals(shouldRunWizard({ template: "chat" }), false);
    });

    it("should return false when template is minimal", () => {
      assertEquals(shouldRunWizard({ template: "minimal" }), false);
    });

    it("should return false when name is specified", () => {
      assertEquals(shouldRunWizard({ name: "my-project" }), false);
    });

    it("should return false when both template and name specified", () => {
      assertEquals(
        shouldRunWizard({ template: "chat", name: "my-project" }),
        false,
      );
    });

    it("should return true when template and name are undefined", () => {
      assertEquals(
        shouldRunWizard({ template: undefined, name: undefined }),
        true,
      );
    });
  });
});
