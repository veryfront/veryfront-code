import { JSDOM } from "npm:jsdom@28.0.0";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { mkdir, withTempDir, writeTextFile } from "#veryfront/testing/deno-compat.ts";
import { clearComponentCache, loadComponent } from "./component-loader.ts";
import { LayoutShell } from "./LayoutShell.tsx";

async function writeLayout(directory: string, label: string): Promise<void> {
  await mkdir(`${directory}/layouts`, { recursive: true });
  await writeTextFile(
    `${directory}/layouts/shared.js`,
    `import React from "react";
     export default function Layout(props) {
       return React.createElement("div", null, "${label}:", props.children);
     }`,
  );
}

describe("client/spa/LayoutShell", () => {
  it("does not retain a layout component after its resolved module URL changes", async () => {
    await withTempDir(async (firstDirectory) => {
      await withTempDir(async (secondDirectory) => {
        await writeLayout(firstDirectory, "first");
        await writeLayout(secondDirectory, "second");

        const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
          url: "https://example.com/",
        });
        const previousWindow = (globalThis as Record<string, unknown>).window;
        const previousDocument = (globalThis as Record<string, unknown>).document;
        const previousModuleServerUrl = (globalThis as Record<string, unknown>).MODULE_SERVER_URL;
        Object.assign(globalThis, { window: dom.window, document: dom.window.document });
        clearComponentCache();

        try {
          (globalThis as Record<string, unknown>).MODULE_SERVER_URL = `file://${firstDirectory}`;
          await loadComponent("layouts/shared.tsx");
          const rootElement = document.getElementById("root")!;
          const root = createRoot(rootElement);
          flushSync(() =>
            root.render(
              <LayoutShell layouts={[{ kind: "tsx", path: "layouts/shared.tsx" }]}>
                page
              </LayoutShell>,
            )
          );
          assertStringIncludes(rootElement.textContent ?? "", "first:page");

          (globalThis as Record<string, unknown>).MODULE_SERVER_URL = `file://${secondDirectory}`;
          await loadComponent("layouts/shared.tsx");
          flushSync(() =>
            root.render(
              <LayoutShell layouts={[{ kind: "tsx", path: "layouts/shared.tsx" }]}>
                page
              </LayoutShell>,
            )
          );
          assertStringIncludes(rootElement.textContent ?? "", "second:page");
          root.unmount();
        } finally {
          clearComponentCache();
          if (previousWindow === undefined) delete (globalThis as Record<string, unknown>).window;
          else (globalThis as Record<string, unknown>).window = previousWindow;
          if (previousDocument === undefined) {
            delete (globalThis as Record<string, unknown>).document;
          } else {
            (globalThis as Record<string, unknown>).document = previousDocument;
          }
          if (previousModuleServerUrl === undefined) {
            delete (globalThis as Record<string, unknown>).MODULE_SERVER_URL;
          } else {
            (globalThis as Record<string, unknown>).MODULE_SERVER_URL = previousModuleServerUrl;
          }
          dom.window.close();
        }
      }, { prefix: "vf-client-layout-second-" });
    }, { prefix: "vf-client-layout-first-" });
  });
});
