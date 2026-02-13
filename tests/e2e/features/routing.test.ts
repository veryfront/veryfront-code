#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: File-based Routing
 *
 * Tests that file-based routing works correctly:
 * - Static routes (pages/about.tsx → /about)
 * - Dynamic routes ([slug].tsx → /anything)
 * - Catch-all routes ([...slug].tsx → /a/b/c/d)
 * - Index routes (pages/index.tsx → /)
 * - Nested routes (pages/blog/post.tsx → /blog/post)
 * - 404 handling for missing pages
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  assertNotFound,
  createDynamicRouteProject,
  createProject,
  ensureBinaryCompiled,
  expectPage,
  fetchPage,
  pages,
  withServer,
} from "../setup/index.ts";

describe("Feature: File-based Routing", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("Static Routes", () => {
    it("should render index page at /", async () => {
      const projectDir = await createProject("static-index", pages.basic);

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("content")
          .withoutErrors();
      });
    });

    it("should render named pages at their path", async () => {
      const projectDir = await createProject(
        "static-named",
        pages.basic,
        {
          files: {
            "pages/about.tsx": `
export default function About() {
  return <div id="about-page">About Us</div>;
}
`,
            "pages/contact.tsx": `
export default function Contact() {
  return <div id="contact-page">Contact Us</div>;
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response: aboutRes, html: aboutHtml } = await fetchPage(server, "/about");
        expectPage(aboutHtml, aboutRes).toRender().withElement("about-page");

        const { response: contactRes, html: contactHtml } = await fetchPage(server, "/contact");
        expectPage(contactHtml, contactRes).toRender().withElement("contact-page");
      });
    });

    it("should render nested static pages", async () => {
      const projectDir = await createProject(
        "static-nested",
        pages.basic,
        {
          files: {
            "pages/blog/index.tsx": `
export default function BlogIndex() {
  return <div id="blog-index">Blog Index</div>;
}
`,
            "pages/blog/about.tsx": `
export default function BlogAbout() {
  return <div id="blog-about">About the Blog</div>;
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/blog");
        expectPage(html, response).toRender().withElement("blog-index");

        const { response: aboutRes, html: aboutHtml } = await fetchPage(server, "/blog/about");
        expectPage(aboutHtml, aboutRes).toRender().withElement("blog-about");
      });
    });
  });

  describe("Dynamic Routes ([slug])", () => {
    it("should render dynamic [slug] routes", async () => {
      const projectDir = await createDynamicRouteProject("dynamic-slug");

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/blog/my-post");

        expectPage(html, response)
          .toRender()
          .withElement("blog-post")
          .withoutErrors();
      });
    });

    it("should render root-level dynamic routes", async () => {
      const projectDir = await createProject(
        "dynamic-root",
        pages.basic,
        {
          files: {
            "pages/[page].tsx": `
export default function DynamicPage({ params }: { params: { page: string } }) {
  return <div id="dynamic-page">Page: {params?.page || "unknown"}</div>;
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/about-us");

        expectPage(html, response)
          .toRender()
          .withElement("dynamic-page")
          .withoutErrors();
      });
    });

    it("should render nested dynamic routes", async () => {
      const projectDir = await createProject(
        "dynamic-nested",
        pages.basic,
        {
          files: {
            "pages/projects/[id].tsx": `
export default function Project({ params }: { params: { id: string } }) {
  return <div id="project-page">Project: {params?.id}</div>;
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/projects/my-project-123");

        expectPage(html, response)
          .toRender()
          .withElement("project-page")
          .withoutErrors();
      });
    });
  });

  describe("Catch-all Routes ([...slug])", () => {
    it("should render catch-all routes", async () => {
      const projectDir = await createProject(
        "catchall",
        pages.basic,
        {
          files: {
            "pages/docs/[...slug].tsx": `
export default function DocsPage({ params }: { params: { slug: string[] } }) {
  return <div id="docs-page">Docs: {params?.slug?.join("/")}</div>;
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(
          server,
          "/docs/getting-started/installation/linux",
        );

        expectPage(html, response)
          .toRender()
          .withElement("docs-page")
          .withoutErrors();
      });
    });
  });

  describe("404 Handling", () => {
    it("should return 404 for non-existent pages", async () => {
      const projectDir = await createProject("404-test", pages.basic);

      await withServer(projectDir, async (server) => {
        const { response } = await fetchPage(server, "/this-page-does-not-exist");
        assertNotFound(response);
      });
    });

    it("should include Not Found message in 404 response", async () => {
      const projectDir = await createProject("404-message", pages.basic);

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/nonexistent");

        assertNotFound(response);
        expectPage(html).withText("Not Found");
      });
    });
  });
});
