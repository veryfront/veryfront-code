/**
 * Unit Tests for MDX Compilation System
 * Tests MDX compilation, import resolution, and cross-module imports
 */

import { assert, assertEquals, assertStringIncludes } from "#veryfront/testing/assert";
import { join } from "#veryfront/compat/path";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { describe, it } from "#veryfront/testing/bdd";
import { compileMDXRuntime } from "#veryfront/transforms/mdx/compiler/mdx-compiler.ts";
import { withTestContext } from "../../_helpers/context.ts";

describe("MDX Compilation System", () => {
  describe("MDX Compilation", () => {
    it("should compile basic MDX to JavaScript", async () => {
      await withTestContext("mdx-compilation-basic", async (context) => {
        const mdxContent = `# Hello World

This is a test MDX file.

export const testValue = "hello";
`;

        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          mdxContent,
          undefined,
          "test.mdx",
          "server",
        );

        assert(result.compiledCode);
        assertStringIncludes(String(result.compiledCode), "Hello World");
        assertEquals(typeof result.compiledCode, "string");
      });
    });

    it("should handle frontmatter", async () => {
      await withTestContext("mdx-compilation-frontmatter", async (context) => {
        const mdxContent = `---
title: Test Page
description: A test page
custom: value
---

# Test Content
`;

        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          mdxContent,
          undefined,
          "test.mdx",
          "server",
        );

        assertEquals(result.frontmatter?.title, "Test Page");
        assertEquals(result.frontmatter?.description, "A test page");
        assertEquals(result.frontmatter?.custom, "value");
        assertStringIncludes(String(result.compiledCode), "Test Content");
      });
    });

    it("should handle JSX components in MDX", async () => {
      await withTestContext("mdx-compilation-jsx", async (context) => {
        const mdxContent = `# Component Test

<div className="test-div">
  <span>Hello JSX</span>
</div>
`;

        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          mdxContent,
          undefined,
          "test.mdx",
          "server",
        );

        assertStringIncludes(String(result.compiledCode), "test-div");
        assertStringIncludes(String(result.compiledCode), "Hello JSX");
      });
    });
  });

  describe("Cross-Module Imports", () => {
    it("should preserve named exports from imported MDX", async () => {
      await withTestContext("mdx-cross-import-named", async (context) => {
        await mkdir(join(context.projectDir, "providers"), { recursive: true });
        await mkdir(join(context.projectDir, "pages"), { recursive: true });

        const providerContent = `---
title: TestProvider
---

import { createContext } from "react";

export const TestContext = createContext({ value: "test-value" });
export const utilityFunction = () => "utility-result";

export default function TestProvider({ children }) {
  return (<TestContext.Provider value={{ value: "test-value" }}>
      {children}
    </TestContext.Provider>);
}
`;

        const providerPath = join(context.projectDir, "providers", "TestProvider.mdx");
        await writeTextFile(providerPath, providerContent);

        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          providerContent,
          undefined,
          providerPath,
          "server",
        );

        assertStringIncludes(String(result.compiledCode), "TestContext");
      });
    });

    it("should handle MDX compilation with imports", async () => {
      await withTestContext("mdx-cross-import-bundle", async (context) => {
        await mkdir(join(context.projectDir, "providers"), { recursive: true });
        await mkdir(join(context.projectDir, "pages"), { recursive: true });

        const providerContent = `---
title: TestProvider
---

export const TestContext = "imported-value";

export default function TestProvider({ children }) {
  return <div>{children}</div>;
}
`;

        const providerPath = join(context.projectDir, "providers", "TestProvider.mdx");
        await writeTextFile(providerPath, providerContent);

        const pageContent = `---
title: Test Page
---

import { TestContext } from "../providers/TestProvider.mdx";

# Page with Import

This page imports from an MDX provider.
`;

        const pagePath = join(context.projectDir, "pages", "test-page.mdx");
        await writeTextFile(pagePath, pageContent);

        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          pageContent,
          undefined,
          pagePath,
          "server",
        );

        assert(result.compiledCode);
        assertStringIncludes(String(result.compiledCode), "Page with Import");
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid MDX syntax", async () => {
      await withTestContext("mdx-error-invalid-mdx", async (context) => {
        const invalidMDX = `# Test

<InvalidComponent unclosed={
`;

        try {
          await compileMDXRuntime(
            "development",
            context.projectDir,
            invalidMDX,
            undefined,
            "test.mdx",
            "server",
          );
          assert(false, "Should have thrown an error");
        } catch (error) {
          assertStringIncludes((error as Error).message, "MDX compilation error");
        }
      });
    });

    it("should handle missing imports gracefully", async () => {
      await withTestContext("mdx-error-missing-import", async (context) => {
        const mdxWithMissingImport = `---
title: Missing Import Test
---

import { NonExistentComponent } from "./missing-module.js";

# Test Page

<NonExistentComponent />
`;

        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          mdxWithMissingImport,
          undefined,
          join(context.projectDir, "test.mdx"),
          "server",
        );

        assert(result);
      });
    });
  });

  describe("Plugin Support", () => {
    it("should compile MDX with basic content", async () => {
      await withTestContext("mdx-plugin-remark", async (context) => {
        const mdxContent = `# Test Heading

This is a test paragraph.
`;

        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          mdxContent,
          undefined,
          "test.mdx",
          "server",
        );

        assertStringIncludes(String(result.compiledCode), "Test Heading");
      });
    });
  });

  describe("Dynamic imports", () => {
    it("should handle TypeScript with dynamic imports", async () => {
      await withTestContext("mdx-dynamic-import", async (context) => {
        const mdxContent = `
export async function load() {
  const mod = await import("lodash");
  return !!mod;
}

# Test Page
`;

        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          mdxContent,
          undefined,
          "entry.mdx",
          "browser",
        );

        if (!result.compiledCode) {
          throw new Error("No output produced for dynamic import test");
        }

        assertStringIncludes(String(result.compiledCode), 'import("lodash")');
      });
    });
  });
});
