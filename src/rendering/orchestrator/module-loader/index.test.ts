import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { isMissingModuleError } from "./index.ts";

describe("module-loader/isMissingModuleError (#2077)", () => {
  it("matches Node/Deno ERR_MODULE_NOT_FOUND by code", () => {
    const error = Object.assign(new Error("boom"), { code: "ERR_MODULE_NOT_FOUND" });
    assertEquals(isMissingModuleError(error), true);
  });

  it("matches the 'Cannot find module' message variant", () => {
    const error = new Error(
      "Cannot find module '/app/.cache/veryfront-mdx-esm/local-main/app/page.7b827689.js' " +
        "imported from /node_modules/veryfront/esm/src/rendering/orchestrator/module-loader/index.js",
    );
    assertEquals(isMissingModuleError(error), true);
  });

  it("matches the 'Module not found' message variant", () => {
    assertEquals(isMissingModuleError(new Error('Module not found "file:///x/page.abc.js"')), true);
  });

  it("does not match unrelated import failures", () => {
    assertEquals(isMissingModuleError(new Error("SyntaxError: Unexpected token")), false);
    assertEquals(isMissingModuleError(new TypeError("x is not a function")), false);
  });

  it("returns false for non-Error values", () => {
    assertEquals(isMissingModuleError("Cannot find module"), false);
    assertEquals(isMissingModuleError(null), false);
    assertEquals(isMissingModuleError(undefined), false);
  });
});
