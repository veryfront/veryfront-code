import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/css-processor-setup.ts";
import type { CSSProcessor } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MAX_CSS_OUTPUT_FILE_BYTES } from "#veryfront/utils/constants/css.ts";
import { API_CACHE_KEY_MAX_LENGTH } from "#veryfront/cache/keys/api-policy.ts";
import { getCacheStats } from "#veryfront/utils/memory/index.ts";
import { MemoryCacheBackend } from "#veryfront/cache/backend.ts";
import {
  createTestCSSOptimizationEngine,
  withTestCSSOptimizationEngine,
} from "../../../tests/_helpers/css-optimization-engine.ts";
import {
  acquireCSSGenerationSession,
  clearCSSCache,
  getCSSByHash,
  getProjectCSS,
  hashCSS,
  invalidateCompiler,
  invalidateProjectCSS,
} from "./css-compiler.ts";
import {
  createProjectCSSRequestContext,
  initializeProjectCSSCache,
  invalidateProjectCSSAsync,
  storeProjectCSS,
  tryGetProjectCSSFromDistributedCache,
  tryGetProjectCSSFromLocalFallback,
} from "./project-css-cache.ts";

// Simple stylesheet without plugins — avoids loading @tailwindcss/typography from esm.sh in tests
const TEST_STYLESHEET = `@import "tailwindcss";`;

async function assertProjectCSSInvalidationIsolation(
  targetSlug: string,
  unrelatedSlug: string,
  candidate: string,
): Promise<void> {
  const candidates = new Set([candidate]);
  const target = createProjectCSSRequestContext(targetSlug, TEST_STYLESHEET, candidates, {
    cssPipelineIdentity: "test-css-pipeline@scope-isolation",
  });
  const unrelated = createProjectCSSRequestContext(
    unrelatedSlug,
    TEST_STYLESHEET,
    candidates,
    { cssPipelineIdentity: "test-css-pipeline@scope-isolation" },
  );
  const targetCss = ".target{color:red}";
  const unrelatedCss = ".unrelated{color:green}";

  try {
    await initializeProjectCSSCache();
    await Promise.all([
      storeProjectCSS(target, {
        css: targetCss,
        hash: hashCSS(targetCss),
        candidatesHash: target.candidatesHash,
      }, candidates),
      storeProjectCSS(unrelated, {
        css: unrelatedCss,
        hash: hashCSS(unrelatedCss),
        candidatesHash: unrelated.candidatesHash,
      }, candidates),
    ]);

    await invalidateProjectCSSAsync(targetSlug);

    assertEquals(await tryGetProjectCSSFromLocalFallback(target, candidates), undefined);
    assertEquals(
      (await tryGetProjectCSSFromLocalFallback(unrelated, candidates))?.css,
      unrelatedCss,
    );
    assertEquals(await tryGetProjectCSSFromDistributedCache(target, candidates), undefined);
    assertEquals(
      (await tryGetProjectCSSFromDistributedCache(unrelated, candidates))?.css,
      unrelatedCss,
    );
  } finally {
    clearCSSCache();
    await Promise.allSettled([
      invalidateProjectCSSAsync(targetSlug),
      invalidateProjectCSSAsync(unrelatedSlug),
    ]);
  }
}

describe("styles-builder/project-css-cache", () => {
  it("builds versioned, collision-resistant identities isolated by project and candidate tuple", () => {
    const profile = {
      environment: "production",
      minify: true,
      cssPipelineIdentity: "tailwindcss@installed:base-css@audited",
    } as const;
    const first = createProjectCSSRequestContext(
      "project-a",
      TEST_STYLESHEET,
      new Set(["a,b", "c"]),
      profile,
    );
    const reordered = createProjectCSSRequestContext(
      "project-a",
      TEST_STYLESHEET,
      new Set(["c", "a,b"]),
      profile,
    );
    const differentCandidates = createProjectCSSRequestContext(
      "project-a",
      TEST_STYLESHEET,
      new Set(["a", "b,c"]),
      profile,
    );
    const differentProject = createProjectCSSRequestContext(
      "project-b",
      TEST_STYLESHEET,
      new Set(["a,b", "c"]),
      profile,
    );
    const differentCompiler = createProjectCSSRequestContext(
      "project-a",
      TEST_STYLESHEET,
      new Set(["a,b", "c"]),
      { ...profile, cssPipelineIdentity: "tailwindcss@next:base-css@audited" },
    );

    assertEquals(first.cacheKey, reordered.cacheKey);
    assertEquals(first.cacheKey !== differentCandidates.cacheKey, true);
    assertEquals(first.cacheKey !== differentProject.cacheKey, true);
    assertEquals(first.cacheKey !== differentCompiler.cacheKey, true);
    assertEquals(first.cacheKey.startsWith("v5:"), true);
    assertEquals(first.cacheKey.split(":").length, 6);
    assertEquals(first.candidatesHash.match(/^[a-f0-9]{64}$/)?.[0], first.candidatesHash);
    assertEquals(first.profileHash.match(/^[a-f0-9]{64}$/)?.[0], first.profileHash);
  });

  it("fences arbitrary project scopes in one bounded injective cache-key segment", () => {
    const profile = {
      environment: "preview",
      cssPipelineIdentity: "test-css-pipeline@scope-fencing",
    } as const;
    const scopes = [
      "*",
      "?",
      "tenant:branch",
      "Malmö/東京",
      "lone-high-\ud800",
      "replacement-�",
      "literal-\\ud800",
    ];
    const contexts = scopes.map((scope) =>
      createProjectCSSRequestContext(scope, TEST_STYLESHEET, new Set(["scope-fencing"]), profile)
    );

    for (const context of contexts) {
      const segments = context.cacheKey.split(":");
      assertEquals(segments.length, 6);
      assertEquals(segments[0], "v5");
      assertEquals(/^[A-Za-z0-9_./-]+$/.test(segments[1]!), true);
      assertEquals(/^[A-Za-z0-9_./-]+$/.test(segments[2]!), true);
      assertEquals(`project-css:${context.cacheKey}`.length <= API_CACHE_KEY_MAX_LENGTH, true);
    }
    assertEquals(new Set(contexts.map(({ cacheKey }) => cacheKey)).size, scopes.length);
  });

  it("rejects a project scope whose encoded cache identity exceeds the shared key bound", () => {
    assertThrows(
      () =>
        createProjectCSSRequestContext(
          "x".repeat(API_CACHE_KEY_MAX_LENGTH),
          TEST_STYLESHEET,
          new Set(["oversized-scope"]),
          { cssPipelineIdentity: "test-css-pipeline@oversized-scope" },
        ),
      RangeError,
      `${API_CACHE_KEY_MAX_LENGTH} characters`,
    );
  });

  it("rejects non-canonical pipeline identities before deriving cache keys", () => {
    assertThrows(
      () =>
        createProjectCSSRequestContext(
          "project-a",
          TEST_STYLESHEET,
          new Set(["p-4"]),
          { cssPipelineIdentity: "pipeline\u0000identity" },
        ),
      TypeError,
      "CSS pipeline identity",
    );
  });

  it("snapshots project cache keys and values before deferred storage", async () => {
    const projectSlug = `project-snapshot-${crypto.randomUUID()}`;
    const candidates = new Set(["snapshot"]);
    const context = createProjectCSSRequestContext(
      projectSlug,
      TEST_STYLESHEET,
      candidates,
      { cssPipelineIdentity: "test-css-pipeline@snapshot" },
    );
    const lookupContext = { ...context };
    const originalCss = ".original{}";
    const entry = {
      css: originalCss,
      hash: hashCSS(originalCss),
      candidatesHash: context.candidatesHash,
    };
    const originalSet = MemoryCacheBackend.prototype.set;
    const writes: Array<{ key: string; value: string }> = [];
    MemoryCacheBackend.prototype.set = function (key, value) {
      writes.push({ key, value });
      return Promise.resolve();
    };

    try {
      await initializeProjectCSSCache();
      const storing = storeProjectCSS(context, entry, candidates);
      const mutatedCss = ".mutated{}";
      context.cacheKey = "mutated-cache-key";
      context.candidatesHash = "b".repeat(64);
      entry.css = mutatedCss;
      entry.hash = hashCSS(mutatedCss);
      entry.candidatesHash = context.candidatesHash;
      await storing;
      await Promise.resolve();

      const projectWrite = writes.find(({ value }) => value.includes('"candidatesHash"'));
      assertEquals(projectWrite?.key, lookupContext.cacheKey);
      assertEquals(JSON.parse(projectWrite!.value), {
        css: originalCss,
        hash: hashCSS(originalCss),
        candidatesHash: lookupContext.candidatesHash,
      });
      assertEquals(
        (await tryGetProjectCSSFromLocalFallback(lookupContext, candidates))?.css,
        originalCss,
      );
    } finally {
      MemoryCacheBackend.prototype.set = originalSet;
      clearCSSCache();
      invalidateProjectCSS(projectSlug);
    }
  });

  it("invalidates a wildcard-bearing project scope without deleting another project", async () => {
    const suffix = crypto.randomUUID();
    await assertProjectCSSInvalidationIsolation(
      `*${suffix}`,
      `unrelated-${suffix}`,
      `star-wildcard-${suffix}`,
    );
    await assertProjectCSSInvalidationIsolation(
      `?${suffix}`,
      `x${suffix}`,
      `question-wildcard-${suffix}`,
    );
  });

  it("invalidates a project without deleting a colon-delimited neighboring scope", async () => {
    const parentSlug = `project-${crypto.randomUUID()}`;
    await assertProjectCSSInvalidationIsolation(parentSlug, `${parentSlug}:child`, "colon-scope");
  });

  it("isolates Unicode, lone-surrogate, and maximum-length project scopes", async () => {
    const suffix = crypto.randomUUID();
    await assertProjectCSSInvalidationIsolation(
      `Malmö/東京-${suffix}`,
      `Malmö/大阪-${suffix}`,
      "unicode-scope",
    );
    await assertProjectCSSInvalidationIsolation(
      `lone-high-\ud800-${suffix}`,
      `replacement-�-${suffix}`,
      "lone-surrogate-scope",
    );
    await assertProjectCSSInvalidationIsolation(
      "a".repeat(256),
      `${"a".repeat(255)}b`,
      "maximum-scope",
    );
  });

  it("preserves the exact distributed invalidation failure", async () => {
    const projectSlug = `invalidation-failure-${crypto.randomUUID()}`;
    const failure = Object.freeze({ kind: "project-css-invalidation-failure" });
    const originalDelByPattern = MemoryCacheBackend.prototype.delByPattern;
    let received: unknown;

    MemoryCacheBackend.prototype.delByPattern = function () {
      return Promise.reject(failure);
    };

    try {
      await initializeProjectCSSCache();
      try {
        await invalidateProjectCSSAsync(projectSlug);
      } catch (error) {
        received = error;
      }
      assertEquals(received, failure);
    } finally {
      MemoryCacheBackend.prototype.delByPattern = originalDelByPattern;
      clearCSSCache();
      await invalidateProjectCSSAsync(projectSlug);
    }
  });

  it("retains the prior v4 24-hour distributed expiry contract after framing", async () => {
    const projectSlug = `project-css-ttl-${crypto.randomUUID()}`;
    const candidates = new Set(["ttl-contract"]);
    const context = createProjectCSSRequestContext(
      projectSlug,
      TEST_STYLESHEET,
      candidates,
      { cssPipelineIdentity: "test-css-pipeline@ttl-contract" },
    );
    const css = ".ttl{}";
    const originalSet = MemoryCacheBackend.prototype.set;
    const ttl = Promise.withResolvers<number | undefined>();
    MemoryCacheBackend.prototype.set = function (key, value, ttlSeconds) {
      if (key === context.cacheKey) ttl.resolve(ttlSeconds);
      return originalSet.call(this, key, value, ttlSeconds);
    };

    try {
      await initializeProjectCSSCache();
      await storeProjectCSS(
        context,
        { css, hash: hashCSS(css), candidatesHash: context.candidatesHash },
        candidates,
      );
      assertEquals(await ttl.promise, 24 * 3600);
    } finally {
      MemoryCacheBackend.prototype.set = originalSet;
      clearCSSCache();
      await invalidateProjectCSSAsync(projectSlug);
    }
  });

  it("fences a project CSS write that started before awaited invalidation", async () => {
    const projectSlug = `project-invalidation-fence-${crypto.randomUUID()}`;
    const candidates = new Set(["invalidation-fence"]);
    const context = createProjectCSSRequestContext(
      projectSlug,
      TEST_STYLESHEET,
      candidates,
      { cssPipelineIdentity: "test-css-pipeline@invalidation-fence" },
    );
    const css = ".stale{}";
    const entry = {
      css,
      hash: hashCSS(css),
      candidatesHash: context.candidatesHash,
    };
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
      await initializeProjectCSSCache();
      storing = storeProjectCSS(context, entry, candidates);
      await setStarted.promise;

      invalidating = invalidateProjectCSSAsync(projectSlug);
      // Let an unfenced invalidation reach its delete before the older set is released.
      await Promise.resolve();
      await Promise.resolve();
      releaseSet.resolve();

      await Promise.all([storing, setFinished.promise, invalidating]);
      assertEquals(
        await tryGetProjectCSSFromDistributedCache(context, candidates),
        undefined,
      );
    } finally {
      releaseSet.resolve();
      await Promise.allSettled([
        storing ?? Promise.resolve(),
        invalidating ?? Promise.resolve(),
        setFinished.promise,
      ]);
      MemoryCacheBackend.prototype.set = originalSet;
      clearCSSCache();
      await invalidateProjectCSSAsync(projectSlug);
    }
  });

  it("does not retain oversized project CSS when storage is rejected", async () => {
    const projectSlug = `oversized-project-css-${crypto.randomUUID()}`;
    const candidates = new Set(["oversized"]);
    const context = createProjectCSSRequestContext(
      projectSlug,
      TEST_STYLESHEET,
      candidates,
      { cssPipelineIdentity: "test-css-pipeline@oversized" },
    );
    const css = "x".repeat(MAX_CSS_OUTPUT_FILE_BYTES + 1);

    try {
      await assertRejects(
        () =>
          storeProjectCSS(
            context,
            {
              css,
              hash: hashCSS(css),
              candidatesHash: context.candidatesHash,
            },
            candidates,
          ),
        TypeError,
        `${MAX_CSS_OUTPUT_FILE_BYTES} bytes`,
      );
      assertEquals(
        await tryGetProjectCSSFromLocalFallback(context, candidates),
        undefined,
      );
    } finally {
      clearCSSCache();
      invalidateProjectCSS(projectSlug);
    }
  });

  it("evicts the least-recently-used project CSS under retained-byte pressure", async () => {
    const candidates = new Set(["byte-pressure"]);
    const projectSlugs = ["project-byte-a", "project-byte-b", "project-byte-c"].map((prefix) =>
      `${prefix}-${crypto.randomUUID()}`
    );
    const contexts = projectSlugs.map((projectSlug) =>
      createProjectCSSRequestContext(projectSlug, TEST_STYLESHEET, candidates, {
        cssPipelineIdentity: "test-css-pipeline@byte-pressure",
      })
    );
    const entries = contexts.map((context, index) => {
      const css = `/*${index}*/${String(index).repeat(7 * 1024 * 1024)}`;
      return { css, hash: hashCSS(css), candidatesHash: context.candidatesHash };
    });

    try {
      clearCSSCache();
      await storeProjectCSS(contexts[0]!, entries[0]!, candidates);
      await storeProjectCSS(contexts[1]!, entries[1]!, candidates);
      assertEquals(
        (await tryGetProjectCSSFromLocalFallback(contexts[0]!, candidates)) !== undefined,
        true,
      );
      await storeProjectCSS(contexts[2]!, entries[2]!, candidates);

      assertEquals(
        (await tryGetProjectCSSFromLocalFallback(contexts[0]!, candidates)) !== undefined,
        true,
      );
      assertEquals(
        (await tryGetProjectCSSFromLocalFallback(contexts[1]!, candidates)) === undefined,
        true,
      );
    } finally {
      clearCSSCache();
      for (const projectSlug of projectSlugs) invalidateProjectCSS(projectSlug);
    }
  });

  it("skips one project CSS entry above the local retained-byte limit", async () => {
    const projectSlug = `project-byte-oversized-${crypto.randomUUID()}`;
    const candidates = new Set(["byte-oversized"]);
    const context = createProjectCSSRequestContext(
      projectSlug,
      TEST_STYLESHEET,
      candidates,
      { cssPipelineIdentity: "test-css-pipeline@byte-oversized" },
    );
    const css = "x".repeat(9 * 1024 * 1024);

    try {
      await storeProjectCSS(
        context,
        { css, hash: hashCSS(css), candidatesHash: context.candidatesHash },
        candidates,
      );
      assertEquals(
        (await tryGetProjectCSSFromLocalFallback(context, candidates)) === undefined,
        true,
      );
    } finally {
      clearCSSCache();
      invalidateProjectCSS(projectSlug);
    }
  });

  it("reports conservative retained bytes for the local project CSS cache", async () => {
    const projectSlug = `project-byte-stats-${crypto.randomUUID()}`;
    const candidates = new Set(["byte-stats"]);
    const context = createProjectCSSRequestContext(
      projectSlug,
      TEST_STYLESHEET,
      candidates,
      { cssPipelineIdentity: "test-css-pipeline@byte-stats" },
    );
    const css = ".stats{color:green}";

    try {
      await storeProjectCSS(
        context,
        { css, hash: hashCSS(css), candidatesHash: context.candidatesHash },
        candidates,
      );
      const stats = getCacheStats().find((entry) => entry.name === "project-css-cache");
      assertEquals(typeof stats?.estimatedSizeBytes, "number");
      assertEquals((stats?.estimatedSizeBytes ?? 0) > css.length, true);
    } finally {
      clearCSSCache();
      invalidateProjectCSS(projectSlug);
    }
  });

  it("populates hash-level cache on fresh generation so other pods can serve CSS", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

      if (!url.includes("tailwindcss")) {
        return Promise.reject(new Error(`Unexpected fetch URL during test: ${url}`));
      }

      return Promise.resolve(
        new Response("@layer theme, base, components, utilities;", { status: 200 }),
      );
    }) as typeof fetch;

    const projectSlug = `hash-cache-test-${crypto.randomUUID()}`;

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);

      const candidates = new Set(["text-green-500"]);
      const result = await getProjectCSS(projectSlug, TEST_STYLESHEET, candidates, {
        minify: false,
      });
      assertEquals(result.fromCache, false);

      // After fresh generation, the hash-level local cache must contain the CSS.
      // This is what allows /_vf/css/{hash}.css to be served by any pod.
      const cached = getCSSByHash(result.hash);
      assertEquals(typeof cached, "string");
      assertEquals(cached!.length > 0, true);
    } finally {
      globalThis.fetch = originalFetch;
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });

  it("invalidates project CSS cache when candidates change or explicit invalidation runs", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((input: URL | Request | string) => {
      const url = typeof input === "string"
        ? input
        : input instanceof URL
        ? input.toString()
        : input.url;

      if (!url.includes("tailwindcss")) {
        return Promise.reject(new Error(`Unexpected fetch URL during test: ${url}`));
      }

      return Promise.resolve(
        new Response("@layer theme, base, components, utilities;", { status: 200 }),
      );
    }) as typeof fetch;

    const projectSlug = `cache-test-${crypto.randomUUID()}`;
    const stylesheet = TEST_STYLESHEET;
    const options = { minify: false };

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);

      const candidatesA = new Set(["text-red-500"]);
      const first = await getProjectCSS(projectSlug, stylesheet, candidatesA, options);
      assertEquals(first.fromCache, false);

      const second = await getProjectCSS(projectSlug, stylesheet, candidatesA, options);
      assertEquals(second.fromCache, true);
      assertEquals(second.hash, first.hash);

      const candidatesB = new Set(["text-blue-500"]);
      const third = await getProjectCSS(projectSlug, stylesheet, candidatesB, options);
      assertEquals(third.fromCache, false);

      const fourth = await getProjectCSS(projectSlug, stylesheet, candidatesB, options);
      assertEquals(fourth.fromCache, true);
      assertEquals(fourth.hash, third.hash);

      invalidateProjectCSS(projectSlug);

      const afterInvalidation = await getProjectCSS(projectSlug, stylesheet, candidatesB, options);
      assertEquals(afterInvalidation.fromCache, false);
    } finally {
      globalThis.fetch = originalFetch;
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });

  it("invalidates minified project CSS when the optimization engine changes", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("@layer theme, base, components, utilities;", {
          status: 200,
        }),
      )) as typeof fetch;
    const projectSlug = `optimizer-identity-${crypto.randomUUID()}`;
    const candidates = new Set(["text-red-500"]);

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);

      const first = await withTestCSSOptimizationEngine(
        createTestCSSOptimizationEngine(
          (request) => ({ css: `${request.css}/*engine-one*/` }),
          "test-engine@1",
        ),
        () =>
          getProjectCSS(projectSlug, TEST_STYLESHEET, candidates, {
            minify: true,
          }),
      );
      const second = await withTestCSSOptimizationEngine(
        createTestCSSOptimizationEngine(
          (request) => ({ css: `${request.css}/*engine-two*/` }),
          "test-engine@2",
        ),
        () =>
          getProjectCSS(projectSlug, TEST_STYLESHEET, candidates, {
            minify: true,
          }),
      );

      assertEquals(first.fromCache, false);
      assertEquals(second.fromCache, false);
      assertEquals(first.css.includes("engine-one"), true);
      assertEquals(second.css.includes("engine-two"), true);
      assertEquals(first.hash !== second.hash, true);
    } finally {
      globalThis.fetch = originalFetch;
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });

  it("uses the CSSProcessor captured with the cache identity despite a registry swap", async () => {
    const previousProcessor = tryResolve<CSSProcessor>("CSSProcessor");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("@layer theme, base, components, utilities;", {
          status: 200,
        }),
      )) as typeof fetch;
    const projectSlug = `processor-race-${crypto.randomUUID()}`;
    const createProcessor = (identity: string, output: string): CSSProcessor => ({
      cacheIdentity: identity,
      defaultStylesheet: TEST_STYLESHEET,
      compile: () => Promise.resolve({ build: () => output }),
    });

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
      register("CSSProcessor", createProcessor("processor-a@1", "/*processor-a*/"));
      const sessionA = await acquireCSSGenerationSession(false);

      register("CSSProcessor", createProcessor("processor-b@1", "/*processor-b*/"));
      const resultA = await getProjectCSS(
        projectSlug,
        TEST_STYLESHEET,
        new Set(["text-red-500"]),
        { minify: false },
        { generationSession: sessionA },
      );
      const resultB = await getProjectCSS(
        projectSlug,
        TEST_STYLESHEET,
        new Set(["text-red-500"]),
        { minify: false },
      );

      assertEquals(resultA.css, "/*processor-a*/");
      assertEquals(resultB.css, "/*processor-b*/");
      assertEquals(resultA.fromCache, false);
      assertEquals(resultB.fromCache, false);
      assertEquals(resultA.hash !== resultB.hash, true);
    } finally {
      unregister("CSSProcessor");
      if (previousProcessor !== undefined) {
        register("CSSProcessor", previousProcessor);
      }
      globalThis.fetch = originalFetch;
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });

  it("rejects an accessor-backed CSSCompiler without invoking the accessor", async () => {
    const previousProcessor = tryResolve<CSSProcessor>("CSSProcessor");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response("@layer theme, base, components, utilities;", {
          status: 200,
        }),
      )) as typeof fetch;
    const projectSlug = `compiler-boundary-${crypto.randomUUID()}`;
    let buildAccessorCalls = 0;
    const hostileCompiler = Object.create(null);
    Object.defineProperty(hostileCompiler, "build", {
      enumerable: true,
      get() {
        buildAccessorCalls++;
        return () => "wrong";
      },
    });

    try {
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
      register("CSSProcessor", {
        cacheIdentity: "hostile-compiler@1",
        defaultStylesheet: TEST_STYLESHEET,
        compile: () => Promise.resolve(hostileCompiler),
      } as CSSProcessor);

      await assertRejects(
        () =>
          getProjectCSS(
            projectSlug,
            TEST_STYLESHEET,
            new Set(["text-red-500"]),
            { minify: false },
          ),
        Error,
        "build must be a data-property function",
      );
      assertEquals(buildAccessorCalls, 0);
    } finally {
      unregister("CSSProcessor");
      if (previousProcessor !== undefined) {
        register("CSSProcessor", previousProcessor);
      }
      globalThis.fetch = originalFetch;
      clearCSSCache();
      invalidateCompiler();
      invalidateProjectCSS(projectSlug);
    }
  });
});
