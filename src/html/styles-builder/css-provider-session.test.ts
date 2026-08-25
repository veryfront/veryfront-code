import "#veryfront/schemas/_test-setup.ts";
import { register, reset as resetContracts } from "#veryfront/extensions/contracts.ts";
import { formatInstallCommand } from "#veryfront/extensions/install-command.ts";
import {
  type CSSOptimizationEngine,
  CSSOptimizationEngineName,
  type CSSProcessor,
  CSSProcessorName,
} from "#veryfront/extensions/css/index.ts";
import {
  __resetLogRecordEmitterForTests,
  __subscribeLogRecordEmitter,
  type LogEntry,
} from "#veryfront/utils/logger/index.ts";
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

  it("reports a missing optimizer once, with the steps that actually enable one", () => {
    // `regenerateCSSByHash` acquires a session per request, so warning on every
    // acquisition made this line the most frequent entry in a hosted project's
    // logs -- once per render, at warn level. Say it once while the engine stays
    // absent, and give the whole recipe: `@veryfront/ext-css-lightning` declares
    // `activation: "explicit"`, so installing the package registers nothing on
    // its own. Only a `veryfront.config.ts` `extensions` entry activates it, and
    // advice that stops at the install leaves the developer with unminified CSS
    // and no next step.
    installProcessor(createProcessor("warn-rearm"));
    register(CSSOptimizationEngineName, createOptimizer("warn-rearm"));
    // Observing an engine re-arms the warning, so this test does not depend on
    // whether an earlier test in this file already reported the absence.
    acquireCSSGenerationSession(true);
    resetContracts();
    installProcessor(createProcessor("warn-once"));

    const records: LogEntry[] = [];
    __resetLogRecordEmitterForTests();
    const unsubscribe = __subscribeLogRecordEmitter((entry) => {
      records.push(entry);
    });
    try {
      acquireCSSGenerationSession(true);
      acquireCSSGenerationSession(true);
      acquireCSSGenerationSession(true);
    } finally {
      unsubscribe();
      __resetLogRecordEmitterForTests();
    }

    const reports = records.filter((entry) => entry.message.includes("unminified CSS"));
    assertEquals(reports.length, 1);
    const report = reports[0]?.message ?? "";
    assertEquals(reports[0]?.level, "warn");
    assertEquals(report.includes("@veryfront/ext-css-lightning"), true);
    assertEquals(report.includes("veryfront.config.ts"), true);
    assertEquals(report.includes("extensions"), true);
    // An unprefixed `deno add @veryfront/…` resolves against JSR and fails. A
    // `deno add npm:` command is legitimate here when a deno.json owns the
    // project's dependencies, so only the bare-specifier form is excluded --
    // and no package manager alone activates an explicit-activation extension,
    // which is why the composition step above is asserted too.
    assertEquals(report.includes("deno add @veryfront/"), false);
    // The contract name is an internal registration hook the guides never
    // mention, so it cannot appear as the developer-facing instruction.
    assertEquals(report.includes("CSSOptimizationEngine"), false);
  });

  it("suggests an install command that runs, and the composition step it needs", () => {
    // Naming the package is not enough: the first shipped form of this hint,
    // `deno add @veryfront/ext-css-lightning`, fails when a reader runs it.
    // Deno resolves an unprefixed specifier against JSR, which hosts no
    // `@veryfront` package, so the command exits with "is missing a prefix" --
    // and it is a Deno command printed by a build that usually runs under
    // Node. Installing the package alone is also insufficient: the extension
    // is `selection: "explicit"` in first-party-defaults.ts, so it stays
    // dormant until the project composes it. Both halves must be in the text.
    installProcessor(createProcessor("hint-rearm"));
    register(CSSOptimizationEngineName, createOptimizer("hint-rearm"));
    acquireCSSGenerationSession(true);
    resetContracts();
    installProcessor(createProcessor("hint"));

    const records: LogEntry[] = [];
    __resetLogRecordEmitterForTests();
    const unsubscribe = __subscribeLogRecordEmitter((entry) => {
      records.push(entry);
    });
    try {
      acquireCSSGenerationSession(true);
    } finally {
      unsubscribe();
      __resetLogRecordEmitterForTests();
    }

    // Matched on the effect, not the contract name: the warning names no
    // internal registration hook, as the test above pins.
    const message = records.find((entry) => entry.message.includes("unminified CSS"))
      ?.message ?? "";
    // Spelled out rather than derived from the formatter, so a formatter that
    // starts emitting something unrunnable cannot satisfy this assertion by
    // agreeing with itself. Which of the five appears depends on the manifest
    // and lockfile in the working directory, which a unit test must not depend
    // on; that mapping is pinned in install-command.test.ts.
    const runnableCommands = [
      "deno add npm:@veryfront/ext-css-lightning",
      "bun add @veryfront/ext-css-lightning",
      "pnpm add @veryfront/ext-css-lightning",
      "yarn add @veryfront/ext-css-lightning",
      "npm install @veryfront/ext-css-lightning",
    ];
    assertEquals(
      runnableCommands.some((command) => message.includes(command)),
      true,
      `hint must carry a runnable install command, got: ${message}`,
    );
    assertEquals(
      message.includes(formatInstallCommand("@veryfront/ext-css-lightning")),
      true,
      `hint must use the command for this project, got: ${message}`,
    );
    assertEquals(
      message.includes("deno add @veryfront/"),
      false,
      `an unprefixed \`deno add\` specifier resolves to JSR and fails, got: ${message}`,
    );
    assertEquals(
      message.includes("veryfront.config.ts"),
      true,
      `hint must name the composition step an explicit extension needs, got: ${message}`,
    );
  });

  it("shows the import line, so the config edit needs no guessing", () => {
    // The shipped hint ends at `then add it to "extensions" in
    // veryfront.config.ts`. Verified against published 0.1.1232: `veryfront
    // init --template minimal` writes no veryfront.config.ts at all, so the
    // reader has to author the file, and the sentence never says what to write
    // in it. The natural first guess, `import { defineConfig } from
    // "veryfront/config"`, is not an exported subpath -- the build then dies
    // with a bare "Failed to load veryfront.config.ts".
    //
    // Whether the file already exists depends on the working directory, which
    // a unit test must not depend on (setup-hint.test.ts pins that mapping
    // against explicit directories). What holds either way is the import line
    // for the package being recommended: without it the reader is guessing at
    // both the specifier and the binding.
    installProcessor(createProcessor("import-line-rearm"));
    register(CSSOptimizationEngineName, createOptimizer("import-line-rearm"));
    acquireCSSGenerationSession(true);
    resetContracts();
    installProcessor(createProcessor("import-line"));

    const records: LogEntry[] = [];
    __resetLogRecordEmitterForTests();
    const unsubscribe = __subscribeLogRecordEmitter((entry) => {
      records.push(entry);
    });
    try {
      acquireCSSGenerationSession(true);
    } finally {
      unsubscribe();
      __resetLogRecordEmitterForTests();
    }

    const message = records.find((entry) => entry.message.includes("unminified CSS"))
      ?.message ?? "";
    assertEquals(
      message.includes(`import extCssLightning from "@veryfront/ext-css-lightning"`),
      true,
      `hint must show the import line for the extension, got: ${message}`,
    );
    assertEquals(
      message.includes("extCssLightning()"),
      true,
      `hint must show the extension being composed, got: ${message}`,
    );
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
