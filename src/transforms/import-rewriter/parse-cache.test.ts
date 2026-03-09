import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { applyRewrites, initLexer, parseAllImports, replaceSpecifiers } from "./parse-cache.ts";

describe("transforms/import-rewriter/parse-cache", () => {
  describe("initLexer", () => {
    it("initializes without error", async () => {
      await initLexer();
    });

    it("is idempotent", async () => {
      await initLexer();
      await initLexer();
    });
  });

  describe("parseAllImports", () => {
    it("parses static imports", async () => {
      const code = `import React from "react";`;
      const parsed = await parseAllImports(code);
      assertEquals(parsed.imports.length, 1);
      assertEquals(parsed.imports[0]!.specifier, "react");
      assertEquals(parsed.imports[0]!.isDynamic, false);
    });

    it("parses dynamic imports", async () => {
      const code = `const m = await import("./lazy.js");`;
      const parsed = await parseAllImports(code);
      assertEquals(parsed.imports.length, 1);
      assertEquals(parsed.imports[0]!.specifier, "./lazy.js");
      assertEquals(parsed.imports[0]!.isDynamic, true);
    });

    it("parses multiple imports", async () => {
      const code = `
import React from "react";
import { render } from "react-dom";
export { foo } from "bar";
      `.trim();
      const parsed = await parseAllImports(code);
      assertEquals(parsed.imports.length, 3);
      const specifiers = parsed.imports.map((i) => i.specifier);
      assertEquals(specifiers.includes("react"), true);
      assertEquals(specifiers.includes("react-dom"), true);
      assertEquals(specifiers.includes("bar"), true);
    });

    it("returns empty imports for code with none", async () => {
      const parsed = await parseAllImports("const x = 1;");
      assertEquals(parsed.imports.length, 0);
    });

    it("restores masked HTTP URLs in specifiers", async () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const parsed = await parseAllImports(code);
      assertEquals(parsed.imports.length, 1);
      assertEquals(parsed.imports[0]!.specifier, "https://esm.sh/react@18");
    });

    it("provides position data", async () => {
      const code = `import React from "react";`;
      const parsed = await parseAllImports(code);
      const imp = parsed.imports[0]!;
      assertEquals(typeof imp.start, "number");
      assertEquals(typeof imp.end, "number");
      assertEquals(typeof imp.statementStart, "number");
      assertEquals(typeof imp.statementEnd, "number");
      assertEquals(imp.start >= 0, true);
      assertEquals(imp.end > imp.start, true);
    });
  });

  describe("applyRewrites", () => {
    it("replaces specifier by index", async () => {
      const code = `import React from "react";`;
      const parsed = await parseAllImports(code);
      const rewrites = new Map([[0, { specifier: "preact" }]]);
      const result = applyRewrites(code, parsed, rewrites);
      assertEquals(result.includes("preact"), true);
      assertEquals(result.includes('"react"'), false);
    });

    it("replaces entire statement", async () => {
      const code = `import React from "react";`;
      const parsed = await parseAllImports(code);
      // statementStart..statementEnd includes the semicolon, so the replacement must include it
      const rewrites = new Map([[0, { statement: `import React from "preact/compat"` }]]);
      const result = applyRewrites(code, parsed, rewrites);
      // The statement replacement replaces ss..se, which may or may not include the trailing semicolon
      assertEquals(result.includes("preact/compat"), true);
      assertEquals(result.includes(`"react"`), false);
    });

    it("does nothing for empty rewrites map", async () => {
      const code = `import React from "react";`;
      const parsed = await parseAllImports(code);
      const result = applyRewrites(code, parsed, new Map());
      assertEquals(result, code);
    });

    it("handles null specifier (no change)", async () => {
      const code = `import React from "react";`;
      const parsed = await parseAllImports(code);
      const rewrites = new Map([[0, { specifier: null }]]);
      const result = applyRewrites(code, parsed, rewrites);
      assertEquals(result, code);
    });

    it("handles multiple rewrites in correct order", async () => {
      const code = `
import React from "react";
import { render } from "react-dom";
      `.trim();
      const parsed = await parseAllImports(code);
      const rewrites = new Map([
        [0, { specifier: "preact" }],
        [1, { specifier: "preact-dom" }],
      ]);
      const result = applyRewrites(code, parsed, rewrites);
      assertEquals(result.includes("preact"), true);
      assertEquals(result.includes("preact-dom"), true);
    });

    it("restores HTTP URLs in non-rewritten parts", async () => {
      const code = `
import React from "react";
const url = "https://example.com/api";
      `.trim();
      const parsed = await parseAllImports(code);
      const rewrites = new Map([[0, { specifier: "preact" }]]);
      const result = applyRewrites(code, parsed, rewrites);
      assertEquals(result.includes("https://example.com/api"), true);
    });
  });

  describe("replaceSpecifiers", () => {
    it("replaces specifiers using a replacer function", async () => {
      const code = `import React from "react";`;
      const result = await replaceSpecifiers(code, (spec) => {
        if (spec === "react") return "preact";
        return null;
      });
      assertEquals(result.includes("preact"), true);
    });

    it("returns original code when no replacements", async () => {
      const code = `import React from "react";`;
      const result = await replaceSpecifiers(code, () => null);
      assertEquals(result, code);
    });

    it("does not replace when replacer returns same specifier", async () => {
      const code = `import React from "react";`;
      const result = await replaceSpecifiers(code, (spec) => spec);
      assertEquals(result, code);
    });

    it("handles code with no imports", async () => {
      const code = `const x = 1;`;
      const result = await replaceSpecifiers(code, () => "replacement");
      assertEquals(result, code);
    });
  });
});
