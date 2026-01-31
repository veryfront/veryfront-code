#!/usr/bin/env -S deno test --allow-all
/**
 * Feature Tests: Framework Module Imports
 *
 * Tests that veryfront/* framework imports work correctly:
 * - veryfront/head - <Head> component for managing document head
 * - veryfront/router - useRouter hook for navigation
 * - veryfront/context - usePageContext hook for page data
 *
 * These imports should resolve to the framework's bundled modules without
 * causing dual React instances or module resolution errors.
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProject,
  ensureBinaryCompiled,
  expectPage,
  expectServer,
  fetchPage,
  layouts,
  pages,
  withServer,
} from "../setup/index.ts";

describe("Feature: Framework Module Imports", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("veryfront/head", () => {
    it("should render pages with Head component import", async () => {
      const projectDir = await createProject("head-import", pages.withHead);

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("content")
          .withText("Page with Head")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });

    it("should work with Head in layout files", async () => {
      const projectDir = await createProject("head-in-layout", pages.basic, {
        files: {
          "pages/layout.tsx": layouts.withHead,
        },
      });

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withLayout()
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });

  describe("veryfront/router", () => {
    it("should render pages with useRouter hook", async () => {
      const projectDir = await createProject("router-import", pages.withRouter);

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("content")
          .withText("Path:")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });

    it("should work with useRouter in layout files", async () => {
      const projectDir = await createProject("router-in-layout", pages.basic, {
        files: {
          "pages/layout.tsx": layouts.withRouter,
        },
      });

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withLayout()
          .withElement("layout-nav")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });

  describe("veryfront/context", () => {
    it("should render pages with usePageContext hook", async () => {
      const projectDir = await createProject("context-import", pages.withPageContext);

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withElement("content")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });

    it("should share context between layout and page", async () => {
      const projectDir = await createProject(
        "shared-context",
        pages.withPageContext,
        {
          files: {
            "pages/layout.tsx": layouts.withPageContext,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withLayout()
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });

  describe("Multiple Framework Imports", () => {
    it("should handle multiple framework imports without React errors", async () => {
      const projectDir = await createProject("multi-import", pages.withHeadAndRouter);

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withoutReactErrors();

        expectServer(server).withoutReactErrors();
      });
    });

    it("should handle client components with useState and framework imports", async () => {
      const projectDir = await createProject(
        "client-with-framework",
        `
"use client";
import { useState } from "react";
import { Head } from "veryfront/head";

export default function Counter() {
  const [count] = useState(0);
  return (
    <>
      <Head><title>Counter</title></Head>
      <div id="content">Count: {count}</div>
    </>
  );
}
`,
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withoutReactErrors();

        expectServer(server).withoutReactErrors();
      });
    });
  });
});
