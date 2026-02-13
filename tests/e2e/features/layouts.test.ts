#!/usr/bin/env -S deno test --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi --allow-sys
/**
 * Feature Tests: Layouts and App Providers
 *
 * Tests that layout and app provider components work correctly:
 * - pages/layout.tsx wrapping page content
 * - components/app.tsx wrapping the entire app
 * - Nested layouts (root + dashboard layouts)
 * - Layout + App provider combination
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  appProviders,
  createAppProject,
  createLayoutProject,
  createNestedLayoutProject,
  createProject,
  ensureBinaryCompiled,
  expectPage,
  expectServer,
  fetchPage,
  layouts,
  pages,
  withServer,
} from "../setup/index.ts";

describe("Feature: Layouts and App Providers", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  describe("Root Layout (pages/layout.tsx)", () => {
    it("should wrap page content with layout", async () => {
      const projectDir = await createLayoutProject("basic-layout");

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withLayout()
          .withElement("layout-header")
          .withElement("layout-footer")
          .withoutErrors();
      });
    });

    it("should support layouts with framework imports", async () => {
      const projectDir = await createLayoutProject(
        "layout-with-head",
        pages.basic,
        layouts.withHead,
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

    it("should support layouts with relative component imports", async () => {
      const projectDir = await createProject(
        "layout-relative-import",
        pages.basic,
        {
          files: {
            "pages/layout.tsx": `
import { Header } from "../components/Header";
import { Footer } from "../components/Footer";

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div id="layout-wrapper">
      <Header />
      <main>{children}</main>
      <Footer />
    </div>
  );
}
`,
            "components/Header.tsx": `
export function Header() {
  return <header id="layout-header">Site Header</header>;
}
`,
            "components/Footer.tsx": `
export function Footer() {
  return <footer id="layout-footer">Site Footer</footer>;
}
`,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withLayout()
          .withElement("layout-header")
          .withElement("layout-footer")
          .withoutErrors();

        expectServer(server).withoutErrors();
      });
    });
  });

  describe("Nested Layouts", () => {
    it("should render nested layouts correctly", async () => {
      const projectDir = await createNestedLayoutProject("nested-layout");

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/dashboard");

        expectPage(html, response)
          .toRender()
          .withLayout()
          .withElement("dashboard-layout")
          .withElement("sidebar")
          .withElement("dashboard-content")
          .withoutErrors();
      });
    });
  });

  describe("App Provider (components/app.tsx)", () => {
    it("should wrap app with provider component", async () => {
      const projectDir = await createAppProject("basic-app-provider");

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withAppProvider()
          .withElement("app-header")
          .withoutErrors();
      });
    });
  });

  describe("Layout + App Provider Combination", () => {
    it("should work with both layout and app provider", async () => {
      const projectDir = await createProject(
        "app-plus-layout",
        pages.basic,
        {
          files: {
            "components/app.tsx": appProviders.basic,
            "pages/layout.tsx": layouts.basic,
          },
        },
      );

      await withServer(projectDir, async (server) => {
        const { response, html } = await fetchPage(server, "/");

        expectPage(html, response)
          .toRender()
          .withAppProvider()
          .withLayout()
          .withElement("app-header")
          .withElement("layout-header")
          .withoutErrors();

        expectServer(server).withoutReactErrors();
      });
    });
  });
});
