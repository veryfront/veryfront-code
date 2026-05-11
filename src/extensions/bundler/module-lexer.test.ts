/**
 * Type-level tests for the {@link ModuleLexer} contract.
 *
 * @module extensions/bundler/module-lexer.test
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ImportSpecifier, ModuleLexer } from "./module-lexer.ts";

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
});
