/**
 * Tests for SSR VF Modules plugin.
 *
 * This plugin resolves /_vf_modules/ paths to framework source files,
 * transforms them, and rewrites imports to ensure consistent React instances.
 *
 * @see ssr-vf-modules.ts
 */

import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { REACT_DEFAULT_VERSION } from "#veryfront/utils/constants/cdn.ts";
import { buildReactUrl, getReactImportMap } from "../../import-rewriter/url-builder.ts";
import { ssrVfModulesPlugin } from "./ssr-vf-modules.ts";
import { _testExports } from "./ssr-vf-modules/index.ts";
import type { TransformContext } from "../types.ts";

const { findVfModuleImports, FRAMEWORK_ROOT, EXTENSIONS } = _testExports;

describe("ssr-vf-modules", { sanitizeOps: false, sanitizeResources: false }, () => {
  describe("findVfModuleImports", () => {
    it("finds single /_vf_modules/ import", () => {
      const code =
        `import { Head } from "/_vf_modules/_veryfront/react/components/Head.js?ssr=true";`;
      const imports = findVfModuleImports(code);
      assertEquals(imports, ["/_vf_modules/_veryfront/react/components/Head.js?ssr=true"]);
    });

    it("finds multiple /_vf_modules/ imports", () => {
      const code = `
        import { Head } from "/_vf_modules/_veryfront/react/components/Head.js?ssr=true";
        import { Router } from "/_vf_modules/_veryfront/react/router/index.js?ssr=true";
        import { something } from "other-package";
      `;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 2);
      assertEquals(
        imports.includes("/_vf_modules/_veryfront/react/components/Head.js?ssr=true"),
        true,
      );
      assertEquals(
        imports.includes("/_vf_modules/_veryfront/react/router/index.js?ssr=true"),
        true,
      );
    });

    it("deduplicates repeated imports", () => {
      const code = `
        import { Head } from "/_vf_modules/_veryfront/react/components/Head.js";
        import { Head as H2 } from "/_vf_modules/_veryfront/react/components/Head.js";
      `;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 1);
    });

    it("returns empty array for code without /_vf_modules/ imports", () => {
      const code = `
        import React from "react";
        import { something } from "./local";
      `;
      const imports = findVfModuleImports(code);
      assertEquals(imports, []);
    });

    it("handles single quotes", () => {
      const code = `import { Head } from '/_vf_modules/_veryfront/react/components/Head.js';`;
      const imports = findVfModuleImports(code);
      assertEquals(imports.length, 1);
    });

    it("ignores string literals without from keyword", () => {
      const code = `const path = "/_vf_modules/something";`;
      const imports = findVfModuleImports(code);
      assertEquals(imports, []);
    });
  });

  describe("plugin condition", () => {
    it("only runs for SSR target", () => {
      const ssrCtx = { target: "ssr" } as TransformContext;
      const browserCtx = { target: "browser" } as TransformContext;

      assertEquals(ssrVfModulesPlugin.condition?.(ssrCtx), true);
      assertEquals(ssrVfModulesPlugin.condition?.(browserCtx), false);
    });
  });

  describe("plugin transform", () => {
    it("returns unchanged code when no /_vf_modules/ imports", async () => {
      const code = `import React from "react"; export default function App() { return null; }`;
      const ctx = {
        code,
        target: "ssr",
        projectDir: "/tmp/test-project",
        reactVersion: REACT_DEFAULT_VERSION,
      } as TransformContext;

      const result = await ssrVfModulesPlugin.transform(ctx);
      assertEquals(result, code);
    });
  });

  describe("React URL consistency", () => {
    it("uses canonical React URLs with deps=csstype", () => {
      const reactUrls = getReactImportMap(REACT_DEFAULT_VERSION);

      // Verify URLs include deps=csstype for type consistency
      const reactUrl = reactUrls["react"];
      const reactDomUrl = reactUrls["react-dom"];
      assertEquals(typeof reactUrl, "string", "react URL should be defined");
      assertEquals(typeof reactDomUrl, "string", "react-dom URL should be defined");
      assertStringIncludes(reactUrl!, "deps=csstype");
      assertStringIncludes(reactDomUrl!, "deps=csstype");
      assertStringIncludes(reactDomUrl!, "external=react");
    });

    it("buildReactUrl generates consistent URLs", () => {
      const url1 = buildReactUrl("react", "19.1.1");
      const url2 = buildReactUrl("react", "19.1.1");

      assertEquals(url1, url2);
      assertStringIncludes(url1, "deps=csstype");
    });

    it("React subpaths include external=react", () => {
      const jsxRuntime = buildReactUrl("react", "19.1.1", "/jsx-runtime", true);
      assertStringIncludes(jsxRuntime, "external=react");
      assertStringIncludes(jsxRuntime, "/jsx-runtime");
    });
  });

  describe("FRAMEWORK_ROOT", () => {
    it("points to valid directory", async () => {
      const fs = createFileSystem();
      const srcExists = await fs.exists(`${FRAMEWORK_ROOT}/src`);
      assertEquals(srcExists, true, `FRAMEWORK_ROOT/src should exist at ${FRAMEWORK_ROOT}/src`);
    });

    it("contains expected framework files", async () => {
      const fs = createFileSystem();

      const headExists = await fs.exists(`${FRAMEWORK_ROOT}/src/react/components/Head.tsx`);
      assertEquals(headExists, true, "Head.tsx should exist");

      const routerExists = await fs.exists(`${FRAMEWORK_ROOT}/src/react/router/index.tsx`);
      assertEquals(routerExists, true, "router/index.tsx should exist");
    });
  });

  describe("EXTENSIONS", () => {
    it("includes all TypeScript and JavaScript extensions", () => {
      assertEquals(EXTENSIONS.includes(".tsx"), true);
      assertEquals(EXTENSIONS.includes(".ts"), true);
      assertEquals(EXTENSIONS.includes(".jsx"), true);
      assertEquals(EXTENSIONS.includes(".js"), true);
    });

    it("prefers TypeScript over JavaScript", () => {
      const tsxIndex = EXTENSIONS.indexOf(".tsx");
      const jsIndex = EXTENSIONS.indexOf(".js");
      assertEquals(tsxIndex < jsIndex, true, ".tsx should be tried before .js");
    });
  });

  describe("REACT_DEFAULT_VERSION", () => {
    it("is a valid semver version", () => {
      const semverPattern = /^\d+\.\d+\.\d+$/;
      assertEquals(semverPattern.test(REACT_DEFAULT_VERSION), true);
    });

    it("is React 19.x", () => {
      assertEquals(REACT_DEFAULT_VERSION.startsWith("19."), true);
    });
  });
});

describe("ssr-vf-modules integration", { sanitizeOps: false, sanitizeResources: false }, () => {
  it("resolves Head.tsx from /_vf_modules/ path", async () => {
    const fs = createFileSystem();
    const { resolveFrameworkFile } = _testExports;

    const result = await resolveFrameworkFile(
      "/_vf_modules/_veryfront/react/components/Head.js?ssr=true",
      fs,
    );

    assertEquals(result !== null, true, "Should resolve Head.tsx");
    assertStringIncludes(result!.sourcePath, "Head.tsx");
    assertStringIncludes(result!.content, "useRef");
  });

  it("resolves router index from /_vf_modules/ path", async () => {
    const fs = createFileSystem();
    const { resolveFrameworkFile } = _testExports;

    const result = await resolveFrameworkFile(
      "/_vf_modules/_veryfront/react/router/index.js?ssr=true",
      fs,
    );

    assertEquals(result !== null, true, "Should resolve router/index.ts");
    assertStringIncludes(result!.sourcePath, "router");
  });

  it("resolves #veryfront/ specifiers to source paths", async () => {
    const { resolveVeryfrontSourcePath } = _testExports;

    const result = await resolveVeryfrontSourcePath("#veryfront/utils");

    assertEquals(result !== null, true, "Should resolve #veryfront/utils");
    assertStringIncludes(result!, "/src/utils");
  });

  it("returns null for non-existent #veryfront/ imports", async () => {
    const { resolveVeryfrontSourcePath } = _testExports;

    const result = await resolveVeryfrontSourcePath("#veryfront/does-not-exist-xyz");
    assertEquals(result, null);
  });

  it("returns null for non-#veryfront/ specifiers", async () => {
    const { resolveVeryfrontSourcePath } = _testExports;

    const result = await resolveVeryfrontSourcePath("react");
    assertEquals(result, null);
  });

  it("source paths include FRAMEWORK_ROOT for cache isolation", async () => {
    const { resolveVeryfrontSourcePath, FRAMEWORK_ROOT } = _testExports;

    // This ensures different environments (source vs compiled binary) have different paths
    const result = await resolveVeryfrontSourcePath("#veryfront/utils");

    assertEquals(result !== null, true, "Should resolve #veryfront/utils");
    assertStringIncludes(
      result!,
      FRAMEWORK_ROOT,
      "Path should contain FRAMEWORK_ROOT for cache isolation",
    );
  });
});

describe("ssr-vf-modules relative import resolution", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  it("resolves relative imports when given explicit paths", async () => {
    // Test the resolveRelativeFrameworkImport function directly
    const { resolveRelativeFrameworkImport, FRAMEWORK_ROOT } = _testExports;
    const fs = createFileSystem();

    // Test resolving ./Head.tsx from index.ts
    const indexPath = `${FRAMEWORK_ROOT}/src/react/components/index.ts`;
    const resolved = await resolveRelativeFrameworkImport("./Head.tsx", indexPath, fs);

    assertEquals(resolved !== null, true, "Should resolve ./Head.tsx");
    assertStringIncludes(resolved!, "Head.tsx");
  });

  it("finds relative imports in transformed code", () => {
    // Test the findRelativeImports function
    const { findRelativeImports } = _testExports;

    const code = `
      import { Head } from "./Head.js";
      import { Link } from "../components/Link.js";
      import React from "react";
    `;

    const imports = findRelativeImports(code);
    assertEquals(imports.length, 2);
    assertEquals(imports.includes("./Head.js"), true);
    assertEquals(imports.includes("../components/Link.js"), true);
  });

  it("transforms single framework file Head.tsx without relative imports", async () => {
    // Test transforming a single file that doesn't have relative imports
    // Head.tsx imports from #veryfront/ which should work fine
    const code =
      `import { Head } from "/_vf_modules/_veryfront/react/components/Head.js?ssr=true";`;
    const ctx = {
      code,
      target: "ssr",
      projectDir: "/tmp/test-project",
      reactVersion: REACT_DEFAULT_VERSION,
    } as TransformContext;

    const result = await ssrVfModulesPlugin.transform(ctx);

    // The transformed code should have the import rewritten to file://
    assertStringIncludes(result, "file://");
  });

  it("transforms index.ts with relative imports to absolute paths", async () => {
    // This test verifies the bug fix for:
    // "Module not found: file:///app/.cache/veryfront-mdx-esm/components/Head.tsx"
    //
    // The bug: When src/react/components/index.ts is transformed, its relative import
    // `export { Head } from "./Head.tsx"` was converted to `./Head.js` by esbuild
    // but NOT rewritten to an absolute file:// path.

    const code =
      `import { Head } from "/_vf_modules/_veryfront/react/components/index.js?ssr=true";`;
    const ctx = {
      code,
      target: "ssr",
      projectDir: "/tmp/test-project",
      reactVersion: REACT_DEFAULT_VERSION,
    } as TransformContext;

    const result = await ssrVfModulesPlugin.transform(ctx);

    // The transformed code should have the import rewritten to file://
    assertStringIncludes(result, "file://");

    // Extract the file:// path from the result
    const filePathMatch = result.match(/from\s*["'](file:\/\/[^"']+)["']/);
    assertEquals(filePathMatch !== null, true, "Should contain file:// import");

    const fs = createFileSystem();
    const cachedPath = filePathMatch![1]!.replace("file://", "");
    const cachedContent = await fs.readTextFile(cachedPath);

    // The cached content should NOT have relative imports like "./Head.tsx" or "./Head.js"
    // It should have file:// paths for all local dependencies
    const relativeImportMatch = cachedContent.match(/from\s*["'](\.\/[^"']+\.(?:tsx?|jsx?))["']/);
    assertEquals(
      relativeImportMatch,
      null,
      `Cached framework module should not have relative imports, but found: ${
        relativeImportMatch?.[1]
      }. ` +
        `Content snippet: ${cachedContent.slice(0, 800)}...`,
    );

    // Verify the imports are now file:// paths
    const fileImportCount = (cachedContent.match(/from\s*["']file:\/\//g) || []).length;
    assertEquals(
      fileImportCount > 0,
      true,
      "Cached module should have file:// imports for dependencies",
    );
  });
});
