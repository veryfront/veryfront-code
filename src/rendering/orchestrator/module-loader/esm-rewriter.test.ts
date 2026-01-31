import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { rewriteEsmPaths } from "./esm-rewriter.ts";

describe("rendering/orchestrator/module-loader/esm-rewriter", () => {
  describe("rewriteEsmPaths", () => {
    const urlBase = "https://esm.sh/v135/react-dom@18.2.0/es2022/";

    it("should not modify code with no imports or exports", () => {
      const code = `console.log("no imports here");`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });

    it("should not modify non-path strings", () => {
      const code = `const x = "hello world";`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });

    it("should not modify import of bare specifiers", () => {
      const code = `import "react"`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });

    it("should not modify from of bare specifiers", () => {
      const code = `import { useState } from "react"`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });

    it("should return same string for empty input", () => {
      assertEquals(rewriteEsmPaths("", urlBase), "");
    });

    it("should preserve non-import code lines around imports", () => {
      const code = `const x = 1;\nconst y = 2;`;
      assertEquals(rewriteEsmPaths(code, urlBase), code);
    });
  });
});
