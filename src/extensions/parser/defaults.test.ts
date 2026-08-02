import "#veryfront/schemas/_test-setup.ts";
/**
 * Runtime validation tests for the default parser extension.
 *
 * @module extensions/parser/defaults.test
 */

import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, tryResolve, unregister } from "../contracts.ts";
import type { ASTNode, CodeParser } from "./code-parser.ts";
import { defaultParserContractsInternals } from "./defaults.ts";

function parserFixture(): CodeParser {
  return {
    parse: () => Promise.resolve({ type: "Program" }),
    traverse: () => {},
    generate: () => Promise.resolve({ code: "" }),
    injectJsxNodePositions: (source) => source,
  };
}

function withIsolatedParserContract(run: () => void): void {
  const previous = tryResolve<CodeParser>("CodeParser");
  unregister("CodeParser");
  try {
    run();
  } finally {
    unregister("CodeParser");
    if (previous !== undefined) register("CodeParser", previous);
  }
}

describe("default parser contracts", () => {
  it("rejects a non-constructible default export before registry mutation", () => {
    withIsolatedParserContract(() => {
      assertThrows(
        () =>
          defaultParserContractsInternals.registerDefaultParserModule({
            BabelCodeParser: {},
          }),
        TypeError,
        'export "BabelCodeParser" must be constructible',
      );
      assertEquals(tryResolve("CodeParser"), undefined);
    });
  });

  it("rejects constructed parsers missing required contract methods", () => {
    withIsolatedParserContract(() => {
      class IncompleteParser {
        parse(): Promise<ASTNode> {
          return Promise.resolve({ type: "Program" });
        }
      }

      assertThrows(
        () =>
          defaultParserContractsInternals.registerDefaultParserModule({
            BabelCodeParser: IncompleteParser,
          }),
        TypeError,
        'instance must implement method "traverse"',
      );
      assertEquals(tryResolve("CodeParser"), undefined);
    });
  });

  it("preserves a parser registered while the default constructor runs", () => {
    withIsolatedParserContract(() => {
      const explicit = parserFixture();
      class RegisteringParser {
        constructor() {
          register("CodeParser", explicit);
        }

        parse(): Promise<ASTNode> {
          return Promise.resolve({ type: "Program" });
        }

        traverse(): void {}

        generate(): Promise<{ code: string }> {
          return Promise.resolve({ code: "" });
        }

        injectJsxNodePositions(source: string): string {
          return source;
        }
      }

      defaultParserContractsInternals.registerDefaultParserModule({
        BabelCodeParser: RegisteringParser,
      });

      assertEquals(tryResolve("CodeParser"), explicit);
    });
  });

  it("does not inspect an extension module when a parser already exists", () => {
    withIsolatedParserContract(() => {
      const explicit = parserFixture();
      register("CodeParser", explicit);

      defaultParserContractsInternals.registerDefaultParserModule(null);

      assertEquals(tryResolve("CodeParser"), explicit);
    });
  });
});
