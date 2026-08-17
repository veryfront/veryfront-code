import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { assert, assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertNoConfiguredCommonJsBrowserImports,
  commonJsPolicyInternals,
} from "./commonjs-policy.ts";

describe("CommonJS browser policy", () => {
  it("uses the registered missing-extension error when analysis is unavailable", () => {
    const error = assertThrows(
      () => commonJsPolicyInternals.assertCommonJsCapableParser(undefined),
      VeryfrontError,
      "findStaticCommonJsImports",
    );

    assert(error instanceof VeryfrontError);
    assertEquals(error.slug, "missing-extension");
    assertEquals(error.context, {
      contract: "CodeParser",
      capability: "findStaticCommonJsImports",
    });
  });

  it("fails closed when the parser's array iterator has changed", async () => {
    await assertNoConfiguredCommonJsBrowserImports("export default 1", {
      filePath: "/project/warm.ts",
      projectDir: "/project",
      serverExternalPackages: ["knex"],
    });
    const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
    let error: unknown;
    Object.defineProperty(Array.prototype, Symbol.iterator, {
      configurable: true,
      value: function* () {},
    });
    try {
      await assertNoConfiguredCommonJsBrowserImports(`require("knex")`, {
        filePath: "/project/database.ts",
        projectDir: "/project",
        serverExternalPackages: ["knex"],
      });
    } catch (caught) {
      error = caught;
    } finally {
      Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
    }

    assert(error instanceof VeryfrontError);
    assertEquals(error.slug, "bundle-error");
  });
});
