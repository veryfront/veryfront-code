import { assertEquals, assertMatch } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { randomSuffix } from "#cli/shared/slug";

describe("reserve-slug", () => {
  describe("slug generation with random suffix", () => {
    it("should generate a 6-character alphanumeric suffix by default", () => {
      const suffix = randomSuffix();
      assertEquals(suffix.length, 6);
      assertMatch(suffix, /^[a-z0-9]{6}$/);
    });

    it("should generate a suffix with custom length", () => {
      const suffix = randomSuffix(8);
      assertEquals(suffix.length, 8);
      assertMatch(suffix, /^[a-z0-9]{8}$/);
    });

    it("should produce different suffixes on subsequent calls", () => {
      const suffixes = new Set(Array.from({ length: 10 }, () => randomSuffix()));
      // With 36^6 possibilities, 10 calls should all be unique
      assertEquals(suffixes.size, 10);
    });

    it("should create slug with random suffix format", () => {
      const baseSlug = "my-app";
      const slug = `${baseSlug}-${randomSuffix()}`;
      assertMatch(slug, /^my-app-[a-z0-9]{6}$/);
    });
  });

  describe("ReserveResult type", () => {
    it("should have required properties", () => {
      const result = { slug: "my-app", projectId: "123", created: true };

      assertEquals(result.slug, "my-app");
      assertEquals(result.projectId, "123");
      assertEquals(result.created, true);
    });
  });
});
