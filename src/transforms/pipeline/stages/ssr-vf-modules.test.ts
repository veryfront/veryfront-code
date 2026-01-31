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
import { _testExports, ssrVfModulesPlugin } from "./ssr-vf-modules.ts";
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

  it("resolves #veryfront/ imports to file:// paths", async () => {
    const fs = createFileSystem();
    const { resolveVeryfrontImport } = _testExports;

    const result = await resolveVeryfrontImport("#veryfront/utils", fs);

    assertEquals(result !== null, true, "Should resolve #veryfront/utils");
    assertEquals(result!.startsWith("file://"), true, "Should return file:// URL");
    assertStringIncludes(result!, "/src/utils");
  });

  it("returns null for non-existent #veryfront/ imports", async () => {
    const fs = createFileSystem();
    const { resolveVeryfrontImport } = _testExports;

    const result = await resolveVeryfrontImport("#veryfront/does-not-exist-xyz", fs);
    assertEquals(result, null);
  });

  it("returns null for non-#veryfront/ specifiers", async () => {
    const fs = createFileSystem();
    const { resolveVeryfrontImport } = _testExports;

    const result = await resolveVeryfrontImport("react", fs);
    assertEquals(result, null);
  });

  it("FRAMEWORK_ROOT is included in file:// paths for cache isolation", async () => {
    const fs = createFileSystem();
    const { resolveVeryfrontImport, FRAMEWORK_ROOT } = _testExports;

    // This ensures different environments (source vs compiled binary) don't share cache files
    const result = await resolveVeryfrontImport("#veryfront/utils", fs);
    assertEquals(result !== null, true, "Should resolve #veryfront/utils");
    assertStringIncludes(
      result!,
      FRAMEWORK_ROOT,
      "Path should contain FRAMEWORK_ROOT for cache isolation",
    );
  });
});
