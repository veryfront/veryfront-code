#!/usr/bin/env -S deno test --allow-read --allow-write --allow-net --allow-env --allow-run --allow-ffi --allow-sys
/**
 * Regression Test: Relative Import Resolution Bug
 *
 * Bug: Pages importing components using relative paths (../components/*)
 *      failed with "Missing module" errors in the SSR module loader.
 *
 * Fixed: 2026-01-31
 *
 * Root Cause:
 *   The SSR module loader wasn't correctly resolving relative imports that
 *   went outside the pages directory (e.g., ../components/). The module
 *   resolution logic didn't properly handle ".." path segments.
 *
 * Reproduction:
 *   1. Create a component in /components/MyComponent.tsx
 *   2. Import it from a page using: import MyComponent from "../components/MyComponent"
 *   3. The page fails to render with a module resolution error
 *
 * Fix:
 *   Updated the SSR module loader to correctly resolve relative paths by
 *   normalizing the path segments before looking up the module.
 */

import { beforeAll, describe, it } from "#veryfront/testing/bdd.ts";
import {
  createComponentImportProject,
  createProject,
  ensureBinaryCompiled,
  expectPage,
  expectServer,
  fetchPage,
  withServer,
} from "../setup/index.ts";

describe("Regression: Relative Import Resolution", {
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  beforeAll(async () => {
    await ensureBinaryCompiled();
  });

  it("should resolve ../components/ imports from pages", async () => {
    const projectDir = await createComponentImportProject("relative-import");

    await withServer(projectDir, async (server) => {
      const { response, html } = await fetchPage(server, "/");

      expectPage(html, response)
        .toRender()
        .withElement("my-component")
        .withText("Component works!")
        .withoutErrors();

      expectServer(server).withoutErrors().withoutModuleErrors();
    });
  });

  it("should resolve deeply nested relative imports (../../)", async () => {
    const projectDir = await createProject(
      "deep-relative",
      `export default function Placeholder() { return null; }`,
      {
        files: {
          "pages/admin/settings/index.tsx": `
import Button from "../../../components/ui/Button";

export default function SettingsPage() {
  return (
    <div id="settings-page">
      <h1>Settings</h1>
      <Button />
    </div>
  );
}
`,
          "components/ui/Button.tsx": `
export default function Button() {
  return <button id="ui-button">Click me</button>;
}
`,
        },
      },
    );

    await withServer(projectDir, async (server) => {
      const { response, html } = await fetchPage(server, "/admin/settings");

      expectPage(html, response)
        .toRender()
        .withElement("settings-page")
        .withElement("ui-button")
        .withoutErrors();

      expectServer(server).withoutErrors();
    });
  });

  it("should resolve same-directory imports with ./", async () => {
    const projectDir = await createProject(
      "same-dir-import",
      `export default function Placeholder() { return null; }`,
      {
        files: {
          "pages/dashboard/index.tsx": `
import { DashboardHeader } from "./header";

export default function Dashboard() {
  return (
    <div id="dashboard">
      <DashboardHeader />
    </div>
  );
}
`,
          "pages/dashboard/header.tsx": `
export function DashboardHeader() {
  return <h1 id="dashboard-header">Dashboard</h1>;
}
`,
        },
      },
    );

    await withServer(projectDir, async (server) => {
      const { response, html } = await fetchPage(server, "/dashboard");

      expectPage(html, response)
        .toRender()
        .withElement("dashboard-header")
        .withoutErrors();

      expectServer(server).withoutErrors();
    });
  });

  it("should resolve directory imports to index files", async () => {
    const projectDir = await createProject(
      "index-resolution",
      `
import { utils } from "../lib/utils";

export default function Home() {
  return <div id="content">{utils.format("test")}</div>;
}
`,
      {
        files: {
          "lib/utils/index.ts": `
export const utils = {
  format: (str: string) => \`formatted-\${str}\`,
};
`,
        },
      },
    );

    await withServer(projectDir, async (server) => {
      const { response, html } = await fetchPage(server, "/");

      expectPage(html, response)
        .toRender()
        .withText("formatted-test")
        .withoutErrors();

      expectServer(server).withoutErrors();
    });
  });

  it("should handle chained relative imports between components", async () => {
    const projectDir = await createProject(
      "chained-imports",
      `
import { Card } from "../components/Card";

export default function Home() {
  return <Card title="Test" />;
}
`,
      {
        files: {
          "components/Card.tsx": `
import { CardHeader } from "./CardHeader";
import { CardBody } from "./CardBody";

export function Card({ title }: { title: string }) {
  return (
    <div id="card">
      <CardHeader title={title} />
      <CardBody />
    </div>
  );
}
`,
          "components/CardHeader.tsx": `
export function CardHeader({ title }: { title: string }) {
  return <h2 id="card-header">{title}</h2>;
}
`,
          "components/CardBody.tsx": `
export function CardBody() {
  return <div id="card-body">Card content</div>;
}
`,
        },
      },
    );

    await withServer(projectDir, async (server) => {
      const { response, html } = await fetchPage(server, "/");

      expectPage(html, response)
        .toRender()
        .withElement("card")
        .withElement("card-header")
        .withElement("card-body")
        .withoutErrors();

      expectServer(server).withoutErrors();
    });
  });
});
