import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { initLexer, parseImports, replaceSpecifiers, rewriteImports } from "./lexer.ts";

describe("transforms/esm/lexer", () => {
  describe("initLexer", () => {
    it("initializes without error", async () => {
      await initLexer();
    });

    it("can be called multiple times safely", async () => {
      await initLexer();
      await initLexer();
    });
  });

  describe("parseImports", () => {
    it("parses static import", async () => {
      const code = `import React from "react";`;
      const imports = await parseImports(code);
      assertEquals(imports.length, 1);
      assertEquals(imports[0]!.n, "react");
    });

    it("parses named imports", async () => {
      const code = `import { useState, useEffect } from "react";`;
      const imports = await parseImports(code);
      assertEquals(imports.length, 1);
      assertEquals(imports[0]!.n, "react");
    });

    it("parses multiple imports", async () => {
      const code = `
        import React from "react";
        import { render } from "react-dom";
      `;
      const imports = await parseImports(code);
      assertEquals(imports.length, 2);
      const specifiers = imports.map((i) => i.n);
      assertEquals(specifiers.includes("react"), true);
      assertEquals(specifiers.includes("react-dom"), true);
    });

    it("parses dynamic imports", async () => {
      const code = `const mod = await import("./lazy.js");`;
      const imports = await parseImports(code);
      assertEquals(imports.length, 1);
      assertEquals(imports[0]!.n, "./lazy.js");
      assertEquals(imports[0]!.d > -1, true);
    });

    it("parses re-exports", async () => {
      const code = `export { foo } from "bar";`;
      const imports = await parseImports(code);
      assertEquals(imports.length, 1);
      assertEquals(imports[0]!.n, "bar");
    });

    it("returns empty for code with no imports", async () => {
      const code = `const x = 1;`;
      const imports = await parseImports(code);
      assertEquals(imports.length, 0);
    });

    it("handles HTTP URLs in imports without mangling them", async () => {
      const code = `import React from "https://esm.sh/react@18";`;
      const imports = await parseImports(code);
      assertEquals(imports.length, 1);
      assertEquals(imports[0]!.n, "https://esm.sh/react@18");
    });

    it("handles HTTP URLs in string literals (non-import context)", async () => {
      const code = `
        import React from "react";
        const url = "https://example.com/api";
      `;
      const imports = await parseImports(code);
      assertEquals(imports.length, 1);
      assertEquals(imports[0]!.n, "react");
    });
  });

  describe("replaceSpecifiers", () => {
    it("replaces a static import specifier", async () => {
      const code = `import React from "react";`;
      const result = await replaceSpecifiers(code, (spec) => {
        if (spec === "react") return "https://esm.sh/react@18";
        return null;
      });
      assertEquals(result.includes("https://esm.sh/react@18"), true);
      assertEquals(result.includes(`"react"`), false);
    });

    it("replaces multiple specifiers", async () => {
      const code = `
import React from "react";
import { render } from "react-dom";
      `.trim();
      const result = await replaceSpecifiers(code, (spec) => {
        if (spec === "react") return "react-v18";
        if (spec === "react-dom") return "react-dom-v18";
        return null;
      });
      assertEquals(result.includes("react-v18"), true);
      assertEquals(result.includes("react-dom-v18"), true);
    });

    it("leaves specifier unchanged when replacer returns null", async () => {
      const code = `import React from "react";`;
      const result = await replaceSpecifiers(code, () => null);
      assertEquals(result, code);
    });

    it("handles dynamic import replacement", async () => {
      const code = `const m = await import("./lazy.js");`;
      const result = await replaceSpecifiers(code, (spec) => {
        if (spec === "./lazy.js") return "./lazy-v2.js";
        return null;
      });
      assertEquals(result.includes("./lazy-v2.js"), true);
    });

    it("preserves HTTP URLs in non-import string literals", async () => {
      const code = `
import foo from "bar";
const url = "https://example.com/api";
      `.trim();
      const result = await replaceSpecifiers(code, (spec) => {
        if (spec === "bar") return "baz";
        return null;
      });
      assertEquals(result.includes("https://example.com/api"), true);
      assertEquals(result.includes("baz"), true);
    });
  });

  describe("rewriteImports", () => {
    it("rewrites a full import statement", async () => {
      const code = `import React from "react";`;
      const result = await rewriteImports(code, (imp, stmt) => {
        if (imp.n === "react") return stmt.replace(`"react"`, `"preact/compat"`);
        return null;
      });
      assertEquals(result, `import React from "preact/compat";`);
    });

    it("leaves statement unchanged when rewriter returns null", async () => {
      const code = `import React from "react";`;
      const result = await rewriteImports(code, () => null);
      assertEquals(result, code);
    });

    it("can remove an import", async () => {
      const code = `import React from "react";\nconst x = 1;`;
      const result = await rewriteImports(code, (imp) => {
        if (imp.n === "react") return "";
        return null;
      });
      assertEquals(result.includes("react"), false);
    });
  });
});
