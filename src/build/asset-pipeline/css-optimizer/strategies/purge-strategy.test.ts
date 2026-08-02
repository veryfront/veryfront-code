import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CSSPurgingEngine, CSSPurgingRequest } from "#veryfront/extensions/css/index.ts";
import { CSSPurgingEngineName } from "#veryfront/extensions/css/index.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { createTestCSSPurgingEngine } from "../../../../../tests/_helpers/css-purging-engine.ts";
import { PurgeStrategy } from "./purge-strategy.ts";

describe("build/asset-pipeline/css-optimizer/strategies/purge-strategy", () => {
  it("keeps stable strategy metadata and activation rules", () => {
    const strategy = new PurgeStrategy();
    assertEquals(strategy.name, "purge-css");
    assertEquals(strategy.priority, 50);
    assertEquals(strategy.canProcess({ enabled: true, purge: true }), true);
    assertEquals(strategy.canProcess({ purge: true }), true);
    assertEquals(strategy.canProcess({ purge: false }), false);
    assertEquals(strategy.canProcess({ enabled: false, purge: true }), false);
    assertEquals(strategy.canProcess({}), false);
  });

  it("clears analyzed selector and content evidence", async () => {
    const strategy = new PurgeStrategy({
      collectContent: () =>
        Promise.resolve([{
          path: "page.tsx",
          raw: '<div className="test-class"></div>',
          extension: "tsx",
        }]),
    });
    await strategy.analyzeContent(["app/**/*.tsx"]);
    assertEquals(strategy.getUsedSelectors().has(".test-class"), true);
    strategy.clearCache();
    assertEquals(strategy.getUsedSelectors().size, 0);
  });

  it("routes a detached selector-evidence request through the explicit provider", async () => {
    let received: CSSPurgingRequest | undefined;
    const strategy = new PurgeStrategy({
      purgingEngine: createTestCSSPurgingEngine((request) => {
        received = request;
        return Promise.resolve({ css: ".provider-output {}" });
      }),
    });
    strategy.getUsedSelectors().add(".used-class");

    const result = await strategy.process(
      ".used-class {} .unused-class {}",
      "test.css",
      { purgeSafelist: [".dynamic"] },
    );

    assertEquals(result, {
      code: ".provider-output {}",
      sourceMap: undefined,
    });
    assertEquals(received, {
      css: ".used-class {} .unused-class {}",
      content: [{ raw: "used-class", extension: "html" }],
      safelist: ["dynamic", "used-class"],
      includeRejectedCSS: false,
    });
    assertEquals(Object.isFrozen(received), true);
  });

  it("routes collected raw content without inventing selector safelist entries", async () => {
    let received: CSSPurgingRequest | undefined;
    const strategy = new PurgeStrategy({
      collectContent: () =>
        Promise.resolve([{
          path: "page.tsx",
          raw: '<main className="used"></main>',
          extension: "tsx",
        }]),
      purgingEngine: createTestCSSPurgingEngine((request) => {
        received = request;
        return Promise.resolve({ css: request.css });
      }),
    });
    await strategy.analyzeContent(["app/**/*.tsx"]);
    await strategy.process(".used {}", "test.css", {
      purgeSafelist: ["dynamic"],
    });

    assertEquals(received?.content, [{
      raw: '<main className="used"></main>',
      extension: "tsx",
    }]);
    assertEquals(received?.safelist, ["dynamic"]);
  });

  it("rejects missing purge evidence and missing configured providers", async () => {
    const injected = new PurgeStrategy({
      purgingEngine: createTestCSSPurgingEngine(),
    });
    await assertRejects(
      () => injected.process(".x {}", "test.css", {}),
      TypeError,
      "requires non-empty",
    );

    const previous = tryResolve<CSSPurgingEngine>(CSSPurgingEngineName);
    unregister(CSSPurgingEngineName);
    try {
      const unconfigured = new PurgeStrategy();
      unconfigured.getUsedSelectors().add(".x");
      await assertRejects(
        () => unconfigured.process(".x {}", "test.css", {}),
        Error,
        'Missing extension for contract "CSSPurgingEngine"',
      );
    } finally {
      if (previous !== undefined) {
        register(CSSPurgingEngineName, previous);
      }
    }
  });

  it("validates injected content and mutable selector evidence before invocation", async () => {
    const malformedContent = new PurgeStrategy({
      collectContent: () =>
        Promise.resolve([{
          path: "page.tsx",
          raw: "<div />",
          extension: "../tsx",
        }]),
    });
    await assertRejects(
      () => malformedContent.analyzeContent(["app/**/*.tsx"]),
      TypeError,
      "source is malformed",
    );

    const mutatedSelectors = new PurgeStrategy({
      purgingEngine: createTestCSSPurgingEngine(),
    });
    mutatedSelectors.getUsedSelectors().add("bad\nselector");
    await assertRejects(
      () => mutatedSelectors.process(".bad {}", "test.css", {}),
      TypeError,
      "unsafe token",
    );
  });

  it("does not invoke custom iterators or content accessors while snapshotting inputs", async () => {
    let patternIteratorCalls = 0;
    const patterns = ["app/**/*.tsx"];
    Object.defineProperty(patterns, Symbol.iterator, {
      get() {
        patternIteratorCalls++;
        return Array.prototype[Symbol.iterator];
      },
    });
    await assertRejects(
      () => new PurgeStrategy().analyzeContent(patterns),
      TypeError,
      "dense data-property array",
    );
    assertEquals(patternIteratorCalls, 0);

    let contentGetterCalls = 0;
    const accessorContent = new PurgeStrategy({
      collectContent: () =>
        Promise.resolve([{
          path: "page.tsx",
          get raw() {
            contentGetterCalls++;
            return "<div />";
          },
          extension: "tsx",
        }]),
    });
    await assertRejects(
      () => accessorContent.analyzeContent(["app/**/*.tsx"]),
      TypeError,
      "own data property",
    );
    assertEquals(contentGetterCalls, 0);

    let safelistIteratorCalls = 0;
    const safelist = ["dynamic"];
    Object.defineProperty(safelist, Symbol.iterator, {
      get() {
        safelistIteratorCalls++;
        return Array.prototype[Symbol.iterator];
      },
    });
    const safelistStrategy = new PurgeStrategy({
      purgingEngine: createTestCSSPurgingEngine(),
    });
    safelistStrategy.getUsedSelectors().add(".used");
    await assertRejects(
      () =>
        safelistStrategy.process(".used {}", "test.css", {
          purgeSafelist: safelist,
        }),
      TypeError,
      "dense data-property array",
    );
    assertEquals(safelistIteratorCalls, 0);

    let selectorIteratorCalls = 0;
    const selectorStrategy = new PurgeStrategy({
      purgingEngine: createTestCSSPurgingEngine((request) => Promise.resolve({ css: request.css })),
    });
    const selectors = selectorStrategy.getUsedSelectors();
    selectors.add(".used");
    Object.defineProperty(selectors, Symbol.iterator, {
      get() {
        selectorIteratorCalls++;
        return Set.prototype[Symbol.iterator];
      },
    });
    const result = await selectorStrategy.process(
      ".used {}",
      "test.css",
      {},
    );
    assertEquals(result.code, ".used {}");
    assertEquals(selectorIteratorCalls, 0);
  });
});
