import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
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

  it("rejects paths outside the exact project directory boundary", () => {
    const profile = createStyleScopeProfile();

    assertEquals(
      shouldIncludeStylePath(profile, "/project-secret/pages/admin.tsx", "/project"),
      false,
    );
    assertEquals(
      shouldTraverseStyleDirectory(profile, "/project-secret/pages", "/project"),
      false,
    );
  });

  it("rejects normalized traversal outside the project directory", () => {
    const profile = createStyleScopeProfile();

    assertEquals(
      shouldIncludeStylePath(profile, "/project/pages/../../private/admin.tsx", "/project"),
      false,
    );
    assertEquals(
      shouldIncludeStylePath(profile, "pages/../../../private/admin.tsx", "/project"),
      false,
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

  it("keeps the hashed scope profile immutable", () => {
    const profile = createStyleScopeProfile();

    assertThrows(
      () => (profile.ignoredRoots as string[]).push("runtime"),
      TypeError,
    );
    assertThrows(
      () => {
        (profile as { hash: string }).hash = "stale";
      },
      TypeError,
    );
  });
});
