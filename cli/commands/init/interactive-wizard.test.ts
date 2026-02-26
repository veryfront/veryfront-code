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
      assertEquals(shouldRunWizard({ template: "ai-assistant" }), false);
    });

    it("should return false when template is minimal", () => {
      assertEquals(shouldRunWizard({ template: "minimal" }), false);
    });
  });
});
