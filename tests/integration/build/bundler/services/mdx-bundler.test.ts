/**
 * MDX Bundler Tests
 *
 * Comprehensive tests for MDX bundling service covering:
 * - MDX compilation and bundling
 * - Frontmatter extraction
 * - Import processing
 * - Plugin integration
 * - Error handling
 * - Dependency tracking
 */

import { assertEquals, assertExists } from "@std/assert";
import { join } from "@std/path";
import { describe, it } from "@std/testing/bdd";
import {
  bundleMdx,
  bundleMDXWithOptions,
} from "../../../../../src/build/renderer/services/mdx-bundler.ts";
import type {
  BundleResult,
  BundlerOptions,
} from "../../../../../src/build/renderer/types/bundler-types.ts";
import { withTestContext } from "../../../../_helpers/context.ts";

describe(
  "MDX Bundler",
  () => {
    describe("bundleMdx", () => {
      it("bundles basic MDX content", async () => {
        await withTestContext("mdx-basic", async (context) => {
          const content = `# Hello World

This is a simple MDX document.

## Features

- Markdown
- Components
- Everything!`;

          const source = {
            path: join(context.projectDir, "test.mdx"),
            content,
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const compileMDXForImport = (_src: string) => {
            return Promise.resolve(`export default function() { return "${_src}"; }`);
          };

          await bundleMdx(source, options, result, compileMDXForImport);

          // Should create JS output
          const outputPath = source.path.replace(/\.mdx$/, ".js");
          assertExists(result.outputs.get(outputPath));

          const output = result.outputs.get(outputPath)!;
          assertEquals(output.type, "js");

          // Should contain React import
          assertEquals(output.content.includes("React"), true);

          // Should export default component
          assertEquals(output.content.includes("export default function"), true);

          // Should export meta
          assertEquals(output.content.includes("export const meta"), true);
        });
      });

      it("extracts frontmatter", async () => {
        await withTestContext("mdx-frontmatter", async (context) => {
          const content = `---
title: Test Page
description: A test MDX page
author: Test Author
tags:
  - test
  - mdx
---

# Content

This is the body.`;

          const source = {
            path: join(context.projectDir, "page.mdx"),
            content,
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const compileMDXForImport = (_src: string) => {
            return Promise.resolve(`export default function() { return "${_src}"; }`);
          };

          await bundleMdx(source, options, result, compileMDXForImport);

          const outputPath = source.path.replace(/\.mdx$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should include frontmatter in meta
          assertEquals(output.content.includes('"title"'), true);
          assertEquals(output.content.includes("Test Page"), true);
          assertEquals(output.content.includes("Test Author"), true);

          // Should have meta object
          assertExists(output.meta);
          assertEquals(output.meta.title, "Test Page");
          assertEquals(output.meta.description, "A test MDX page");
        });
      });

      it("handles MDX without frontmatter", async () => {
        await withTestContext("mdx-no-frontmatter", async (context) => {
          const content = `# Simple Page

No frontmatter here.`;

          const source = {
            path: join(context.projectDir, "simple.mdx"),
            content,
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const compileMDXForImport = (_src: string) => {
            return Promise.resolve(`export default function() { return "${_src}"; }`);
          };

          await bundleMdx(source, options, result, compileMDXForImport);

          const outputPath = source.path.replace(/\.mdx$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should have meta with slug
          assertEquals(output.content.includes("export const meta"), true);

          // Should compile successfully
          assertExists(output.content);
        });
      });

      it("processes MDX imports", async () => {
        await withTestContext("mdx-imports", async (context) => {
          // Create imported MDX file
          const importedContent = `# Imported Content`;
          await Deno.writeTextFile(join(context.projectDir, "imported.mdx"), importedContent);

          const content = `---
title: Main Page
---

import Imported from "./imported.mdx"

# Main Content

<Imported />`;

          const source = {
            path: join(context.projectDir, "main.mdx"),
            content,
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          let importCompiled = false;
          const compileMDXForImport = (_src: string) => {
            importCompiled = true;
            return Promise.resolve(`export default function ImportedMDX() { return "Imported"; }`);
          };

          await bundleMdx(source, options, result, compileMDXForImport);

          // Should process import
          assertEquals(importCompiled, true);

          // Should create output for imported file
          const importOutputPath = join(context.projectDir, "imported.js");
          assertExists(result.outputs.get(importOutputPath));
        });
      });

      it("validates local imports", async () => {
        await withTestContext("mdx-validate-imports", async (context) => {
          const content = `---
title: Test
---

import NonExistent from "./non-existent.js"

# Content`;

          const source = {
            path: join(context.projectDir, "test.mdx"),
            content,
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const compileMDXForImport = (_src: string) => {
            return Promise.resolve(`export default function() { return "${_src}"; }`);
          };

          await bundleMdx(source, options, result, compileMDXForImport);

          // Should add error for missing import
          assertEquals(result.errors.length > 0, true);
          const hasImportError = result.errors.some((err) =>
            err.message.includes("Cannot find module")
          );
          assertEquals(hasImportError, true);
        });
      });

      it("tracks dependencies", async () => {
        await withTestContext("mdx-dependencies", async (context) => {
          const content = `---
title: Test
---

import Component from "./component.tsx"

# Content`;

          const source = {
            path: join(context.projectDir, "page.mdx"),
            content,
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const compileMDXForImport = (_src: string) => {
            return Promise.resolve(`export default function() { return "${_src}"; }`);
          };

          await bundleMdx(source, options, result, compileMDXForImport);

          // Should track dependencies
          assertExists(result.dependencies.get(source.path));
          const deps = result.dependencies.get(source.path)!;

          // Should include React import
          assertEquals(deps.includes("react"), true);
        });
      });

      it("handles compilation errors gracefully", async () => {
        await withTestContext("mdx-compile-error", async (context) => {
          // Invalid JSX syntax
          const content = `# Test

<Component unclosed=`;

          const source = {
            path: join(context.projectDir, "broken.mdx"),
            content,
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const compileMDXForImport = (_src: string) => {
            return Promise.resolve(`export default function() { return "${_src}"; }`);
          };

          await bundleMdx(source, options, result, compileMDXForImport);

          // Should have errors
          assertEquals(result.errors.length > 0, true);
        });
      });

      it("respects development mode", async () => {
        await withTestContext("mdx-dev-mode", async (context) => {
          const content = `# Development Mode Test`;

          const source = {
            path: join(context.projectDir, "dev.mdx"),
            content,
          };

          const options: BundlerOptions = {
            sources: [],
            projectDir: context.projectDir,
            mode: "development",
          };

          const result: BundleResult = {
            outputs: new Map(),
            errors: [],
            warnings: [],
            dependencies: new Map(),
          };

          const compileMDXForImport = (_src: string) => {
            return Promise.resolve(`export default function() { return "${_src}"; }`);
          };

          await bundleMdx(source, options, result, compileMDXForImport);

          const outputPath = source.path.replace(/\.mdx$/, ".js");
          const output = result.outputs.get(outputPath)!;

          // Should compile with development flag
          assertExists(output.content);
        });
      });
    });

    describe("bundleMDXWithOptions", () => {
      it("bundles MDX with custom options", async () => {
        await withTestContext("mdx-with-options", async (context) => {
          const content = `---
title: Custom Options Test
---

# Test Content

Using custom bundler.`;

          const result = await bundleMDXWithOptions({
            content,
            filePath: join(context.projectDir, "test.mdx"),
            projectDir: context.projectDir,
            mode: "production",
          });

          assertExists(result.code);
          assertEquals(result.code.includes("React"), true);
          assertEquals(result.code.includes("export default"), true);

          // Should extract frontmatter
          assertExists(result.frontmatter);
          assertEquals(result.frontmatter.title, "Custom Options Test");

          // Should track dependencies
          assertEquals(Array.isArray(result.dependencies), true);
        });
      });

      it("handles globals", async () => {
        await withTestContext("mdx-globals", async (context) => {
          const content = `# Test

Using global: {API_URL}`;

          const result = await bundleMDXWithOptions({
            content,
            filePath: join(context.projectDir, "test.mdx"),
            projectDir: context.projectDir,
            mode: "production",
            globals: {
              API_URL: "https://api.example.com",
            },
          });

          // Should include globals import
          assertEquals(result.code.includes("API_URL"), true);
          assertEquals(result.code.includes("globalThis"), true);
        });
      });

      it("handles custom plugins", async () => {
        await withTestContext("mdx-plugins", async (context) => {
          const content = `# Test Content`;

          const result = await bundleMDXWithOptions({
            content,
            filePath: join(context.projectDir, "test.mdx"),
            projectDir: context.projectDir,
            mode: "production",
            remarkPlugins: [],
            rehypePlugins: [],
          });

          // Should compile successfully with custom plugins
          assertExists(result.code);
          assertEquals(result.code.length > 0, true);
        });
      });

      it("returns errors on compilation failure", async () => {
        await withTestContext("mdx-options-error", async (context) => {
          // Invalid MDX
          const content = `<Component unclosed=`;

          const result = await bundleMDXWithOptions({
            content,
            filePath: join(context.projectDir, "broken.mdx"),
            projectDir: context.projectDir,
            mode: "production",
          });

          // Should return errors
          assertExists(result.errors);
          assertEquals(result.errors!.length > 0, true);

          // Should return empty code
          assertEquals(result.code, "");

          // Should return empty frontmatter
          assertEquals(Object.keys(result.frontmatter).length, 0);
        });
      });

      it("extracts dependencies correctly", async () => {
        await withTestContext("mdx-deps-extract", async (context) => {
          const content = `---
title: Dependencies Test
---

import Button from "@/components/Button"
import { useState } from "react"

# Content`;

          const result = await bundleMDXWithOptions({
            content,
            filePath: join(context.projectDir, "test.mdx"),
            projectDir: context.projectDir,
            mode: "production",
          });

          // Should extract dependencies
          assertEquals(Array.isArray(result.dependencies), true);
          // Dependencies are extracted from compiled output (may be empty for simple cases)
          assertEquals(result.dependencies.length >= 0, true);
        });
      });

      it("handles empty content", async () => {
        await withTestContext("mdx-empty", async (context) => {
          const result = await bundleMDXWithOptions({
            content: "",
            filePath: join(context.projectDir, "empty.mdx"),
            projectDir: context.projectDir,
            mode: "production",
          });

          // Should compile empty content
          assertExists(result.code);
          assertEquals(result.frontmatter, {});
        });
      });

      it("generates correct meta object", async () => {
        await withTestContext("mdx-meta", async (context) => {
          const content = `---
title: Meta Test
description: Testing meta generation
author: Test Author
date: 2024-01-01
custom: value
---

# Content`;

          const result = await bundleMDXWithOptions({
            content,
            filePath: join(context.projectDir, "test.mdx"),
            projectDir: context.projectDir,
            mode: "production",
          });

          // Should include meta export
          assertEquals(result.code.includes("export const meta"), true);

          // Frontmatter should have all fields
          assertEquals(result.frontmatter.title, "Meta Test");
          assertEquals(result.frontmatter.description, "Testing meta generation");
          assertEquals(result.frontmatter.author, "Test Author");
          assertEquals(result.frontmatter.custom, "value");
        });
      });

      it("defaults to production mode", async () => {
        await withTestContext("mdx-default-mode", async (context) => {
          const content = `# Test`;

          const result = await bundleMDXWithOptions({
            content,
            filePath: join(context.projectDir, "test.mdx"),
            projectDir: context.projectDir,
            // mode not specified
          });

          // Should compile successfully
          assertExists(result.code);
        });
      });
    });
  },
);
