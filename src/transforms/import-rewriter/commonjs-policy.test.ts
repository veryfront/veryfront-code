import "#veryfront/schemas/_test-setup.ts";
import { VeryfrontError } from "#veryfront/errors/types.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import { loadDefaultCodeParser } from "#veryfront/extensions/parser/defaults.ts";
import type { CodeParser } from "#veryfront/extensions/parser/index.ts";
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

  it("accepts a CommonJS top-level return in a .js browser module", async () => {
    await assertNoConfiguredCommonJsBrowserImports(
      "if (module.parent) return; module.exports = true;",
      {
        filePath: "/project/entry.js",
        projectDir: "/project",
        serverExternalPackages: ["knex"],
      },
    );
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

  it("retries the default parser load after a transient rejection", async () => {
    const registeredParser = tryResolve<CodeParser>("CodeParser");
    if (registeredParser !== undefined) unregister("CodeParser");
    try {
      const activeParser = await loadDefaultCodeParser();
      if (activeParser === undefined) throw new Error("CodeParser test setup failed");
      let loads = 0;
      commonJsPolicyInternals.setDefaultParserLoaderForTest(() => {
        loads += 1;
        return loads === 1
          ? Promise.reject(new Error("transient parser load failure"))
          : Promise.resolve(activeParser);
      });
      let firstError: unknown;
      try {
        await assertNoConfiguredCommonJsBrowserImports("export default 1", {
          filePath: "/project/retry.ts",
          projectDir: "/project",
          serverExternalPackages: ["knex"],
        });
      } catch (error) {
        firstError = error;
      }
      assert(firstError instanceof Error);
      assertEquals(firstError.message, "transient parser load failure");

      await assertNoConfiguredCommonJsBrowserImports("export default 1", {
        filePath: "/project/retry.ts",
        projectDir: "/project",
        serverExternalPackages: ["knex"],
      });
      assertEquals(loads, 2);
    } finally {
      commonJsPolicyInternals.resetDefaultParserLoaderForTest();
      if (registeredParser !== undefined) register("CodeParser", registeredParser);
    }
  });
});
