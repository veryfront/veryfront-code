import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { TAILWIND_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { hashString } from "./candidate-extractor.ts";
import {
  createPreparedProjectCSSContext,
  invalidatePreparedProjectCSS,
  invalidatePreparedProjectCSSAsync,
  storePreparedProjectCSS,
  tryGetPreparedProjectCSS,
} from "./prepared-project-css-cache.ts";

describe("styles-builder/prepared-project-css-cache", () => {
  it("does not reuse cache keys for colliding legacy string hashes", () => {
    const first = createPreparedProjectCSSContext(
      "project",
      "version",
      "Aa",
      "0123456789abcdef",
    );
    const second = createPreparedProjectCSSContext(
      "project",
      "version",
      "BB",
      "0123456789abcdef",
    );

    assertEquals(first.cacheKey === second.cacheKey, false);
    assertEquals(first.stylesheetHash === second.stylesheetHash, false);
  });

  it("rejects project identifiers that can escape cache-key namespaces", () => {
    assertThrows(
      () =>
        createPreparedProjectCSSContext(
          "../project:other",
          "version",
          "body{}",
          "0123456789abcdef",
        ),
      Error,
      "Invalid project slug",
    );
  });

  it("rejects oversized project versions before constructing cache keys", () => {
    assertThrows(
      () =>
        createPreparedProjectCSSContext(
          "project",
          "v".repeat(513),
          "body{}",
          "0123456789abcdef",
        ),
      Error,
      "Invalid project version",
    );
  });

  it("partitions prepared artifacts by Tailwind compiler version", () => {
    const context = createPreparedProjectCSSContext(
      "project",
      "version",
      "body{}",
      "0123456789abcdef",
    );

    assertEquals(
      context.profileHash,
      hashString(
        JSON.stringify({
          cacheSchema: "v3",
          tailwindVersion: TAILWIND_VERSION,
          minify: false,
          buildMode: "production",
          environment: "preview",
        }),
      ),
    );
  });

  it("round-trips prepared artifacts and invalidates the project namespace", async () => {
    const projectSlug = `prepared-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release-1",
      "body{}",
      "0123456789abcdef",
    );

    try {
      assertEquals(await tryGetPreparedProjectCSS(context), undefined);
      await storePreparedProjectCSS(context, { css: "body{color:red}", hash: "hash-1" });
      assertEquals(await tryGetPreparedProjectCSS(context), {
        css: "body{color:red}",
        hash: "hash-1",
        fromCache: true,
      });

      invalidatePreparedProjectCSS(projectSlug);
      await invalidatePreparedProjectCSSAsync(projectSlug);
      assertEquals(await tryGetPreparedProjectCSS(context), undefined);
    } finally {
      invalidatePreparedProjectCSS(projectSlug);
      await invalidatePreparedProjectCSSAsync(projectSlug);
    }
  });

  it("rejects malformed prepared artifacts before cache writes", async () => {
    const context = createPreparedProjectCSSContext(
      "project",
      "release-1",
      "body{}",
      "0123456789abcdef",
    );

    await assertRejects(
      () => storePreparedProjectCSS(context, { css: "body{}", hash: "invalid/hash" }),
      Error,
      "Invalid prepared project CSS entry",
    );
  });
});
