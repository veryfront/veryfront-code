/**
 * Import Utils Tests
 *
 * Comprehensive tests for import resolution utilities covering:
 * - Import statement extraction (ES6 and dynamic)
 * - Import path resolution (relative, absolute, node_modules)
 * - Component file discovery with various extensions
 * - Import path processing and transformation
 * - Edge cases and error handling
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { join } from "#veryfront/compat/path";
import {
  extractImports,
  findComponent,
  processImports,
  resolveImportPath,
} from "../../../../../src/build/renderer/utils/import-utils.ts";
import { mkdir, writeTextFile } from "../../../../../src/platform/compat/fs.ts";
import { withTestContext } from "../../../../_helpers/context.ts";

describe("Import Utils", () => {
  describe("extractImports", () => {
    it("extracts simple named imports", async () => {
      const imports = await extractImports(`import { Button } from './components/Button'`);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "./components/Button");
    });

    it("extracts default imports", async () => {
      const imports = await extractImports(`import React from 'react'`);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "react");
    });

    it("extracts namespace imports", async () => {
      const imports = await extractImports(`import * as utils from './utils'`);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "./utils");
    });

    it("extracts named imports", async () => {
      const imports = await extractImports(`import { useState, useEffect } from 'react'`);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "react");
    });

    it("extracts imports from multiple lines", async () => {
      const imports = await extractImports(`
        import React from 'react'
        import { Button } from './components/Button'
        import * as utils from './utils'
      `);

      assertEquals(imports.length, 3);
      assertEquals(imports.includes("react"), true);
      assertEquals(imports.includes("./components/Button"), true);
      assertEquals(imports.includes("./utils"), true);
    });

    it("extracts dynamic imports", async () => {
      const imports = await extractImports(`
        const module = await import('./dynamic-module')
      `);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "./dynamic-module");
    });

    it("extracts both static and dynamic imports", async () => {
      const imports = await extractImports(`
        import React from 'react'
        const LazyComponent = () => import('./LazyComponent')
      `);

      assertEquals(imports.length, 2);
      assertEquals(imports.includes("react"), true);
      assertEquals(imports.includes("./LazyComponent"), true);
    });

    it("handles imports with single quotes", async () => {
      const imports = await extractImports(`import { Button } from './components/Button'`);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "./components/Button");
    });

    it("handles imports with double quotes", async () => {
      const imports = await extractImports(`import { Button } from "./components/Button"`);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "./components/Button");
    });

    it("removes duplicate imports", async () => {
      const imports = await extractImports(`
        import React from 'react'
        import { useState } from 'react'
      `);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "react");
    });

    it("handles imports with file extensions", async () => {
      const imports = await extractImports(`import styles from './styles.css'`);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "./styles.css");
    });

    it("handles scoped package imports", async () => {
      const imports = await extractImports(`import { Component } from '@company/design-system'`);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "@company/design-system");
    });

    it("handles side-effect imports", async () => {
      const imports = await extractImports(`import './styles.css'`);

      assertEquals(imports.length, 1);
      assertEquals(imports[0], "./styles.css");
    });

    it("returns empty array for code without imports", async () => {
      const imports = await extractImports(`
        const x = 5
        console.log('Hello World')
      `);

      assertEquals(imports.length, 0);
    });
  });

  describe("resolveImportPath", () => {
    it("resolves relative imports with ./", async () => {
      const resolved = resolveImportPath("./components/Button", "/src/pages/index.tsx", "/project");
      assertEquals(resolved, "/src/pages/components/Button");
    });

    it("resolves relative imports with ../", async () => {
      const resolved = resolveImportPath("../utils/helpers", "/src/pages/index.tsx", "/project");
      assertEquals(resolved, "/src/utils/helpers");
    });

    it("resolves nested relative imports", async () => {
      const resolved = resolveImportPath(
        "../../shared/constants",
        "/src/pages/blog/post.tsx",
        "/project",
      );
      assertEquals(resolved, "/src/shared/constants");
    });

    it("keeps node_modules imports as-is", async () => {
      const resolved = resolveImportPath("react", "/src/pages/index.tsx", "/project");
      assertEquals(resolved, "react");
    });

    it("keeps scoped package imports as-is", async () => {
      const resolved = resolveImportPath(
        "@company/design-system",
        "/src/pages/index.tsx",
        "/project",
      );
      assertEquals(resolved, "@company/design-system");
    });

    it("keeps absolute paths unchanged", async () => {
      const resolved = resolveImportPath(
        "/absolute/path/module",
        "/src/pages/index.tsx",
        "/project",
      );
      assertEquals(resolved, "/absolute/path/module");
    });

    it("handles imports with file extensions", async () => {
      const resolved = resolveImportPath("./styles.css", "/src/pages/index.tsx", "/project");
      assertEquals(resolved, "/src/pages/styles.css");
    });
  });

  describe("findComponent", () => {
    it("finds component with .tsx extension", async () => {
      await withTestContext("find-component-tsx", async (context) => {
        const componentPath = join(context.projectDir, "Button.tsx");
        await writeTextFile(componentPath, "export const Button = () => <div />");

        const found = await findComponent(join(context.projectDir, "Button"), context.projectDir);

        assertExists(found);
        assertEquals(found, componentPath);
      });
    });

    it("finds component with .ts extension", async () => {
      await withTestContext("find-component-ts", async (context) => {
        const componentPath = join(context.projectDir, "utils.ts");
        await writeTextFile(componentPath, "export const helper = () => {}");

        const found = await findComponent(join(context.projectDir, "utils"), context.projectDir);

        assertExists(found);
        assertEquals(found, componentPath);
      });
    });

    it("finds component with .jsx extension", async () => {
      await withTestContext("find-component-jsx", async (context) => {
        const componentPath = join(context.projectDir, "Button.jsx");
        await writeTextFile(componentPath, "export const Button = () => <div />");

        const found = await findComponent(join(context.projectDir, "Button"), context.projectDir);

        assertExists(found);
        assertEquals(found, componentPath);
      });
    });

    it("finds component with .js extension", async () => {
      await withTestContext("find-component-js", async (context) => {
        const componentPath = join(context.projectDir, "utils.js");
        await writeTextFile(componentPath, "export const helper = () => {}");

        const found = await findComponent(join(context.projectDir, "utils"), context.projectDir);

        assertExists(found);
        assertEquals(found, componentPath);
      });
    });

    it("finds component with .mdx extension", async () => {
      await withTestContext("find-component-mdx", async (context) => {
        const componentPath = join(context.projectDir, "article.mdx");
        await writeTextFile(componentPath, "# Article Title");

        const found = await findComponent(join(context.projectDir, "article"), context.projectDir);

        assertExists(found);
        assertEquals(found, componentPath);
      });
    });

    it("finds index.tsx when path is directory", async () => {
      await withTestContext("find-component-index-tsx", async (context) => {
        const dirPath = join(context.projectDir, "components");
        await mkdir(dirPath, { recursive: true });

        const indexPath = join(dirPath, "index.tsx");
        await writeTextFile(indexPath, 'export * from "./Button"');

        const found = await findComponent(
          join(context.projectDir, "components"),
          context.projectDir,
        );

        assertExists(found);
        assertEquals(found, indexPath);
      });
    });

    it("prefers direct file over index file", async () => {
      await withTestContext("find-component-prefer-direct", async (context) => {
        const directPath = join(context.projectDir, "Button.tsx");
        await writeTextFile(directPath, "export const Button = () => <div />");

        const dirPath = join(context.projectDir, "Button");
        await mkdir(dirPath, { recursive: true });

        const indexPath = join(dirPath, "index.tsx");
        await writeTextFile(indexPath, "export const Button = () => <div />");

        const found = await findComponent(join(context.projectDir, "Button"), context.projectDir);

        assertExists(found);
        assertEquals(found, directPath);
      });
    });

    it("returns null when component not found", async () => {
      // deno-lint-ignore require-await
      await withTestContext("find-component-not-found", async (context) => {
        const found = await findComponent(
          join(context.projectDir, "NonExistent"),
          context.projectDir,
        );
        assertEquals(found, null);
      });
    });
  });

  describe("processImports", () => {
    it("replaces import paths in code", async () => {
      const code = `import { Button } from './Button'`;

      const processed = await processImports(
        code,
        "/src/pages/index.tsx",
        "/project",
        // deno-lint-ignore require-await
        async (path) => (path === "/src/pages/Button" ? "/dist/Button.js" : null),
      );

      assertEquals(processed, `import { Button } from "/dist/Button.js"`);
    });

    it("handles multiple imports", async () => {
      const processed = await processImports(
        `
        import React from 'react'
        import { Button } from './Button'
      `,
        "/src/pages/index.tsx",
        "/project",
        // deno-lint-ignore require-await
        async (path) => {
          if (path === "react") return "https://esm.sh/react";
          if (path === "/src/pages/Button") return "/dist/Button.js";
          return null;
        },
      );

      assertEquals(processed.includes("https://esm.sh/react"), true);
      assertEquals(processed.includes("/dist/Button.js"), true);
    });

    it("preserves original import when processImport returns null", async () => {
      const code = `import { Button } from './Button'`;

      const processed = await processImports(
        code,
        "/src/pages/index.tsx",
        "/project",
        // deno-lint-ignore require-await
        async () => null,
      );

      assertEquals(processed, code);
    });

    it("handles imports with both single and double quotes", async () => {
      const processed = await processImports(
        `
        import { A } from './A'
        import { B } from "./B"
      `,
        "/src/index.tsx",
        "/project",
        // deno-lint-ignore require-await
        async (path) => {
          if (path === "/src/A") return "/dist/A.js";
          if (path === "/src/B") return "/dist/B.js";
          return null;
        },
      );

      assertEquals(processed.includes("/dist/A.js"), true);
      assertEquals(processed.includes("/dist/B.js"), true);
    });

    it("returns original code when no imports", async () => {
      const code = `
        const x = 5
        console.log('Hello')
      `;

      const processed = await processImports(
        code,
        "/src/index.tsx",
        "/project",
        // deno-lint-ignore require-await
        async () => null,
      );

      assertEquals(processed, code);
    });
  });
});
