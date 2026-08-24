import "#veryfront/schemas/_test-setup.ts";

import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalOpaqueProjectIdentifier,
  isCanonicalProjectSlug,
  MAX_OPAQUE_ID_CODE_UNITS,
  MAX_PROJECT_SLUG_CODE_UNITS,
  normalizeProjectSlug,
} from "./project-identity.ts";

describe("project identity validation", () => {
  it("normalizes only surrounding slug whitespace", () => {
    assertEquals(normalizeProjectSlug("  project-slug\n"), "project-slug");
    assertEquals(
      normalizeProjectSlug(" a b "),
      "a b",
      "interior whitespace is preserved",
    );
    assertEquals(
      isCanonicalProjectSlug(normalizeProjectSlug(" project slug ")),
      false,
      "interior whitespace stays non-canonical after normalization",
    );
  });

  it("accepts only bounded canonical hosted slugs", () => {
    for (const value of ["a", "A9", "project-slug", "project-123"]) {
      assertEquals(isCanonicalProjectSlug(value), true, value);
    }
    for (
      const value of [
        "",
        "-project",
        "project-",
        "project_slug",
        "project slug",
        "project/slug",
        "project\nslug",
        "project\u0000slug",
        "å-project",
        "a".repeat(MAX_PROJECT_SLUG_CODE_UNITS + 1),
      ]
    ) {
      assertEquals(isCanonicalProjectSlug(value), false, JSON.stringify(value));
    }
  });

  it("keeps opaque identifiers exact, bounded, and control-free", () => {
    for (const value of ["project:01J2XYZ", "opaque/id", "å-project", "project😀"]) {
      assertEquals(isCanonicalOpaqueProjectIdentifier(value), true, value);
    }
    for (
      const value of [
        undefined,
        "",
        " project-id",
        "project-id ",
        "project\u001fid",
        "project\ud800",
        "project\udc00",
        "a".repeat(MAX_OPAQUE_ID_CODE_UNITS + 1),
      ]
    ) {
      assertEquals(
        isCanonicalOpaqueProjectIdentifier(value),
        false,
        JSON.stringify(value),
      );
    }
  });

  it("detects both C0 and C1 control characters", () => {
    assertEquals(hasProjectIdentityControlCharacters("plain"), false);
    assertEquals(hasProjectIdentityControlCharacters("a\u0000b"), true);
    assertEquals(hasProjectIdentityControlCharacters("a\u0085b"), true);
  });
});
