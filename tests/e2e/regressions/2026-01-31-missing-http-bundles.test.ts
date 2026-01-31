#!/usr/bin/env -S deno test --allow-all
/**
 * Regression Test: Missing HTTP Bundles After Transform Cache Hit
 *
 * Bug: SSR pages with veryfront/* imports failed with "Missing HTTP bundles
 *      after transform (1)" error when the transform cache had a hit but the
 *      local HTTP bundle files didn't exist.
 *
 * Fixed: 2026-01-31
 * Commit: 548c35cd
 *
 * Root Cause:
 *   The transform pipeline was returning cached SSR code without validating
 *   that the referenced HTTP bundles actually exist locally. In CI environments
 *   without Redis distributed cache, bundles couldn't be recovered.
 *
 * Reproduction:
 *   1. Render a page with veryfront/head or veryfront/router import
 *   2. Cache the transform result
 *   3. Delete the HTTP bundle files
 *   4. Render the page again - it would use cached code but bundles are missing
 *
 * Fix:
 *   Added validateCachedBundles() in the transform pipeline to verify HTTP
 *   bundles exist before returning cached transforms for SSR. If bundles are
 *   missing, the pipeline re-runs the transform to regenerate them.
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createProject,
  ensureBinaryCompiled,
  expectPage,
  expectServer,
  fetchPage,
  pages,
  withServer,
} from "../setup/index.ts";

describe("Regression: Missing HTTP Bundles After Transform Cache Hit", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  it("should render pages with veryfront/head without missing bundle errors", async () => {
    const projectDir = await createProject("http-bundle-head", pages.withHead);

    await withServer(projectDir, async (server) => {
      // First request populates cache
      const { response: res1, html: html1 } = await fetchPage(server, "/");
      expectPage(html1, res1).toRender().withoutErrors();

      // Second request uses cache - this is where the bug manifested
      const { response: res2, html: html2 } = await fetchPage(server, "/");
      expectPage(html2, res2).toRender().withoutErrors();

      expectServer(server).withoutErrors().withoutModuleErrors();
    });
  });

  it("should render pages with veryfront/router without missing bundle errors", async () => {
    const projectDir = await createProject("http-bundle-router", pages.withRouter);

    await withServer(projectDir, async (server) => {
      const { response: res1, html: html1 } = await fetchPage(server, "/");
      expectPage(html1, res1).toRender().withoutErrors();

      const { response: res2, html: html2 } = await fetchPage(server, "/");
      expectPage(html2, res2).toRender().withoutErrors();

      expectServer(server).withoutErrors();
    });
  });

  it("should render layouts with framework imports without missing bundle errors", async () => {
    const projectDir = await createProject(
      "http-bundle-layout",
      `
export default function Home() {
  return <div id="page-content">Home</div>;
}
`,
      {
        files: {
          "pages/layout.tsx": `
import { Head } from "veryfront/head";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Head><title>Layout Test</title></Head>
      <div id="layout-wrapper">{children}</div>
    </>
  );
}
`,
        },
      },
    );

    await withServer(projectDir, async (server) => {
      const { response: res1, html: html1 } = await fetchPage(server, "/");
      expectPage(html1, res1).toRender().withLayout().withoutErrors();

      const { response: res2, html: html2 } = await fetchPage(server, "/");
      expectPage(html2, res2).toRender().withLayout().withoutErrors();

      expectServer(server).withoutErrors();
    });
  });
});
