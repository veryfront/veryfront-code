import "#veryfront/schemas/_test-setup.ts";
import { register, reset as resetContracts } from "#veryfront/extensions/contracts.ts";
import {
  type CSSOptimizationEngine,
  CSSOptimizationEngineName,
  type CSSProcessor,
  CSSProcessorName,
} from "#veryfront/extensions/css/index.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  acquireCSSGenerationSession,
  cacheCSSAsync,
  clearCSSCache,
  generateTailwindCSS,
  getCompilerCacheStats,
  getProjectCSS,
  hashCSS,
  invalidateCompiler,
  invalidateProjectCSS,
  regenerateCSSByHash,
} from "./tailwind-compiler.ts";

interface ProcessorCounters {
  compile: number;
  build: number;
}

function createProcessor(
  marker: string,
  defaultStylesheet = `default:${marker}`,
  counters: ProcessorCounters = { compile: 0, build: 0 },
): CSSProcessor {
  return {
    cacheIdentity: `test-processor:${marker}`,
    defaultStylesheet,
    async compile(stylesheet) {
      counters.compile++;
      return {
        build(candidates) {
          counters.build++;
          return `${marker}|${stylesheet}|${candidates.join(",")}`;
        },
      };
    },
  };
}

function createOptimizer(marker: string): CSSOptimizationEngine {
  return {
    cacheIdentity: `test-optimizer:${marker}`,
    optimize(request) {
      return { css: `${marker}[${request.css}]` };
    },
  };
}

function installProcessor(processor: CSSProcessor): void {
  register(CSSProcessorName, processor);
}

describe("styles-builder CSS provider sessions", () => {
  beforeEach(() => {
    resetContracts();
    clearCSSCache();
    invalidateCompiler();
  });

  afterEach(() => {
    resetContracts();
    clearCSSCache();
    invalidateCompiler();
  });

  it("keeps an acquired provider stable while registry changes affect only later operations", async () => {
    installProcessor(createProcessor("A"));
    const captured = acquireCSSGenerationSession(false);
    installProcessor(createProcessor("B"));

    const fromCaptured = await generateTailwindCSS("sheet", ["alpha"], { minify: false }, {
      generationSession: captured,
    });
    const fromCurrent = await generateTailwindCSS("sheet", ["alpha"], { minify: false });

    assertEquals(fromCaptured.css, "A|sheet|alpha");
    assertEquals(fromCurrent.css, "B|sheet|alpha");
    assertEquals(fromCaptured.cacheIdentity === fromCurrent.cacheIdentity, false);
  });

  it("keeps a provider stable across an await even when the registry changes", async () => {
    let releaseCompile: (() => void) | undefined;
    const compileGate = new Promise<void>((resolve) => {
      releaseCompile = resolve;
    });
    const processorA = createProcessor("await-A");
    installProcessor({
      ...processorA,
      async compile(stylesheet) {
        await compileGate;
        return await processorA.compile(stylesheet);
      },
    });

    const pending = generateTailwindCSS("sheet-await", ["alpha"], { minify: false });
    installProcessor(createProcessor("await-B"));
    releaseCompile!();

    assertEquals((await pending).css, "await-A|sheet-await|alpha");
    assertEquals(
      (await generateTailwindCSS("sheet-await", ["alpha"], { minify: false })).css,
      "await-B|sheet-await|alpha",
    );
  });

  it("single-flights only exact candidate snapshots and never leaks compiler state", async () => {
    const counters = { compile: 0, build: 0 };
    installProcessor(createProcessor("exact", "default:exact", counters));
    const session = acquireCSSGenerationSession(false);

    const [first, duplicate] = await Promise.all([
      generateTailwindCSS("sheet", ["alpha", "beta"], { minify: false }, {
        generationSession: session,
      }),
      generateTailwindCSS("sheet", new Set(["beta", "alpha"]), { minify: false }, {
        generationSession: session,
      }),
    ]);
    const isolated = await generateTailwindCSS("sheet", ["gamma"], { minify: false }, {
      generationSession: session,
    });

    assertEquals(first.css, duplicate.css);
    assertEquals(first.css, "exact|sheet|alpha,beta");
    assertEquals(isolated.css, "exact|sheet|gamma");
    assertEquals(isolated.css.includes("alpha"), false);
    assertEquals(counters, { compile: 2, build: 2 });
  });

  it("does not repopulate the compiler cache from an invalidated in-flight build", async () => {
    let releaseCompile: (() => void) | undefined;
    const compileGate = new Promise<void>((resolve) => {
      releaseCompile = resolve;
    });
    const processor = createProcessor("invalidation");
    installProcessor({
      ...processor,
      async compile(stylesheet) {
        await compileGate;
        return await processor.compile(stylesheet);
      },
    });

    const pending = generateTailwindCSS("sheet-invalidation", ["alpha"], { minify: false });
    invalidateCompiler();
    releaseCompile!();
    await pending;

    assertEquals(getCompilerCacheStats().size, 0);
  });

  it("partitions project output by provider default and optimizer identity", async () => {
    const projectSlug = `css-provider-partition-${crypto.randomUUID()}`;
    try {
      installProcessor(createProcessor("default-A", "sheet-A"));
      const first = await getProjectCSS(projectSlug, undefined, ["alpha"], { minify: false });

      installProcessor(createProcessor("default-B", "sheet-B"));
      const second = await getProjectCSS(projectSlug, undefined, ["alpha"], { minify: false });
      assertEquals(first.fromCache, false);
      assertEquals(second.fromCache, false);
      assertEquals(first.css === second.css, false);

      installProcessor(createProcessor("optimized", "sheet-optimized"));
      register(CSSOptimizationEngineName, createOptimizer("optimizer-A"));
      const optimizedA = await getProjectCSS(projectSlug, undefined, ["alpha"], { minify: true });

      register(CSSOptimizationEngineName, createOptimizer("optimizer-B"));
      const optimizedB = await getProjectCSS(projectSlug, undefined, ["alpha"], { minify: true });
      assertEquals(optimizedA.fromCache, false);
      assertEquals(optimizedB.fromCache, false);
      assertEquals(optimizedA.css, "optimizer-A[optimized|sheet-optimized|alpha]");
      assertEquals(optimizedB.css, "optimizer-B[optimized|sheet-optimized|alpha]");
    } finally {
      invalidateProjectCSS(projectSlug);
    }
  });

  it("serves unminified CSS when minification is requested without an optimizer", async () => {
    // Replaces an earlier "fails closed" assertion. Failing closed is right for
    // a correctness or security property. Minification is neither -- it is a
    // size optimization whose absence still yields a working page, and no
    // first-party package registers an engine while the production shell always
    // asks for minify:true. The old stance could therefore only ever fire as an
    // outage: every hosted render and every release asset build, including a
    // freshly scaffolded project, failed on it.
    installProcessor(createProcessor("missing-optimizer"));

    const session = acquireCSSGenerationSession(true);
    assertEquals(session.minify, true);
    assertEquals(session.optimizationEngine, undefined);

    const generated = await generateTailwindCSS("sheet", ["alpha"], { minify: true });
    assertEquals(generated.css, "missing-optimizer|sheet|alpha");
  });

  it("keeps minified and unminified output in separate cache identities", async () => {
    // The reversal above is only safe because an absent optimizer is recorded
    // in the pipeline identity, so an unminified entry can never be served in
    // place of a minified one.
    installProcessor(createProcessor("identity-split"));
    const withoutEngine = acquireCSSGenerationSession(true).cacheIdentity;

    register(CSSOptimizationEngineName, createOptimizer("split-optimizer"));
    const withEngine = acquireCSSGenerationSession(true).cacheIdentity;

    assertEquals(withoutEngine === withEngine, false);
  });

  it("regenerates a cached stylesheet unminified when no optimizer exists", async () => {
    // regenerateCSSByHash serves /_vf/css/<hash>.css on a cold cache, so it is
    // the path a second replica takes for a page another replica rendered. The
    // session and the generation request must agree on minify or
    // resolveGenerationSession rejects the pair; both ask for it, and an absent
    // engine downgrades the output rather than failing the request.
    installProcessor(createProcessor("no-optimizer-regeneration"));
    const stylesheet = "sheet";
    const candidates = ["alpha", "beta"];

    const generated = await generateTailwindCSS(stylesheet, candidates, { minify: false });
    const hash = hashCSS(generated.css);
    await cacheCSSAsync(generated.css, hash, {
      candidates,
      stylesheet,
      pipelineIdentity: generated.cacheIdentity,
    });

    assertEquals(await regenerateCSSByHash(hash, "vf-no-optimizer"), generated.css);
  });
});
