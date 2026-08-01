import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStyleScopeProfile,
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
} from "./style-scope-profile.ts";

describe("styles-builder/style-scope-profile", () => {
  it("uses a full lowercase SHA-256 profile identity", () => {
    const profile = createStyleScopeProfile();
    assertEquals(profile.hash.match(/^[a-f0-9]{64}$/)?.[0], profile.hash);
  });

  it("rejects non-canonical configured stylesheet paths before hashing", () => {
    assertThrows(
      () =>
        createStyleScopeProfile({
          styles: { stylesheet: "styles/../globals.css" },
        }),
      TypeError,
      "Stylesheet path",
    );
  });

  it("ignores knowledge content by default for style scanning", () => {
    const profile = createStyleScopeProfile();

    assertEquals(
      shouldIncludeStylePath(profile, "/project/knowledge/reference/button.tsx", "/project"),
      false,
    );
    assertEquals(
      shouldTraverseStyleDirectory(profile, "/project/knowledge", "/project"),
      false,
    );
  });

  it("keeps runtime roots included by default", () => {
    const profile = createStyleScopeProfile();

    assertEquals(shouldIncludeStylePath(profile, "/project/pages/index.tsx", "/project"), true);
    assertEquals(shouldIncludeStylePath(profile, "/project/app/page.tsx", "/project"), true);
    assertEquals(
      shouldIncludeStylePath(profile, "/project/src/components/Button.tsx", "/project"),
      true,
    );
  });

  it("protects configured runtime directories even under conventionally ignored roots", () => {
    const profile = createStyleScopeProfile({
      directories: {
        app: "knowledge/app",
        components: ["knowledge/components"],
      },
      styles: {
        stylesheet: "knowledge/theme/globals.css",
      },
    });

    assertEquals(
      shouldIncludeStylePath(profile, "/project/knowledge/app/page.tsx", "/project"),
      true,
    );
    assertEquals(
      shouldIncludeStylePath(profile, "/project/knowledge/components/Hero.tsx", "/project"),
      true,
    );
    assertEquals(
      shouldTraverseStyleDirectory(profile, "/project/knowledge", "/project"),
      true,
    );
    assertEquals(
      shouldIncludeStylePath(profile, "/project/knowledge/theme/globals.css", "/project"),
      true,
    );
  });

  it("never protects generated roots used by style collectors", () => {
    const profile = createStyleScopeProfile({
      directories: {
        app: ".veryfront/app",
        components: [".deno_cache/components"],
      },
    });

    for (const path of [".veryfront/app/page.tsx", ".deno_cache/components/Card.tsx"]) {
      assertEquals(shouldIncludeStylePath(profile, `/project/${path}`, "/project"), false);
    }
    assertEquals(
      shouldTraverseStyleDirectory(profile, "/project/.veryfront", "/project"),
      false,
    );
    assertEquals(
      shouldTraverseStyleDirectory(profile, "/project/.deno_cache", "/project"),
      false,
    );
  });
});
