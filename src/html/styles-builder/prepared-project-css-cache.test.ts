import "#veryfront/schemas/_test-setup.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import { compileCacheGlob } from "#veryfront/cache/backends/glob.ts";
import { API_CACHE_KEY_MAX_LENGTH } from "#veryfront/cache/keys/api-policy.ts";
import { sanitizeCacheKey } from "#veryfront/cache/keys/utils.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_CSS_OUTPUT_FILE_BYTES } from "#veryfront/utils/constants/css.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import { hashCSS } from "./css-identity.ts";
import {
  createPreparedProjectCSSContext,
  initializePreparedProjectCSSCache,
  invalidatePreparedProjectCSS,
  invalidatePreparedProjectCSSAsync,
  storePreparedProjectCSS,
  tryGetPreparedProjectCSS,
} from "./prepared-project-css-cache.ts";

const TEST_CANDIDATES_HASH = "b".repeat(64);

async function assertPreparedProjectCSSInvalidationIsolation(
  targetSlug: string,
  unrelatedSlug: string,
): Promise<void> {
  const profile = {
    cssPipelineIdentity: "test-css-pipeline@prepared-scope-isolation",
    candidatesHash: TEST_CANDIDATES_HASH,
  } as const;
  const target = createPreparedProjectCSSContext(
    targetSlug,
    "branch:main",
    "@tailwind utilities;",
    "a".repeat(64),
    profile,
  );
  const unrelated = createPreparedProjectCSSContext(
    unrelatedSlug,
    "branch:main",
    "@tailwind utilities;",
    "a".repeat(64),
    profile,
  );
  const targetCSS = ".target{color:red}";
  const unrelatedCSS = ".unrelated{color:green}";
  const originalDelByPattern = MemoryCacheBackend.prototype.delByPattern;
  let pattern = "";
  MemoryCacheBackend.prototype.delByPattern = function (candidatePattern) {
    pattern = candidatePattern;
    return originalDelByPattern.call(this, candidatePattern);
  };

  try {
    await Promise.all([
      storePreparedProjectCSS(target, { css: targetCSS, hash: hashCSS(targetCSS) }),
      storePreparedProjectCSS(unrelated, { css: unrelatedCSS, hash: hashCSS(unrelatedCSS) }),
    ]);
    await invalidatePreparedProjectCSSAsync(targetSlug);

    const glob = compileCacheGlob(pattern);
    assertEquals(glob?.test(target.cacheKey), true);
    assertEquals(glob?.test(unrelated.cacheKey), false);
    assertEquals(await tryGetPreparedProjectCSS(target), undefined);
    assertEquals((await tryGetPreparedProjectCSS(unrelated))?.css, unrelatedCSS);
  } finally {
    MemoryCacheBackend.prototype.delByPattern = originalDelByPattern;
    await Promise.allSettled([
      invalidatePreparedProjectCSSAsync(targetSlug),
      invalidatePreparedProjectCSSAsync(unrelatedSlug),
    ]);
  }
}

describe("styles-builder/prepared-project-css-cache", () => {
  it("builds versioned full-digest identities isolated by project and content version", () => {
    const profile = {
      environment: "production",
      minify: true,
      cssPipelineIdentity: "tailwindcss@installed:base-css@audited",
      candidatesHash: TEST_CANDIDATES_HASH,
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
    const differentCandidatesProfile = { ...profile, candidatesHash: "c".repeat(64) };
    const differentCandidates = createPreparedProjectCSSContext(
      "project-a",
      "release:one",
      "@import 'tailwindcss';",
      "a".repeat(64),
      differentCandidatesProfile,
    );
    const differentStylesheet = createPreparedProjectCSSContext(
      "project-a",
      "release:one",
      "@tailwind base;",
      "a".repeat(64),
      profile,
    );
    const differentStyleProfile = createPreparedProjectCSSContext(
      "project-a",
      "release:one",
      "@import 'tailwindcss';",
      "d".repeat(64),
      profile,
    );

    assertEquals(first.cacheKey !== differentProject.cacheKey, true);
    assertEquals(first.cacheKey !== differentVersion.cacheKey, true);
    assertEquals(first.cacheKey !== differentCompiler.cacheKey, true);
    assertEquals(first.cacheKey !== differentCandidates.cacheKey, true);
    assertEquals(first.cacheKey !== differentStylesheet.cacheKey, true);
    assertEquals(first.cacheKey !== differentStyleProfile.cacheKey, true);
    assertEquals(
      first.cacheKey,
      "v5:sproject-a_:sproduction_:bcb29ee1a404a56e995200beedbd88fcafe321dd58c44b667ef2e25efef5b644",
    );
    assertEquals(first.cacheKey.startsWith("v5:"), true);
    assertEquals(first.cacheKey.split(":").length, 4);
    assertEquals(
      first.cacheKey.split(":")[3]?.match(/^[a-f0-9]{64}$/)?.[0],
      first.cacheKey.split(":")[3],
    );
    assertEquals(first.stylesheetHash.match(/^[a-f0-9]{64}$/)?.[0], first.stylesheetHash);
    assertEquals(first.profileHash.match(/^[a-f0-9]{64}$/)?.[0], first.profileHash);
  });

  it("keeps hostile scopes and environments exact, bounded, and directly addressable", async () => {
    const scopes = [
      "*",
      "?",
      "tenant:branch",
      "Malmö/東京",
      "lone-high-\ud800",
      "lone-low-\udc00",
      "tenant-vf-sanitized",
      "a".repeat(256),
    ];
    const contexts = scopes.map((projectSlug, index) =>
      createPreparedProjectCSSContext(
        projectSlug,
        "release:one",
        "@tailwind utilities;",
        "a".repeat(64),
        {
          cssPipelineIdentity: "test-css-pipeline@prepared-bounded-scope",
          candidatesHash: TEST_CANDIDATES_HASH,
          environment: index === 0 ? "preview-vf-sanitized" : "preview",
        },
      )
    );

    for (const context of contexts) {
      const physicalKey = `prepared-project-css:${context.cacheKey}`;
      assertEquals(context.cacheKey.split(":").length, 4);
      assertEquals(physicalKey.length <= API_CACHE_KEY_MAX_LENGTH, true);
      assertEquals(physicalKey.includes("vf-sanitized:"), false);
      assertEquals(await sanitizeCacheKey(physicalKey), physicalKey);
    }
    assertEquals(new Set(contexts.map(({ cacheKey }) => cacheKey)).size, contexts.length);
  });

  it("isolates hostile and delimiter-neighbor scopes under Redis-compatible globs", async () => {
    const suffix = crypto.randomUUID();
    await assertPreparedProjectCSSInvalidationIsolation(`*${suffix}`, `other-${suffix}`);
    await assertPreparedProjectCSSInvalidationIsolation(`?${suffix}`, `x${suffix}`);
    const parent = `parent-${suffix}`;
    await assertPreparedProjectCSSInvalidationIsolation(parent, `${parent}:child`);
    await assertPreparedProjectCSSInvalidationIsolation(
      `Malmö/東京-${suffix}`,
      `Malmö/大阪-${suffix}`,
    );
    await assertPreparedProjectCSSInvalidationIsolation(
      `lone-high-\ud800-${suffix}`,
      `replacement-�-${suffix}`,
    );
    await assertPreparedProjectCSSInvalidationIsolation(
      "a".repeat(256),
      `${"a".repeat(255)}b`,
    );
  });

  it("retains the established 24-hour distributed expiry contract", async () => {
    const projectSlug = `prepared-ttl-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      {
        cssPipelineIdentity: "test-css-pipeline@prepared-ttl",
        candidatesHash: TEST_CANDIDATES_HASH,
      },
    );
    const css = ".ttl{}";
    const originalSet = MemoryCacheBackend.prototype.set;
    const ttl = Promise.withResolvers<number | undefined>();
    MemoryCacheBackend.prototype.set = function (key, value, ttlSeconds) {
      if (key === context.cacheKey) ttl.resolve(ttlSeconds);
      return originalSet.call(this, key, value, ttlSeconds);
    };

    try {
      await storePreparedProjectCSS(context, { css, hash: hashCSS(css) });
      assertEquals(await ttl.promise, 24 * 3600);
    } finally {
      MemoryCacheBackend.prototype.set = originalSet;
      await invalidatePreparedProjectCSSAsync(projectSlug);
    }
  });

  it("does not reuse stale prepared CSS across candidate snapshots and invalidates both", async () => {
    const projectSlug = `prepared-candidate-identity-${crypto.randomUUID()}`;
    const sharedProfile = {
      cssPipelineIdentity: "test-css-pipeline@candidate-identity",
      candidatesHash: "b".repeat(64),
    };
    const staleContext = createPreparedProjectCSSContext(
      projectSlug,
      "branch:main",
      "@tailwind utilities;",
      "a".repeat(64),
      sharedProfile,
    );
    const currentProfile = { ...sharedProfile, candidatesHash: "c".repeat(64) };
    const currentContext = createPreparedProjectCSSContext(
      projectSlug,
      "branch:main",
      "@tailwind utilities;",
      "a".repeat(64),
      currentProfile,
    );
    const staleCSS = ".stale{}";
    const currentCSS = ".current{}";

    try {
      await storePreparedProjectCSS(staleContext, {
        css: staleCSS,
        hash: hashCSS(staleCSS),
      });
      assertEquals(await tryGetPreparedProjectCSS(currentContext), undefined);

      await storePreparedProjectCSS(currentContext, {
        css: currentCSS,
        hash: hashCSS(currentCSS),
      });
      await invalidatePreparedProjectCSSAsync(projectSlug);

      assertEquals(await tryGetPreparedProjectCSS(staleContext), undefined);
      assertEquals(await tryGetPreparedProjectCSS(currentContext), undefined);
    } finally {
      await invalidatePreparedProjectCSSAsync(projectSlug);
    }
  });

  it("rejects invalid pipeline and style-profile identities before deriving cache keys", () => {
    assertThrows(
      () =>
        createPreparedProjectCSSContext(
          "project-a",
          "release:one",
          "@import 'tailwindcss';",
          "not-a-profile-hash",
          { cssPipelineIdentity: "pipeline@1", candidatesHash: TEST_CANDIDATES_HASH },
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
          {
            cssPipelineIdentity: "pipeline\nidentity",
            candidatesHash: TEST_CANDIDATES_HASH,
          },
        ),
      TypeError,
      "CSS pipeline identity",
    );
    assertThrows(
      () =>
        Reflect.apply(createPreparedProjectCSSContext, undefined, [
          "project-a",
          "release:one",
          "@import 'tailwindcss';",
          "a".repeat(64),
          { cssPipelineIdentity: "pipeline@1" },
        ]),
      TypeError,
      "candidate identity",
    );
    assertThrows(
      () =>
        createPreparedProjectCSSContext(
          "project-a",
          "release:one",
          "@import 'tailwindcss';",
          "a".repeat(64),
          { cssPipelineIdentity: "pipeline@1", candidatesHash: "not-a-digest" },
        ),
      TypeError,
      "candidate identity",
    );
  });

  it("snapshots prepared cache keys and values before initialization yields", async () => {
    const projectSlug = `prepared-snapshot-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      {
        cssPipelineIdentity: "test-css-pipeline@snapshot",
        candidatesHash: TEST_CANDIDATES_HASH,
      },
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

  it("fences a prepared CSS write that started before awaited invalidation", async () => {
    const projectSlug = `prepared-invalidation-fence-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      {
        cssPipelineIdentity: "test-css-pipeline@invalidation-fence",
        candidatesHash: TEST_CANDIDATES_HASH,
      },
    );
    const css = ".stale{}";
    const originalSet = MemoryCacheBackend.prototype.set;
    const setStarted = Promise.withResolvers<void>();
    const releaseSet = Promise.withResolvers<void>();
    const setFinished = Promise.withResolvers<void>();
    let storing: Promise<void> | undefined;
    let invalidating: Promise<void> | undefined;

    MemoryCacheBackend.prototype.set = async function (key, value, ttlSeconds) {
      if (key !== context.cacheKey) {
        await originalSet.call(this, key, value, ttlSeconds);
        return;
      }
      setStarted.resolve();
      await releaseSet.promise;
      await originalSet.call(this, key, value, ttlSeconds);
      setFinished.resolve();
    };

    try {
      await initializePreparedProjectCSSCache();
      storing = storePreparedProjectCSS(context, { css, hash: hashCSS(css) });
      await setStarted.promise;

      invalidating = invalidatePreparedProjectCSSAsync(projectSlug);
      // Let an unfenced invalidation reach its delete before the older set is released.
      await Promise.resolve();
      await Promise.resolve();
      releaseSet.resolve();

      await Promise.all([storing, setFinished.promise, invalidating]);
      assertEquals(await tryGetPreparedProjectCSS(context), undefined);
    } finally {
      releaseSet.resolve();
      await Promise.allSettled([
        storing ?? Promise.resolve(),
        invalidating ?? Promise.resolve(),
        setFinished.promise,
      ]);
      MemoryCacheBackend.prototype.set = originalSet;
      await invalidatePreparedProjectCSSAsync(projectSlug);
    }
  });

  it("propagates the exact awaited invalidation failure and contains wrapper failures", async () => {
    const projectSlug = `prepared-invalidation-error-${crypto.randomUUID()}`;
    const sentinel = new Error("prepared invalidation sentinel");
    const originalDelByPattern = MemoryCacheBackend.prototype.delByPattern;
    const wrapperAttempted = Promise.withResolvers<void>();
    let attempts = 0;
    MemoryCacheBackend.prototype.delByPattern = () => {
      attempts++;
      if (attempts === 2) wrapperAttempted.resolve();
      return Promise.reject(sentinel);
    };

    try {
      await initializePreparedProjectCSSCache();
      const rejection = await assertRejects(
        () => invalidatePreparedProjectCSSAsync(projectSlug),
      );
      assertEquals(rejection === sentinel, true);

      assertEquals(invalidatePreparedProjectCSS(projectSlug), undefined);
      await wrapperAttempted.promise;
      await Promise.resolve();
      await Promise.resolve();
      assertEquals(attempts, 2);
    } finally {
      MemoryCacheBackend.prototype.delByPattern = originalDelByPattern;
    }
  });

  it("does not retain oversized prepared CSS when storage is rejected", async () => {
    const projectSlug = `oversized-prepared-css-${crypto.randomUUID()}`;
    const context = createPreparedProjectCSSContext(
      projectSlug,
      "release:one",
      "@tailwind utilities;",
      "a".repeat(64),
      {
        cssPipelineIdentity: "test-css-pipeline@oversized",
        candidatesHash: TEST_CANDIDATES_HASH,
      },
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
        {
          cssPipelineIdentity: "test-css-pipeline@prepared-byte-pressure",
          candidatesHash: TEST_CANDIDATES_HASH,
        },
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
      {
        cssPipelineIdentity: "test-css-pipeline@prepared-byte-oversized",
        candidatesHash: TEST_CANDIDATES_HASH,
      },
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
      {
        cssPipelineIdentity: "test-css-pipeline@prepared-byte-stats",
        candidatesHash: TEST_CANDIDATES_HASH,
      },
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
      {
        cssPipelineIdentity: "test-css-pipeline@prepared-nested-frame",
        candidatesHash: TEST_CANDIDATES_HASH,
      },
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
      {
        cssPipelineIdentity: "test-css-pipeline@prepared-prototype-frame",
        candidatesHash: TEST_CANDIDATES_HASH,
      },
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
