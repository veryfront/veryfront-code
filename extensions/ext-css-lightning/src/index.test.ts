import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  CSSOptimizationEngineName,
  MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "veryfront/extensions/css";
import { register, tryResolve, unregister } from "../../../src/extensions/contracts.ts";
import { acquireConfiguredCSSOptimization } from "../../../src/build/asset-pipeline/css-optimizer/optimization-engine.ts";
import factory, { LightningCSSOptimizationEngine } from "./index.ts";
import extensionPackage from "../deno.json" with { type: "json" };

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("ext-css-lightning", () => {
  it("declares and registers only the CSS optimization contract", async () => {
    const provided = new Map<string, unknown>();
    const extension = factory({ browserQueries: ["ie 11"] });
    assertEquals(extensionPackage.veryfront.activation, "explicit");
    assertEquals(extension.name, "ext-css-lightning");
    assertEquals(extension.version, extensionPackage.version);
    assertEquals(extension.contracts?.provides, [CSSOptimizationEngineName]);
    assertEquals(extension.capabilities, [
      {
        type: "env:read",
        keys: [
          "CSS_TRANSFORMER_WASM",
          "BROWSERSLIST_DISABLE_CACHE",
          "BROWSERSLIST_DANGEROUS_EXTEND",
          "BROWSERSLIST_IGNORE_OLD_DATA",
          "BROWSERSLIST_TRACE_WARNING",
        ],
      },
      { type: "native:ffi" },
    ]);

    await extension.setup?.({
      config: {},
      logger: noopLogger,
      provide: (name: string, implementation: unknown) => {
        provided.set(name, implementation);
      },
      get: () => undefined,
      require: () => {
        throw new Error("require is not used during setup");
      },
    });
    assert(
      provided.get(CSSOptimizationEngineName) instanceof
        LightningCSSOptimizationEngine,
    );
  });

  it("binds identity to release, vendor semantics, dataset, runtime, and targets", () => {
    const defaultsA = new LightningCSSOptimizationEngine();
    const defaultsB = new LightningCSSOptimizationEngine();
    const legacy = new LightningCSSOptimizationEngine({
      browserQueries: ["ie 11"],
    });

    assertEquals(defaultsA.cacheIdentity, defaultsB.cacheIdentity);
    assertNotEquals(defaultsA.cacheIdentity, legacy.cacheIdentity);
    assertStringIncludes(
      defaultsA.cacheIdentity,
      `ext-css-lightning@${extensionPackage.version}`,
    );
    assertEquals(defaultsA.cacheIdentity.includes("veryfront@"), false);
    assertStringIncludes(defaultsA.cacheIdentity, "lightningcss@1.29.2");
    assertStringIncludes(defaultsA.cacheIdentity, "browserslist@4.28.7");
    assertStringIncludes(defaultsA.cacheIdentity, "targets+data=");
    assert(
      defaultsA.cacheIdentity.length <=
        MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
    );
    assert(Object.isFrozen(defaultsA));
  });

  it("minifies valid CSS with the parser-backed implementation", () => {
    const result = new LightningCSSOptimizationEngine().optimize({
      css: "/* comment */ .button { color: red; }",
      sourcePath: "main.css",
      minify: true,
      sourceMap: false,
    });
    assertEquals(result, { css: ".button{color:red}" });
  });

  it("resolves compatibility targets once from extension-owned config", () => {
    const engine = new LightningCSSOptimizationEngine({
      browserQueries: ["ie 11"],
    });
    const result = engine.optimize({
      css: ".field { user-select: none; }",
      sourcePath: "field.css",
      minify: true,
      sourceMap: false,
    });
    assertStringIncludes(result.css, "-ms-user-select:none");
  });

  it("returns a source-map v3 document when requested", () => {
    const result = new LightningCSSOptimizationEngine().optimize({
      css: ".field { color: red; }",
      sourcePath: "field.css",
      minify: true,
      sourceMap: true,
    });
    const map = JSON.parse(result.sourceMap!);
    assertEquals(map.version, 3);
    assertEquals(map.sources, ["field.css"]);
    assertEquals(map.names, []);
    assertEquals(typeof map.mappings, "string");
  });

  it("rejects malformed CSS and non-isolated extension configuration", () => {
    const engine = new LightningCSSOptimizationEngine();
    assertThrows(() =>
      engine.optimize({
        css: "@media ( { .broken { color: red; }",
        sourcePath: "broken.css",
        minify: true,
        sourceMap: false,
      })
    );
    assertThrows(() =>
      new LightningCSSOptimizationEngine({
        browserQueries: ["definitely-not-a-browser 1"],
      })
    );
    assertThrows(
      () =>
        new LightningCSSOptimizationEngine({
          browserQueries: ["> 1% in my stats"],
        }),
      TypeError,
      "resolved to no browser targets",
    );
    assertThrows(
      () =>
        new LightningCSSOptimizationEngine({
          browserQueries: ["extends browserslist-config-example"],
        }),
      TypeError,
      "must not load external configuration",
    );
  });

  it("rejects sparse, accessor-backed, and custom-iterator query arrays", () => {
    const sparse = new Array<string>(2);
    sparse[1] = "ie 11";
    assertThrows(
      () => new LightningCSSOptimizationEngine({ browserQueries: sparse }),
      TypeError,
      "data-property strings",
    );

    let accessorCalls = 0;
    const accessorBacked = ["ie 11"];
    Object.defineProperty(accessorBacked, "0", {
      enumerable: true,
      get() {
        accessorCalls++;
        return "defaults";
      },
    });
    assertThrows(
      () =>
        new LightningCSSOptimizationEngine({
          browserQueries: accessorBacked,
        }),
      TypeError,
      "data-property strings",
    );
    assertEquals(accessorCalls, 0);

    let iteratorCalls = 0;
    const customIterator = ["ie 11"];
    Object.defineProperty(customIterator, Symbol.iterator, {
      value() {
        iteratorCalls++;
        throw new Error("must not iterate hostile input");
      },
    });
    assertThrows(
      () =>
        new LightningCSSOptimizationEngine({
          browserQueries: customIterator,
        }),
      TypeError,
      "bounded dense array",
    );
    assertEquals(iteratorCalls, 0);
  });

  it("rejects inherited and prototype-trapped extension configuration", () => {
    let getterCalls = 0;
    const inherited = Object.create({
      get browserQueries() {
        getterCalls++;
        return ["ie 11"];
      },
    });
    assertThrows(
      () => new LightningCSSOptimizationEngine(inherited),
      TypeError,
      "must not inherit configuration",
    );
    assertEquals(getterCalls, 0);

    const trapped = new Proxy({}, {
      getPrototypeOf() {
        throw new Error("prototype trap must be contained");
      },
    });
    assertThrows(
      () => factory(trapped),
      TypeError,
      "config could not be inspected",
    );
  });

  it("conforms through factory registration and the core invocation boundary", async () => {
    const previous = tryResolve(CSSOptimizationEngineName);
    unregister(CSSOptimizationEngineName);
    try {
      let provided: unknown;
      const extension = factory({ browserQueries: ["ie 11"] });
      await extension.setup?.({
        config: {},
        logger: noopLogger,
        provide: (name: string, implementation: unknown) => {
          provided = implementation;
          register(name, implementation);
        },
        get: () => undefined,
        require: () => {
          throw new Error("require is not used during setup");
        },
      });

      const session = acquireConfiguredCSSOptimization();
      assertEquals(
        session.cacheIdentity,
        (provided as LightningCSSOptimizationEngine).cacheIdentity,
      );
      const result = session.run({
        css: ".field { user-select: none; color: red; }",
        sourcePath: "field.css",
        minify: true,
        sourceMap: true,
      });
      assertStringIncludes(result.css, "-ms-user-select:none");
      assertEquals(result.css.includes(" "), false);
      assertEquals(JSON.parse(result.sourceMap!).version, 3);
    } finally {
      unregister(CSSOptimizationEngineName);
      if (previous !== undefined) {
        register(CSSOptimizationEngineName, previous);
      }
    }
  });
});
