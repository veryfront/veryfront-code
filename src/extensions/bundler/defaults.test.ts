import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDefaultBundlerContracts,
  isMissingDefaultBundlerImplementation,
} from "./defaults.ts";

describe("extensions/bundler defaults", () => {
  it("does not hide a missing transitive dependency", () => {
    const error = Object.assign(
      new Error(
        "Cannot find package 'broken-transitive-dependency' imported from the bundler extension",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isMissingDefaultBundlerImplementation(error), false);
  });

  it("recognizes the missing default bundler implementation", () => {
    const error = Object.assign(
      new Error(
        "Cannot find package '@veryfront/ext-bundler-esbuild' imported from the runtime",
      ),
      { code: "ERR_MODULE_NOT_FOUND" },
    );

    assertEquals(isMissingDefaultBundlerImplementation(error), true);
  });

  it("validates and snapshots the imported module boundary", () => {
    let bundlerConstructorReads = 0;
    class BundlerStub {
      bundle() {
        return Promise.resolve({ outputFiles: [], warnings: [], errors: [] });
      }

      transform() {
        return Promise.resolve({ code: "", warnings: [] });
      }
    }
    class LexerStub {
      parse() {
        return [];
      }
    }
    const imported = Object.defineProperties({}, {
      EsbuildBundler: {
        enumerable: true,
        get() {
          bundlerConstructorReads += 1;
          return bundlerConstructorReads === 1 ? BundlerStub : undefined;
        },
      },
      EsModuleLexer: { enumerable: true, value: LexerStub },
    });

    const contracts = createDefaultBundlerContracts(imported);

    assertEquals(bundlerConstructorReads, 1);
    assertEquals(typeof contracts.bundler.bundle, "function");
    assertEquals(contracts.lexer.parse(""), []);
  });

  it("uses a typed sanitized error for malformed default implementations", () => {
    const canary = "private-bundler-constructor";
    class ThrowingBundler {
      constructor() {
        throw new Error(canary);
      }
    }

    for (
      const imported of [
        {},
        { EsbuildBundler: class {}, EsModuleLexer: class {} },
        {
          EsbuildBundler: ThrowingBundler,
          EsModuleLexer: class {
            parse() {
              return [];
            }
          },
        },
      ]
    ) {
      let error: unknown;
      try {
        createDefaultBundlerContracts(imported);
      } catch (caught) {
        error = caught;
      }
      assertEquals(error instanceof Error, true);
      assertEquals(String(error).includes("default bundler implementation is invalid"), true);
      assertEquals(String(error).includes(canary), false);
    }
  });
});
