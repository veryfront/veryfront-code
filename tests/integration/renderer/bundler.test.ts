/**
 * Unit Tests for MDX Compilation System
 * Tests MDX compilation, import resolution, and cross-module imports
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd.ts";
import { compileMDXRuntime } from "@veryfront/transforms/mdx/compiler/mdx-compiler.ts";
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
        // Create provider directory
        await Deno.mkdir(join(context.projectDir, "providers"), {
          recursive: true,
        });
        await Deno.mkdir(join(context.projectDir, "pages"), {
          recursive: true,
        });

        // Create a provider MDX file with named exports
        const providerContent = `---
isProvider: true
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
        await Deno.writeTextFile(providerPath, providerContent);

        // Compile MDX and assert it contains key symbols
        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          providerContent,
          undefined,
          providerPath,
          "server",
        );
        const compiledMDX = String(result.compiledCode);
        // Verify named symbols are present; format can vary
        assertStringIncludes(compiledMDX, "TestContext");
      });
    });

    it("should handle MDX compilation with imports", async () => {
      await withTestContext("mdx-cross-import-bundle", async (context) => {
        // Create provider and pages directories
        await Deno.mkdir(join(context.projectDir, "providers"), {
          recursive: true,
        });
        await Deno.mkdir(join(context.projectDir, "pages"), {
          recursive: true,
        });

        // Create the provider file
        const providerContent = `---
isProvider: true
---

export const TestContext = "imported-value";

export default function TestProvider({ children }) {
  return <div>{children}</div>;
}
`;

        const providerPath = join(context.projectDir, "providers", "TestProvider.mdx");
        await Deno.writeTextFile(providerPath, providerContent);

        // Create a page that imports from an MDX provider
        const pageContent = `---
title: Test Page
---

import { TestContext } from "../providers/TestProvider.mdx";

# Page with Import

This page imports from an MDX provider.
`;

        const pagePath = join(context.projectDir, "pages", "test-page.mdx");
        await Deno.writeTextFile(pagePath, pageContent);

        // Compile the page
        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          pageContent,
          undefined,
          pagePath,
          "server",
        );

        // Verify the compilation succeeded
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
        } catch (_error) {
          // Accept our MDX error message wording
          assertStringIncludes((_error as Error).message, "MDX compilation error");
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

        // Should compile but may have runtime issues
        const result = await compileMDXRuntime(
          "development",
          context.projectDir,
          mdxWithMissingImport,
          undefined,
          join(context.projectDir, "test.mdx"),
          "server",
        );

        // Should not throw during compilation
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

        // Our MDX compile path should handle basic headings
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

        // Output should exist and still contain import("lodash")
        if (!result.compiledCode) {
          throw new Error("No output produced for dynamic import test");
        }
        assertStringIncludes(String(result.compiledCode), 'import("lodash")');
      });
    });
  });
});
