import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { bundleMdx, bundleMDXWithOptions } from "./mdx-bundler.ts";
import type { BundleResult, BundlerOptions } from "../types/bundler-types.ts";

function createBundleResult(): BundleResult {
  return {
    outputs: new Map(),
    errors: [],
    warnings: [],
    dependencies: new Map(),
  };
}

function createOptions(overrides?: Partial<BundlerOptions>): BundlerOptions {
  return {
    sources: [],
    projectDir: "/tmp/test-project",
    mode: "production",
    ...overrides,
  };
}

describe("build/renderer/services/mdx-bundler", () => {
  describe("bundleMdx", () => {
    it("should compile simple MDX content", async () => {
      const source = { path: "/tmp/test-project/pages/test.mdx", content: "# Hello World" };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      const output = result.outputs.get("/tmp/test-project/pages/test.js");
      assertExists(output, "should generate JS output");
      assertEquals(output.type, "js", "output type should be js");
    });

    it("should extract frontmatter from MDX content", async () => {
      const source = {
        path: "/tmp/test-project/pages/test.mdx",
        content: "---\ntitle: Test Page\ndescription: A test\n---\n# Hello",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      const output = result.outputs.get("/tmp/test-project/pages/test.js");
      assertExists(output, "should generate output");
      assertExists(output.meta, "should have meta from frontmatter");
      assertEquals(output.meta!.title, "Test Page", "should extract title");
      assertEquals(output.meta!.description, "A test", "should extract description");
    });

    it("should handle MDX content without frontmatter", async () => {
      const source = {
        path: "/tmp/test-project/pages/simple.mdx",
        content: "# Just Content\n\nSome text here.",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      const output = result.outputs.get("/tmp/test-project/pages/simple.js");
      assertExists(output, "should generate output even without frontmatter");
    });

    it("should generate output path by replacing .mdx with .js", async () => {
      const source = {
        path: "/tmp/test-project/pages/about.mdx",
        content: "# About",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      assertEquals(
        result.outputs.has("/tmp/test-project/pages/about.js"),
        true,
        "should replace .mdx with .js in output path",
      );
    });

    it("should track dependencies", async () => {
      const source = {
        path: "/tmp/test-project/pages/dep.mdx",
        content: "# Deps",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      await bundleMdx(source, options, result, compileFn);

      assertEquals(
        result.dependencies.has("/tmp/test-project/pages/dep.mdx"),
        true,
        "should track source file dependencies",
      );
    });

    it("should capture errors without throwing", async () => {
      const source = {
        path: "/tmp/test-project/pages/bad.mdx",
        content: "---\ntitle: Bad\n---\n# Content with {invalid jsx <></>}",
      };
      const result = createBundleResult();
      const options = createOptions();
      const compileFn = async (src: string, _opts: BundlerOptions) => `compiled: ${src}`;

      // bundleMdx catches errors internally
      await bundleMdx(source, options, result, compileFn);

      // Either it succeeds or pushes to result.errors - both are acceptable
      assertEquals(
        result.outputs.size + result.errors.length > 0,
        true,
        "should produce output or capture error",
      );
    });
  });

  describe("bundleMDXWithOptions", () => {
    it("should return code string for simple MDX", async () => {
      const result = await bundleMDXWithOptions({
        content: "# Hello\n\nSimple content.",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
        mode: "production",
      });

      assertEquals(typeof result.code, "string", "should return code string");
      assertExists(result.frontmatter, "should return frontmatter object");
      assertExists(result.dependencies, "should return dependencies array");
    });

    it("should extract frontmatter from content", async () => {
      const result = await bundleMDXWithOptions({
        content: "---\ntitle: My Page\ndescription: A description\n---\n# My Page",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
      });

      assertEquals(result.frontmatter.title, "My Page", "should extract title");
      assertEquals(result.frontmatter.description, "A description", "should extract description");
    });

    it("should handle content without frontmatter", async () => {
      const result = await bundleMDXWithOptions({
        content: "# No Frontmatter",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
      });

      assertEquals(typeof result.code, "string", "should return code");
      assertEquals(
        Object.keys(result.frontmatter).length,
        0,
        "should return empty frontmatter",
      );
    });

    it("should default mode to production", async () => {
      const result = await bundleMDXWithOptions({
        content: "# Test",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
      });

      assertEquals(typeof result.code, "string", "should compile with default mode");
    });

    it("should include globals import when globals provided", async () => {
      const result = await bundleMDXWithOptions({
        content: "# Test",
        filePath: "/tmp/test.mdx",
        projectDir: "/tmp",
        globals: { myGlobal: "MyGlobal" },
      });

      assertEquals(result.code.includes("myGlobal"), true, "should reference global in code");
    });

    it("should return errors array for invalid MDX", async () => {
      const result = await bundleMDXWithOptions({
        content: "---\ntitle: Test\n---\n# Content with {<<<invalid>>>}",
        filePath: "/tmp/bad.mdx",
        projectDir: "/tmp",
      });

      assertExists(result.errors, "should have errors array");
      assertEquals(result.errors!.length > 0, true, "should contain at least one error");
      assertEquals(result.code, "", "error path should return empty code");
    });
  });
});
