import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  isDynamicBuildFallbackPath,
  isProductionBuildAssetPath,
} from "./static-request-policy.ts";

describe("static request policy", () => {
  it("classifies generated assets without accepting prefix collisions", () => {
    for (
      const path of [
        "/_veryfront/app.js",
        "/_veryfront/chunks/app.js",
        "/_veryfront/pages/index.js",
        "/_veryfront/data/index.json",
        "/_vf/assets/hash.js",
      ]
    ) {
      assertEquals(isProductionBuildAssetPath(path), true, path);
    }

    for (
      const path of [
        "/_veryfront/app.js/private",
        "/_veryfront/chunks-private/app.js",
        "/_veryfront/pages-private/index.js",
        "/_vf/assets-private/hash.js",
      ]
    ) {
      assertEquals(isProductionBuildAssetPath(path), false, path);
    }
  });

  it("limits dynamic fallback to page and data module directories", () => {
    assertEquals(isDynamicBuildFallbackPath("/_veryfront/pages/index.js"), true);
    assertEquals(isDynamicBuildFallbackPath("/_veryfront/data/index.json"), true);
    assertEquals(isDynamicBuildFallbackPath("/_veryfront/chunks/index.js"), false);
  });
});
