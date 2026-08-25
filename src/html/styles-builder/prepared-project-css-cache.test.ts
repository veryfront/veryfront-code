import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createPreparedProjectCSSContext,
  invalidatePreparedProjectCSS,
  storePreparedProjectCSS,
  tryGetPreparedProjectCSS,
} from "./prepared-project-css-cache.ts";
import { hashCandidates, hashCSS, hashString } from "./css-identity.ts";

describe("styles-builder/prepared-project-css-cache", () => {
  it("partitions prepared artifacts by every output-affecting identity", () => {
    const baseProfile = {
      cssPipelineIdentity: "pipeline-A",
      candidatesHash: hashCandidates(["alpha"]),
      minify: true,
      environment: "preview",
      buildMode: "production" as const,
    };
    const styleProfile = hashString("style-profile-A");
    const base = createPreparedProjectCSSContext(
      "project",
      "version-A",
      "sheet-A",
      styleProfile,
      baseProfile,
    );
    const variants = [
      createPreparedProjectCSSContext("project", "version-B", "sheet-A", styleProfile, baseProfile),
      createPreparedProjectCSSContext("project", "version-A", "sheet-B", styleProfile, baseProfile),
      createPreparedProjectCSSContext(
        "project",
        "version-A",
        "sheet-A",
        hashString("style-profile-B"),
        baseProfile,
      ),
      createPreparedProjectCSSContext("project", "version-A", "sheet-A", styleProfile, {
        ...baseProfile,
        candidatesHash: hashCandidates(["beta"]),
      }),
      createPreparedProjectCSSContext("project", "version-A", "sheet-A", styleProfile, {
        ...baseProfile,
        cssPipelineIdentity: "pipeline-B",
      }),
      createPreparedProjectCSSContext("project", "version-A", "sheet-A", styleProfile, {
        ...baseProfile,
        minify: false,
      }),
      createPreparedProjectCSSContext("project", "version-A", "sheet-A", styleProfile, {
        ...baseProfile,
        buildMode: "development" as const,
      }),
      createPreparedProjectCSSContext("project", "version-A", "sheet-A", styleProfile, {
        ...baseProfile,
        environment: "production",
      }),
    ];

    for (const variant of variants) {
      assertEquals(
        variant.cacheKey === base.cacheKey,
        false,
        "every output-affecting identity field must partition the prepared CSS cache key",
      );
    }
    const safelyFramed = createPreparedProjectCSSContext(
      "project:*:scope",
      "version:*:value",
      "sheet-A",
      styleProfile,
      { ...baseProfile, environment: "preview:*:environment" },
    );
    assertEquals(safelyFramed.cacheKey.includes("project:*:scope"), false);
    assertEquals(safelyFramed.cacheKey.includes("version:*:value"), false);
    assertEquals(safelyFramed.cacheKey.includes("preview:*:environment"), false);
    assertEquals(safelyFramed.cacheKey.startsWith("v3:"), true);
  });

  it("serves only content-verified entries from the exact prepared context", async () => {
    const projectSlug = `prepared-css-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "version",
      "sheet",
      hashString("style-profile"),
      {
        cssPipelineIdentity: "pipeline",
        candidatesHash: hashCandidates(["alpha"]),
      },
    );
    const css = ".alpha{display:block}";
    try {
      await storePreparedProjectCSS(context, { css, hash: hashCSS(css) });
      assertEquals(await tryGetPreparedProjectCSS(context), {
        css,
        hash: hashCSS(css),
        fromCache: true,
      });

      await assertRejects(
        () => storePreparedProjectCSS(context, { css, hash: hashCSS("forged") }),
        TypeError,
        "does not match",
      );
    } finally {
      invalidatePreparedProjectCSS(projectSlug);
    }
  });

  it("rejects abbreviated profile and candidate identities", () => {
    assertThrows(
      () =>
        createPreparedProjectCSSContext("project", "version", "sheet", "short", {
          cssPipelineIdentity: "pipeline",
          candidatesHash: hashCandidates(["alpha"]),
        }),
      TypeError,
      "full lowercase SHA-256",
    );
    assertThrows(
      () =>
        createPreparedProjectCSSContext(
          "project",
          "version",
          "sheet",
          hashString("style-profile"),
          {
            cssPipelineIdentity: "pipeline",
            candidatesHash: "short",
          },
        ),
      TypeError,
      "full lowercase SHA-256",
    );
  });

  it("does not repopulate prepared CSS from a pre-invalidation context", async () => {
    const projectSlug = `stale-prepared-context-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "version",
      "sheet",
      hashString("style-profile"),
      {
        cssPipelineIdentity: "pipeline",
        candidatesHash: hashCandidates(["alpha"]),
      },
    );
    const css = ".alpha{display:block}";

    invalidatePreparedProjectCSS(projectSlug);
    try {
      await storePreparedProjectCSS(context, { css, hash: hashCSS(css) });
      assertEquals(await tryGetPreparedProjectCSS(context), undefined);

      const fresh = createPreparedProjectCSSContext(
        projectSlug,
        "version",
        "sheet",
        hashString("style-profile"),
        {
          cssPipelineIdentity: "pipeline",
          candidatesHash: hashCandidates(["alpha"]),
        },
      );
      assertEquals(
        fresh.cacheKey,
        context.cacheKey,
        "a post-invalidation context with identical inputs reuses the same cache key",
      );
      assertEquals(
        await tryGetPreparedProjectCSS(fresh),
        undefined,
        "a pre-invalidation write must not repopulate the cache for a current-epoch reader",
      );
    } finally {
      invalidatePreparedProjectCSS(projectSlug);
    }
  });
});
