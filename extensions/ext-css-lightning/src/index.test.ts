import {
  assert,
  assertEquals,
  assertNotEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  captureCSSOptimizationEngine,
  CSSOptimizationEngineName,
  MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
} from "veryfront/extensions/css";
import factory, { LightningCSSOptimizationEngine } from "./index.ts";
import extensionPackage from "../deno.json" with { type: "json" };

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("ext-css-lightning", () => {
  it("does not require String.prototype.isWellFormed on Node 18", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(
      String.prototype,
      "isWellFormed",
    );
    Object.defineProperty(String.prototype, "isWellFormed", {
      value: undefined,
      configurable: true,
      writable: true,
    });

    try {
      const node18Module = await import("./index.ts?node18-compat");
      const result = new node18Module.LightningCSSOptimizationEngine({
        browserQueries: ["ie 11"],
      }).optimize({
        css: ".field { user-select: none; }",
        sourcePath: "styles/field.css",
        minify: true,
        sourceMap: false,
      });
      assertStringIncludes(result.css, "-ms-user-select:none");
    } finally {
      if (descriptor === undefined) {
        delete (String.prototype as { isWellFormed?: unknown }).isWellFormed;
      } else {
        Object.defineProperty(String.prototype, "isWellFormed", descriptor);
      }
    }
  });

  it("declares and registers only the explicit optimization contract", async () => {
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

  it("binds immutable identity to vendor, dataset, runtime, and targets", () => {
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
    assertStringIncludes(defaultsA.cacheIdentity, "lightningcss@1.29.2");
    assertStringIncludes(defaultsA.cacheIdentity, "browserslist@4.28.7");
    assertStringIncludes(defaultsA.cacheIdentity, "targets+data=");
    assert(
      defaultsA.cacheIdentity.length <=
        MAX_CSS_OPTIMIZATION_ENGINE_IDENTITY_CHARACTERS,
    );
    assert(Object.isFrozen(defaultsA));
    assert(Object.isFrozen(captureCSSOptimizationEngine(defaultsA)));
  });

  it("minifies valid CSS and applies extension-owned compatibility targets", () => {
    const engine = new LightningCSSOptimizationEngine({
      browserQueries: ["ie 11"],
    });
    const result = engine.optimize({
      css: "/* comment */ .field { user-select: none; color: red; }",
      sourcePath: "field.css",
      minify: true,
      sourceMap: false,
    });
    assertStringIncludes(result.css, "-ms-user-select:none");
    assertEquals(result.css.includes("/* comment */"), false);
    assertEquals(Object.isFrozen(result), true);
  });

  it("returns a bounded flat source-map v3 document when requested", () => {
    const result = new LightningCSSOptimizationEngine().optimize({
      css: ".field { color: red; }",
      sourcePath: "styles/field.css",
      minify: true,
      sourceMap: true,
    });
    const map = JSON.parse(result.sourceMap!);
    assertEquals(map.version, 3);
    assertEquals(map.sources, ["styles/field.css"]);
    assertEquals(map.names, []);
    assertEquals(typeof map.mappings, "string");
  });

  it("snapshots configuration and rejects external Browserslist sources", () => {
    const browserQueries = ["ie 11"];
    const engine = new LightningCSSOptimizationEngine({ browserQueries });
    browserQueries[0] = "defaults";
    const result = engine.optimize({
      css: ".field { user-select: none; }",
      sourcePath: "field.css",
      minify: true,
      sourceMap: false,
    });
    assertStringIncludes(result.css, "-ms-user-select:none");

    for (
      const query of [
        "extends browserslist-config-example",
        "> 1% in my stats",
      ]
    ) {
      assertThrows(
        () => new LightningCSSOptimizationEngine({ browserQueries: [query] }),
        TypeError,
      );
    }
  });

  it("rejects sparse, accessor-backed, and custom-property query arrays", () => {
    const sparse = new Array<string>(2);
    sparse[1] = "ie 11";
    assertThrows(
      () => new LightningCSSOptimizationEngine({ browserQueries: sparse }),
      TypeError,
      "bounded dense array",
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

  it("rejects inherited, accessor, proxy-trapped, and unknown config", () => {
    let inheritedReads = 0;
    const inherited = Object.create({
      get browserQueries() {
        inheritedReads++;
        return ["ie 11"];
      },
    });
    assertThrows(
      () => new LightningCSSOptimizationEngine(inherited),
      TypeError,
      "must not inherit configuration",
    );
    assertEquals(inheritedReads, 0);

    let ownReads = 0;
    const accessor = Object.defineProperty({}, "browserQueries", {
      get() {
        ownReads++;
        return ["ie 11"];
      },
    });
    assertThrows(
      () => factory(accessor),
      TypeError,
      "data property",
    );
    assertEquals(ownReads, 0);

    const trapped = new Proxy({}, {
      ownKeys() {
        throw new Error("blocked");
      },
    });
    assertThrows(
      () => factory(trapped),
      TypeError,
      "config could not be inspected",
    );
    assertThrows(
      () => factory({ browserQueries: ["defaults"], unknown: true } as never),
      TypeError,
      "unsupported properties",
    );
  });

  it("does not invoke request accessors and rejects malformed CSS", () => {
    const engine = new LightningCSSOptimizationEngine();
    let reads = 0;
    const request = {
      sourcePath: "field.css",
      minify: true,
      sourceMap: false,
    } as Record<string, unknown>;
    Object.defineProperty(request, "css", {
      enumerable: true,
      get() {
        reads++;
        return ".field{}";
      },
    });
    assertThrows(
      () => engine.optimize(request as never),
      TypeError,
      "data property",
    );
    assertEquals(reads, 0);

    assertThrows(() =>
      engine.optimize({
        css: "@media ( { .broken { color: red; }",
        sourcePath: "broken.css",
        minify: true,
        sourceMap: false,
      })
    );
  });

  it("uses captured inspection intrinsics after ambient mutation", () => {
    const originalDescriptors = Object.getOwnPropertyDescriptors;
    const originalApply = Reflect.apply;
    const originalNormalize = String.prototype.normalize;
    let engine: LightningCSSOptimizationEngine | undefined;
    try {
      Object.getOwnPropertyDescriptors = () => {
        throw new Error("poisoned descriptors");
      };
      Reflect.apply = () => {
        throw new Error("poisoned apply");
      };
      String.prototype.normalize = () => {
        throw new Error("poisoned normalize");
      };
      engine = new LightningCSSOptimizationEngine({
        browserQueries: ["ie 11"],
      });
    } finally {
      Object.getOwnPropertyDescriptors = originalDescriptors;
      Reflect.apply = originalApply;
      String.prototype.normalize = originalNormalize;
    }
    assert(engine instanceof LightningCSSOptimizationEngine);
  });
});
