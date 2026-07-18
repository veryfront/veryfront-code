import { renderToString } from "react-dom/server";
import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { ClientApp, type PageDataResponse } from "./ClientApp.tsx";
import { clearComponentCache, loadComponent } from "./component-loader.ts";

function createFileModuleServerUrl(tempDir: string): string {
  return `file://${tempDir}`;
}

async function writeModule(
  tempDir: string,
  relativePath: string,
  source: string,
): Promise<void> {
  const filePath = `${tempDir}/${relativePath}`;
  const directory = filePath.slice(0, filePath.lastIndexOf("/"));
  await mkdir(directory, { recursive: true });
  await writeTextFile(filePath, source);
}

async function withModuleServerUrl<T>(tempDir: string, fn: () => Promise<T>): Promise<T> {
  const globalRecord = globalThis as unknown as {
    MODULE_SERVER_URL?: string;
    window?: unknown;
  };
  const previousModuleServerUrl = globalRecord.MODULE_SERVER_URL;
  const previousWindow = globalRecord.window;
  globalRecord.window = globalThis;
  globalRecord.MODULE_SERVER_URL = createFileModuleServerUrl(tempDir);
  clearComponentCache();

  try {
    return await fn();
  } finally {
    clearComponentCache();

    if (previousModuleServerUrl === undefined) {
      delete globalRecord.MODULE_SERVER_URL;
    } else {
      globalRecord.MODULE_SERVER_URL = previousModuleServerUrl;
    }

    if (previousWindow === undefined) {
      delete globalRecord.window;
    } else {
      globalRecord.window = previousWindow;
    }
  }
}

describe("client/spa/ClientApp", () => {
  it("renders from cached page and layout modules with the provided props", async () => {
    await withTempDir(async (tempDir) => {
      await writeModule(
        tempDir,
        "pages/docs.js",
        "export default function Page(props) { return JSON.stringify({ title: props.title, params: props.params }); }",
      );
      await writeModule(
        tempDir,
        "layouts/main.js",
        "export default function Layout(props) { return [String(props.theme), props.children]; }",
      );

      await withModuleServerUrl(tempDir, async () => {
        await loadComponent("pages/docs.tsx");
        await loadComponent("layouts/main.tsx");

        const initialData: PageDataResponse = {
          slug: "/docs",
          pagePath: "pages/docs.tsx",
          pageType: "tsx",
          layouts: [{ kind: "tsx", path: "layouts/main.tsx" }],
          providers: [],
          frontmatter: { title: "Docs" },
          props: { title: "Welcome" },
          params: { slug: ["guide", "intro"] },
          layoutProps: { "layouts/main.tsx": { theme: "dark" } },
        };

        const html = renderToString(<ClientApp initialData={initialData} />);

        assertStringIncludes(html, "dark");
        assertStringIncludes(html, "&quot;title&quot;:&quot;Welcome&quot;");
        assertStringIncludes(html, "&quot;slug&quot;:[&quot;guide&quot;,&quot;intro&quot;]");
      });
    }, { prefix: "vf-client-app-" });
  });
});
