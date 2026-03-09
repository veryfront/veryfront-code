import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractImports, processImports, resolveImportPath } from "./import-utils.ts";

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

  describe("processImports", () => {
    it("should replace import paths using the processor", async () => {
      const code = 'import { helper } from "./utils";\nconsole.log(helper);';
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async (importPath: string) => {
          if (importPath.includes("utils")) return "./utils/index.js";
          return null;
        },
      );
      assertEquals(result.includes("./utils/index.js"), true);
    });

    it("should leave imports unchanged when processor returns null", async () => {
      const code = 'import React from "react";';
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async () => null,
      );
      assertEquals(result, code);
    });

    it("should leave imports unchanged when processor returns same path", async () => {
      const code = 'import { x } from "./same";';
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async () => "./same",
      );
      assertEquals(result, code);
    });

    it("should handle code with no imports", async () => {
      const code = "const x = 1;";
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async () => "./replaced",
      );
      assertEquals(result, code);
    });

    it("should handle multiple imports", async () => {
      const code = [
        'import { a } from "./mod-a";',
        'import { b } from "./mod-b";',
      ].join("\n");
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async (importPath: string) => {
          if (importPath.includes("mod-a")) return "./new-mod-a";
          return null;
        },
      );
      assertEquals(result.includes("./new-mod-a"), true);
      assertEquals(result.includes("./mod-b"), true);
    });
  });
});
