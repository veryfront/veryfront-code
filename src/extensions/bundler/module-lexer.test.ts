import "#veryfront/schemas/_test-setup.ts";
/**
 * Type-level tests for the {@link ModuleLexer} contract.
 *
 * @module extensions/bundler/module-lexer.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "../contracts.ts";
import { defaultBundlerContractsInternals } from "./defaults.ts";
import type { ImportSpecifier, ModuleLexer } from "./module-lexer.ts";

function withIsolatedDefaultBundlerContracts(run: () => void): void {
  const previousBundler = tryResolve("Bundler");
  const previousModuleLexer = tryResolve("ModuleLexer");
  unregister("Bundler");
  unregister("ModuleLexer");
  try {
    run();
  } finally {
    unregister("Bundler");
    unregister("ModuleLexer");
    if (previousBundler !== undefined) {
      register("Bundler", previousBundler);
    }
    if (previousModuleLexer !== undefined) {
      register("ModuleLexer", previousModuleLexer);
    }
  }
}

describe("extensions/bundler/module-lexer", () => {
  it("allows a stub implementation satisfying the contract", () => {
    const stub: ModuleLexer = {
      parse(_code: string): readonly ImportSpecifier[] {
        return [];
      },
    };

    const result: readonly ImportSpecifier[] = stub.parse("");
    assertEquals(result.length, 0);
  });

  it("init is optional on the interface", () => {
    const lexerWithoutInit: ModuleLexer = {
      parse: () => [],
    };
    // If init were required, this const declaration would fail typecheck.
    assertEquals(lexerWithoutInit.init, undefined);
  });

  it("allows an implementation with optional init()", async () => {
    let initialized = false;
    const stub: ModuleLexer = {
      init(): Promise<void> {
        initialized = true;
        return Promise.resolve();
      },
      parse(_code: string): readonly ImportSpecifier[] {
        const spec: ImportSpecifier = {
          n: "react",
          s: 0,
          e: 5,
          ss: 0,
          se: 20,
          d: -1,
          a: -1,
        };
        return [spec];
      },
    };

    await stub.init?.();
    assertEquals(initialized, true);

    const [first] = stub.parse("import 'react';");
    assertEquals(first?.n, "react");
  });

  it("only treats the missing default bundler package as optional", () => {
    const missingExtension = Object.assign(
      new Error(
        "Cannot find package '@veryfront/ext-bundler-esbuild' imported from /app/loader.js",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    assertEquals(
      defaultBundlerContractsInternals.isMissingDefaultBundlerExtension(
        missingExtension,
      ),
      true,
    );

    const missingTransitiveEsbuild = Object.assign(
      new Error(
        "Cannot find package 'esbuild' imported from /app/node_modules/@veryfront/ext-bundler-esbuild/esm/index.js",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );
    assertEquals(
      defaultBundlerContractsInternals.isMissingDefaultBundlerExtension(
        missingTransitiveEsbuild,
      ),
      false,
    );
  });

  it("validates every default implementation before constructing either", () => {
    withIsolatedDefaultBundlerContracts(() => {
      let bundlerConstructions = 0;
      class BundlerFixture {
        constructor() {
          bundlerConstructions += 1;
        }
      }
      assertThrows(
        () =>
          defaultBundlerContractsInternals.registerDefaultBundlerModule({
            EsbuildBundler: BundlerFixture,
          }),
        TypeError,
        'export "EsModuleLexer" must be constructible',
      );
      assertEquals(bundlerConstructions, 0);
      assertEquals(tryResolve("Bundler"), undefined);
      assertEquals(tryResolve("ModuleLexer"), undefined);
    });
  });

  it("does not register a partial default when the second constructor fails", () => {
    withIsolatedDefaultBundlerContracts(() => {
      let bundlerConstructions = 0;
      class BundlerFixture {
        constructor() {
          bundlerConstructions += 1;
        }

        bundle() {
          return Promise.resolve({ outputFiles: [], warnings: [], errors: [] });
        }

        transform() {
          return Promise.resolve({ code: "", warnings: [] });
        }
      }
      class ThrowingModuleLexerFixture {
        constructor() {
          throw new Error("module lexer construction failed");
        }
      }
      assertThrows(
        () =>
          defaultBundlerContractsInternals.registerDefaultBundlerModule({
            EsbuildBundler: BundlerFixture,
            EsModuleLexer: ThrowingModuleLexerFixture,
          }),
        Error,
        "module lexer construction failed",
      );
      assertEquals(bundlerConstructions, 1);
      assertEquals(tryResolve("Bundler"), undefined);
      assertEquals(tryResolve("ModuleLexer"), undefined);
    });
  });

  it("rejects constructed defaults that do not implement their contracts", () => {
    withIsolatedDefaultBundlerContracts(() => {
      class EmptyBundlerFixture {}
      class ModuleLexerFixture {
        parse(): readonly ImportSpecifier[] {
          return [];
        }
      }
      assertThrows(
        () =>
          defaultBundlerContractsInternals.registerDefaultBundlerModule({
            EsbuildBundler: EmptyBundlerFixture,
            EsModuleLexer: ModuleLexerFixture,
          }),
        TypeError,
        'instance must implement method "bundle"',
      );
      assertEquals(tryResolve("Bundler"), undefined);
      assertEquals(tryResolve("ModuleLexer"), undefined);
    });
  });

  it("preserves contracts registered before default construction", () => {
    withIsolatedDefaultBundlerContracts(() => {
      const explicitBundler = {
        bundle: () => Promise.resolve({ outputFiles: [], warnings: [], errors: [] }),
        transform: () => Promise.resolve({ code: "", warnings: [] }),
      };
      register("Bundler", explicitBundler);

      class ModuleLexerFixture {
        parse(): readonly ImportSpecifier[] {
          return [];
        }
      }
      defaultBundlerContractsInternals.registerDefaultBundlerModule({
        EsbuildBundler: undefined,
        EsModuleLexer: ModuleLexerFixture,
      });

      assertEquals(tryResolve("Bundler"), explicitBundler);
      assertEquals(typeof tryResolve<ModuleLexer>("ModuleLexer")?.parse, "function");
    });
  });
});
