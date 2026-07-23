import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  extractImports,
  findComponent,
  processImports,
  resolveImportPath,
} from "./import-utils.ts";

describe("build/renderer/utils/import-utils", () => {
  describe("extractImports", () => {
    it("should extract named imports", async () => {
      assertEquals(await extractImports('import { useState } from "react";'), ["react"]);
    });

    it("should extract default imports", async () => {
      assertEquals(await extractImports('import React from "react";'), ["react"]);
    });

    it("should extract namespace imports", async () => {
      assertEquals(await extractImports('import * as path from "path";'), ["path"]);
    });

    it("should extract side-effect imports", async () => {
      assertEquals(await extractImports('import "./styles.css";'), ["./styles.css"]);
    });

    it("should extract dynamic imports", async () => {
      assertEquals(await extractImports('const mod = import("./lazy.ts");'), ["./lazy.ts"]);
    });

    it("should deduplicate imports", async () => {
      const code = ['import { a } from "react";', 'import { b } from "react";'].join(
        "\n",
      );
      assertEquals(await extractImports(code), ["react"]);
    });

    it("should extract multiple different imports", async () => {
      const code = [
        'import React from "react";',
        'import { render } from "react-dom";',
        'import "./global.css";',
      ].join("\n");

      const imports = await extractImports(code);

      assertEquals(imports.includes("react"), true);
      assertEquals(imports.includes("react-dom"), true);
      assertEquals(imports.includes("./global.css"), true);
    });

    it("should return empty for no imports", async () => {
      assertEquals(await extractImports("const x = 1;"), []);
    });

    it("does not treat comments or strings as imports", async () => {
      const code = `
        // import fake from "commented";
        const text = 'import value from "string-value"';
        import type { Real } from "real-module";
      `;
      assertEquals(await extractImports(code), ["real-module"]);
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

    it("resolves root-relative imports inside the project", () => {
      assertEquals(
        resolveImportPath("/absolute/path", "/a/b.ts", "/a"),
        "/a/absolute/path",
      );
    });

    it("should return URL-like paths unchanged", () => {
      assertEquals(
        resolveImportPath("https://cdn.example.com/lib.js", "/a/b.ts", "/a"),
        "https://cdn.example.com/lib.js",
      );
    });

    it("rejects relative imports that escape the project directory", () => {
      assertThrows(
        () => resolveImportPath("../../secret", "/project/src/app.ts", "/project"),
        TypeError,
        "outside projectDir",
      );
    });
  });

  describe("findComponent", () => {
    it("retains direct-file and directory-index resolution inside the project", async () => {
      const projectDir = await Deno.makeTempDir({ prefix: "vf-find-component-" });
      try {
        await Deno.writeTextFile(`${projectDir}/Button.tsx`, "export const Button = 1;");
        await Deno.mkdir(`${projectDir}/Card`);
        await Deno.writeTextFile(`${projectDir}/Card/index.ts`, "export const Card = 1;");

        assertEquals(findComponent(`${projectDir}/Button`, projectDir), `${projectDir}/Button.tsx`);
        assertEquals(
          findComponent(`${projectDir}/Card`, projectDir),
          `${projectDir}/Card/index.ts`,
        );
        assertEquals(findComponent(`${projectDir}/Missing`, projectDir), null);
        assertThrows(
          () => findComponent(`${projectDir}/../Outside`, projectDir),
          TypeError,
          "outside projectDir",
        );
      } finally {
        await Deno.remove(projectDir, { recursive: true });
      }
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

    it("replaces specifiers containing regular-expression characters", async () => {
      const code = 'import value from "./module[1]";';
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async () => "./module.js",
      );

      assertEquals(result, 'import value from "./module.js";');
    });

    it("does not rewrite matching text outside import specifiers", async () => {
      const code = 'import value from "./value"; const text = "./value";';
      const result = await processImports(
        code,
        "/project/src/app.ts",
        "/project",
        async () => "./value.js",
      );

      assertEquals(result, 'import value from "./value.js"; const text = "./value";');
    });
  });
});
