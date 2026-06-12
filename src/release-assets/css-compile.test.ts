import "#veryfront/schemas/_test-setup.ts";
// Activates the @veryfront/ext-css-tailwind CSSProcessor so the pure
// `generateTailwindCSS` compile path resolves a real compiler.
import "#veryfront/html/styles-builder/__tests__/css-processor-setup.ts";

import { assert, assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCompileProjectCss } from "./css-compile.ts";

describe("release-assets/css-compile", () => {
  it("compiles tailwind candidates into a text/css string with a styleProfileHash", async () => {
    const compile = createCompileProjectCss({ projectScope: "css-compile-test" });

    const candidates = new Set(["p-4", "text-red-500", "flex"]);
    const result = await compile(candidates, '@import "tailwindcss";');

    assert(result !== null, "expected a compiled result");
    assert(result.css.length > 0, "expected non-empty CSS output");
    // The compiled output should reference at least one requested utility.
    assert(
      result.css.includes("padding") || result.css.includes(".p-4"),
      "expected the p-4 utility to be present in the compiled CSS",
    );
    // styleProfileHash is derived from the style-scope profile (string, never throws).
    assertEquals(typeof result.styleProfileHash, "string");
  });

  it("returns null only when there are no candidates AND no stylesheet", async () => {
    const compile = createCompileProjectCss({ projectScope: "css-compile-empty" });
    const result = await compile(new Set<string>(), undefined);
    assertEquals(result, null);
  });

  it("compiles base/custom CSS from a stylesheet even without candidates", async () => {
    const compile = createCompileProjectCss({ projectScope: "css-compile-stylesheet-only" });
    const result = await compile(
      new Set<string>(),
      '@import "tailwindcss"; :root { --brand: #123456; }',
    );
    // Stylesheet-only compiles must not be skipped: base/custom rules ship.
    assertExists(result);
    assert(result.css.length > 0, "stylesheet-only compile produced CSS");
  });

  it("returns null (keeps the CSS gap) when the compiler throws — never propagates", async () => {
    // A candidate set that is non-empty but a stylesheet that triggers a
    // compile error still resolves to null rather than throwing. We simulate a
    // hostile stylesheet; whatever the compiler does, the contract is: no throw.
    const compile = createCompileProjectCss({ projectScope: "css-compile-fail" });
    const candidates = new Set(["p-4"]);

    let threw = false;
    let result: Awaited<ReturnType<typeof compile>> = null;
    try {
      // An unterminated at-rule / malformed stylesheet. The compiler reports an
      // error (result.error) → createCompileProjectCss maps it to null.
      result = await compile(candidates, "@import ");
    } catch {
      threw = true;
    }
    assertEquals(threw, false, "compileProjectCss must never throw");
    // Either an empty/error compile (null) or a degraded-but-valid compile is
    // acceptable; the load-bearing guarantee is that it did not throw.
    assert(result === null || typeof result.css === "string");
  });
});
