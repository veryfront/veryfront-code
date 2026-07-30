import "#veryfront/schemas/_test-setup.ts";
import "./__tests__/css-processor-setup.ts";
import type { CSSProcessor } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createTestCSSOptimizationEngine,
  withTestCSSOptimizationEngine,
} from "../../../tests/_helpers/css-optimization-engine.ts";
import {
  acquireCSSGenerationSession,
  clearCSSCache,
  getCSSByHash,
  getProjectCSS,
  invalidateCompiler,
  invalidateProjectCSS,
} from "./css-compiler.ts";
import { createProjectCSSRequestContext } from "./project-css-cache.ts";

// Simple stylesheet without plugins — avoids loading @tailwindcss/typography from esm.sh in tests
const TEST_STYLESHEET = `@import "tailwindcss";`;

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
    assertEquals(first.cacheKey.includes(":v4:"), true);
    assertEquals(first.candidatesHash.match(/^[a-f0-9]{64}$/)?.[0], first.candidatesHash);
    assertEquals(first.profileHash.match(/^[a-f0-9]{64}$/)?.[0], first.profileHash);
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
