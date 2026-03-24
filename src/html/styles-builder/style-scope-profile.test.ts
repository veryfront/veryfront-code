import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createStyleScopeProfile,
  shouldIncludeStylePath,
  shouldTraverseStyleDirectory,
} from "./style-scope-profile.ts";

describe("styles-builder/style-scope-profile", () => {
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
      tailwind: {
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
});
