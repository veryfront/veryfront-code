import "#veryfront/schemas/_test-setup.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_CSS_OUTPUT_FILE_BYTES } from "#veryfront/utils/constants/css.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import { hashCSS } from "./css-identity.ts";
import {
  createPreparedProjectCSSContext,
  initializePreparedProjectCSSCache,
  invalidatePreparedProjectCSS,
  storePreparedProjectCSS,
  tryGetPreparedProjectCSS,
} from "./prepared-project-css-cache.ts";

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

  it("snapshots prepared cache keys and values before initialization yields", async () => {
    const projectSlug = `prepared-snapshot-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      { cssPipelineIdentity: "test-css-pipeline@snapshot" },
    );
    const lookupContext = { ...context };
    const originalCss = ".original{}";
    const entry = { css: originalCss, hash: hashCSS(originalCss) };
    const originalSet = MemoryCacheBackend.prototype.set;
    const writes: Array<{ key: string; value: string }> = [];
    MemoryCacheBackend.prototype.set = function (key, value) {
      writes.push({ key, value });
      return Promise.resolve();
    };

    try {
      const initializing = initializePreparedProjectCSSCache();
      const storing = storePreparedProjectCSS(context, entry);
      const mutatedCss = ".mutated{}";
      context.cacheKey = "mutated-cache-key";
      entry.css = mutatedCss;
      entry.hash = hashCSS(mutatedCss);
      await initializing;
      await storing;
      await Promise.resolve();

      assertEquals(writes[0]?.key, lookupContext.cacheKey);
      assertEquals(JSON.parse(writes[0]!.value), {
        css: originalCss,
        hash: hashCSS(originalCss),
      });
      assertEquals((await tryGetPreparedProjectCSS(lookupContext))?.css, originalCss);
    } finally {
      MemoryCacheBackend.prototype.set = originalSet;
      invalidatePreparedProjectCSS(projectSlug);
    }
  });

  it("does not retain oversized prepared CSS when storage is rejected", async () => {
    const projectSlug = `oversized-prepared-css-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      { cssPipelineIdentity: "test-css-pipeline@oversized" },
    );
    const css = "x".repeat(MAX_CSS_OUTPUT_FILE_BYTES + 1);

    try {
      await assertRejects(
        () => storePreparedProjectCSS(context, { css, hash: hashCSS(css) }),
        TypeError,
        `${MAX_CSS_OUTPUT_FILE_BYTES} bytes`,
      );
      assertEquals(await tryGetPreparedProjectCSS(context), undefined);
    } finally {
      invalidatePreparedProjectCSS(projectSlug);
    }
  });

  it("evicts the least-recently-used prepared CSS under retained-byte pressure", async () => {
    const projectSlugs = ["prepared-byte-a", "prepared-byte-b", "prepared-byte-c"].map((prefix) =>
      `${prefix}-${crypto.randomUUID()}`
    );
    const contexts = projectSlugs.map((projectSlug) =>
      createPreparedProjectCSSContext(
        projectSlug,
        "release:one",
        "@tailwind utilities;",
        "a".repeat(64),
        { cssPipelineIdentity: "test-css-pipeline@prepared-byte-pressure" },
      )
    );
    const entries = contexts.map((_, index) => {
      const css = `/*${index}*/${String(index).repeat(7 * 1024 * 1024)}`;
      return { css, hash: hashCSS(css) };
    });
    const originalGetWithinLimit = MemoryCacheBackend.prototype.getWithinLimit;

    try {
      await storePreparedProjectCSS(contexts[0]!, entries[0]!);
      await storePreparedProjectCSS(contexts[1]!, entries[1]!);
      assertEquals((await tryGetPreparedProjectCSS(contexts[0]!)) !== undefined, true);
      await storePreparedProjectCSS(contexts[2]!, entries[2]!);
      MemoryCacheBackend.prototype.getWithinLimit = () => Promise.resolve(null);

      assertEquals((await tryGetPreparedProjectCSS(contexts[0]!)) !== undefined, true);
      assertEquals((await tryGetPreparedProjectCSS(contexts[1]!)) === undefined, true);
    } finally {
      MemoryCacheBackend.prototype.getWithinLimit = originalGetWithinLimit;
      for (const projectSlug of projectSlugs) invalidatePreparedProjectCSS(projectSlug);
    }
  });

  it("skips one prepared CSS entry above the local retained-byte limit", async () => {
    const projectSlug = `prepared-byte-oversized-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      { cssPipelineIdentity: "test-css-pipeline@prepared-byte-oversized" },
    );
    const css = "x".repeat(9 * 1024 * 1024);
    const originalGetWithinLimit = MemoryCacheBackend.prototype.getWithinLimit;

    try {
      await storePreparedProjectCSS(context, { css, hash: hashCSS(css) });
      MemoryCacheBackend.prototype.getWithinLimit = () => Promise.resolve(null);
      assertEquals((await tryGetPreparedProjectCSS(context)) === undefined, true);
    } finally {
      MemoryCacheBackend.prototype.getWithinLimit = originalGetWithinLimit;
      invalidatePreparedProjectCSS(projectSlug);
    }
  });

  it("reports conservative retained bytes for the local prepared CSS cache", async () => {
    const projectSlug = `prepared-byte-stats-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      { cssPipelineIdentity: "test-css-pipeline@prepared-byte-stats" },
    );
    const css = ".stats{color:green}";

    try {
      await storePreparedProjectCSS(context, { css, hash: hashCSS(css) });
      const stats = getCacheStats().find((entry) => entry.name === "prepared-project-css-cache");
      assertEquals(typeof stats?.estimatedSizeBytes, "number");
      assertEquals((stats?.estimatedSizeBytes ?? 0) > css.length, true);
    } finally {
      invalidatePreparedProjectCSS(projectSlug);
    }
  });

  it("rejects unknown nested fields before JSON.parse can materialize them", async () => {
    const projectSlug = `prepared-nested-frame-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      { cssPipelineIdentity: "test-css-pipeline@prepared-nested-frame" },
    );
    const css = "";
    const raw = `{"css":"","hash":"${hashCSS(css)}","graph":[${"[],".repeat(50_000)}[]]}`;
    const originalGetWithinLimit = MemoryCacheBackend.prototype.getWithinLimit;
    const originalParse = JSON.parse;
    let parseCalls = 0;
    MemoryCacheBackend.prototype.getWithinLimit = () => Promise.resolve(raw);
    JSON.parse = ((...args: Parameters<typeof JSON.parse>) => {
      parseCalls++;
      return originalParse(...args);
    }) as typeof JSON.parse;

    try {
      await assertRejects(
        () => tryGetPreparedProjectCSS(context),
        TypeError,
        'unsupported field "graph"',
      );
      assertEquals(parseCalls, 0);
    } finally {
      JSON.parse = originalParse;
      MemoryCacheBackend.prototype.getWithinLimit = originalGetWithinLimit;
      invalidatePreparedProjectCSS(projectSlug);
    }
  });

  it("does not accept inherited prepared cache fields", async () => {
    const projectSlug = `prepared-prototype-frame-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      { cssPipelineIdentity: "test-css-pipeline@prepared-prototype-frame" },
    );
    const originalGetWithinLimit = MemoryCacheBackend.prototype.getWithinLimit;
    const inherited = Object.prototype as Record<string, unknown>;
    MemoryCacheBackend.prototype.getWithinLimit = () => Promise.resolve("{}");
    Object.defineProperties(inherited, {
      css: { configurable: true, value: "" },
      hash: { configurable: true, value: hashCSS("") },
    });

    try {
      assertEquals(await tryGetPreparedProjectCSS(context), undefined);
    } finally {
      delete inherited.css;
      delete inherited.hash;
      MemoryCacheBackend.prototype.getWithinLimit = originalGetWithinLimit;
      invalidatePreparedProjectCSS(projectSlug);
    }
  });
});
