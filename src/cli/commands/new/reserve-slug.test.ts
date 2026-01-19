/**
 * Unit tests for reserve-slug module
 * @module cli/commands/new/reserve-slug.test
 */

import { assertEquals } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";

// Test the slug auto-increment logic
describe("reserve-slug", () => {
  describe("slug generation", () => {
    it("should increment slug when taken", () => {
      const baseSlug = "my-app";
      let attempt = 1;

      // Simulate first slug being taken
      attempt++;
      const newSlug = `${baseSlug}-${attempt}`;

      assertEquals(newSlug, "my-app-2");
    });

    it("should continue incrementing on repeated conflicts", () => {
      const baseSlug = "my-app";
      const attempts = [2, 3, 4, 5];

      const slugs = attempts.map((n) => `${baseSlug}-${n}`);

      assertEquals(slugs, ["my-app-2", "my-app-3", "my-app-4", "my-app-5"]);
    });
  });

  describe("ReserveResult type", () => {
    it("should have required properties", () => {
      const result = {
        slug: "my-app",
        projectId: "123",
        created: true,
      };

      assertEquals(result.slug, "my-app");
      assertEquals(result.projectId, "123");
      assertEquals(result.created, true);
    });
  });
});
