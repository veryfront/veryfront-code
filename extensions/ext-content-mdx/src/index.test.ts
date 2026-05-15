/**
 * ext-content-mdx extension smoke tests.
 *
 * @module extensions/ext-content-mdx/test
 */

import { assertEquals, assertExists, assertStringIncludes } from "@std/assert";
import { describe, it } from "@std/testing/bdd";

import factory, { MdxContentProcessor } from "./index.ts";

describe("ext-content-mdx factory", () => {
  it("produces an extension whose name is ext-content-mdx", () => {
    const ext = factory();
    assertEquals(ext.name, "ext-content-mdx");
    assertEquals(ext.version, "0.1.0");
  });

  it("declares the ContentProcessor contract", () => {
    const ext = factory();
    assertEquals(ext.contracts?.provides, ["ContentProcessor"]);
    assertEquals(ext.capabilities, []);
  });

  it("registers ContentProcessor when setup runs", async () => {
    const ext = factory();
    let registered: unknown = null;
    const ctx = {
      config: {},
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      provide: (_name: string, impl: unknown) => {
        registered = impl;
      },
      get: () => undefined,
      resolve: () => {
        throw new Error("resolve not used");
      },
    };
    await ext.setup?.(ctx as never);
    assertExists(registered);
    assertEquals(registered instanceof MdxContentProcessor, true);
  });
});

describe("MdxContentProcessor.compileMarkdown", () => {
  it("compiles a trivial markdown document to an ESM module", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMarkdown({
      mode: "production",
      projectDir: "/tmp",
      content: "# Hello\n\nworld\n",
    });
    assertExists(result.compiledCode);
    assertStringIncludes(result.compiledCode, "export default function MDContent");
    assertEquals(result.headings?.length, 1);
    assertEquals(result.headings?.[0]?.text, "Hello");
  });

  it("exposes rawHtml for markdown preview consumers", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMarkdown({
      mode: "production",
      projectDir: "/tmp",
      content: "**bold**",
    });
    assertExists(result.rawHtml);
    assertStringIncludes(result.rawHtml!, "<strong>");
  });
});

describe("MdxContentProcessor.compileMdx", () => {
  it("compiles trivial mdx content", async () => {
    const impl = new MdxContentProcessor();
    const result = await impl.compileMdx({
      mode: "production",
      projectDir: "/tmp",
      content: "# Title\n\nParagraph\n",
    });
    assertExists(result.compiledCode);
    assertStringIncludes(result.compiledCode, "export default");
  });
});
