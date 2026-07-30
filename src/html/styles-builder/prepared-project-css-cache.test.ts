import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createPreparedProjectCSSContext } from "./prepared-project-css-cache.ts";

describe("styles-builder/prepared-project-css-cache", () => {
  it("builds versioned full-digest identities isolated by project and content version", () => {
    const profile = {
      environment: "production",
      minify: true,
      cssPipelineIdentity: "tailwindcss@installed:base-css@audited",
    } as const;
    const first = createPreparedProjectCSSContext(
      "project-a",
      "release:one",
      "@import 'tailwindcss';",
      "a".repeat(64),
      profile,
    );
    const differentProject = createPreparedProjectCSSContext(
      "project-b",
      "release:one",
      "@import 'tailwindcss';",
      "a".repeat(64),
      profile,
    );
    const differentVersion = createPreparedProjectCSSContext(
      "project-a",
      "release:two",
      "@import 'tailwindcss';",
      "a".repeat(64),
      profile,
    );
    const differentCompiler = createPreparedProjectCSSContext(
      "project-a",
      "release:one",
      "@import 'tailwindcss';",
      "a".repeat(64),
      { ...profile, cssPipelineIdentity: "tailwindcss@next:base-css@audited" },
    );

    assertEquals(first.cacheKey !== differentProject.cacheKey, true);
    assertEquals(first.cacheKey !== differentVersion.cacheKey, true);
    assertEquals(first.cacheKey !== differentCompiler.cacheKey, true);
    assertEquals(first.cacheKey.includes(":prepared:v3:"), true);
    assertEquals(first.stylesheetHash.match(/^[a-f0-9]{64}$/)?.[0], first.stylesheetHash);
    assertEquals(first.profileHash.match(/^[a-f0-9]{64}$/)?.[0], first.profileHash);
  });

  it("rejects invalid pipeline and style-profile identities before deriving cache keys", () => {
    assertThrows(
      () =>
        createPreparedProjectCSSContext(
          "project-a",
          "release:one",
          "@import 'tailwindcss';",
          "not-a-profile-hash",
          { cssPipelineIdentity: "pipeline@1" },
        ),
      TypeError,
      "Style profile hash",
    );
    assertThrows(
      () =>
        createPreparedProjectCSSContext(
          "project-a",
          "release:one",
          "@import 'tailwindcss';",
          "a".repeat(64),
          { cssPipelineIdentity: "pipeline\nidentity" },
        ),
      TypeError,
      "CSS pipeline identity",
    );
  });
});
