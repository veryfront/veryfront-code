#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: MDX Pages
 *
 * Tests that MDX (Markdown with JSX) pages work correctly:
 * - Basic markdown rendering
 * - Frontmatter parsing
 * - React components in MDX
 * - Inline component definitions
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createMdxProject,
  createProject,
  ensureBinaryCompiled,
  expectPage,
  fetchPage,
  mdxContent,
  pages,
  withServer,
} from "../setup/index.ts";

describe("Feature: MDX Pages", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("Basic Markdown", () => {
    it("should render MDX pages with markdown formatting", async () => {
      const projectDir = await createMdxProject("mdx-basic");

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/blog/post");

        expectPage(html, response)
          .toRender()
          .withText("Welcome")
          .withText("<strong>markdown</strong>")
          .withText("Item 1")
          .withoutErrors();
      });
    });
  });

  describe("React Components in MDX", () => {
    it("should render imported React components", async () => {
      const projectDir = await createProject(
        "mdx-components",
        pages.basic,
        {
          files: {
            "pages/docs/guide.mdx": mdxContent.withComponents,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/docs/guide");

        expectPage(html, response)
          .toRender()
          .withElement("react-in-mdx")
          .withText("React component in MDX")
          .withoutErrors();
      });
    });

    it("should render inline component definitions", async () => {
      const projectDir = await createProject(
        "mdx-inline-component",
        pages.basic,
        {
          files: {
            "pages/docs/intro.mdx": mdxContent.withInlineComponent,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/docs/intro");

        expectPage(html, response)
          .toRender()
          .withElement("callout")
          .withText("Important note")
          .withoutErrors();
      });
    });
  });

  describe("MDX with Framework Imports", () => {
    it("should support veryfront/head in MDX", async () => {
      const projectDir = await createProject(
        "mdx-head",
        pages.basic,
        {
          files: {
            "pages/blog/article.mdx": `
import { Head } from "veryfront/head";

<Head><title>MDX Article</title></Head>

# Article Title

Content goes here.
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/blog/article");

        expectPage(html, response)
          .toRender()
          .withText("Article Title")
          .withoutErrors();
      });
    });
  });
});
