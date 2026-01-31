import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractImports, resolveImportPath } from "./import-utils.ts";

describe("build/renderer/utils/import-utils", () => {
  describe("extractImports", () => {
    it("should extract named imports", () => {
      assertEquals(extractImports('import { useState } from "react";'), ["react"]);
    });

    it("should extract default imports", () => {
      assertEquals(extractImports('import React from "react";'), ["react"]);
    });

    it("should extract namespace imports", () => {
      assertEquals(extractImports('import * as path from "path";'), ["path"]);
    });

    it("should extract side-effect imports", () => {
      assertEquals(extractImports('import "./styles.css";'), ["./styles.css"]);
    });

    it("should extract dynamic imports", () => {
      assertEquals(extractImports('const mod = import("./lazy.ts");'), ["./lazy.ts"]);
    });

    it("should deduplicate imports", () => {
      const code = ['import { a } from "react";', 'import { b } from "react";'].join(
        "\n",
      );
      assertEquals(extractImports(code), ["react"]);
    });

    it("should extract multiple different imports", () => {
      const code = [
        'import React from "react";',
        'import { render } from "react-dom";',
        'import "./global.css";',
      ].join("\n");

      const imports = extractImports(code);

      assertEquals(imports.includes("react"), true);
      assertEquals(imports.includes("react-dom"), true);
      assertEquals(imports.includes("./global.css"), true);
    });

    it("should return empty for no imports", () => {
      assertEquals(extractImports("const x = 1;"), []);
    });
  });

  describe("resolveImportPath", () => {
    it("should resolve relative imports", () => {
      const result = resolveImportPath("./utils", "/project/src/app.ts", "/project");
      assertEquals(result.endsWith("/project/src/utils"), true);
    });

    it("should resolve parent relative imports", () => {
      const result = resolveImportPath(
        "../shared/lib",
        "/project/src/app.ts",
        "/project",
      );
      assertEquals(result.endsWith("/project/shared/lib"), true);
    });

    it("should return bare specifiers unchanged", () => {
      assertEquals(resolveImportPath("react", "/a/b.ts", "/a"), "react");
      assertEquals(resolveImportPath("lodash/get", "/a/b.ts", "/a"), "lodash/get");
    });

    it("should return absolute paths unchanged", () => {
      assertEquals(
        resolveImportPath("/absolute/path", "/a/b.ts", "/a"),
        "/absolute/path",
      );
    });

    it("should return URL-like paths unchanged", () => {
      assertEquals(
        resolveImportPath("https://cdn.example.com/lib.js", "/a/b.ts", "/a"),
        "https://cdn.example.com/lib.js",
      );
    });
  });
});
